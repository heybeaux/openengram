/**
 * Swift language extractor backed by tree-sitter-swift.
 *
 * Projects a Swift source file onto the language-agnostic v2 structure graph:
 *   - the file itself becomes a `module` node spanning the file (named after
 *     the file stem; Swift's actual module is determined by the build system
 *     and is not resolvable at single-file granularity)
 *   - `import Foo` / `import Foo.Bar` / `import struct Foo.Bar` become
 *     `import` nodes and `imports` edges with the dotted path as the name
 *   - `class` / `struct` / `enum` / `actor` declarations become `class`
 *     nodes with a `shape` metadata field. `protocol` declarations become
 *     `interface` nodes.
 *   - `extension T { ... }` becomes a `class` node named after `T` with
 *     `shape: "extension"`. Conformance list (`extension T: P`) emits
 *     `extends` edges from `T` to each protocol.
 *   - Member `func` declarations inside a class/struct/enum/actor/extension
 *     body emit `method` nodes parented to the enclosing type; member
 *     requirements inside a `protocol` body (`protocol_function_declaration`)
 *     also emit `method` nodes flagged `declaration: true`.
 *   - Top-level `func` declarations become `function` nodes.
 *   - `inheritance_specifier`s on class/struct/enum/actor declarations emit
 *     `extends` edges. Swift's grammar does not distinguish the base class
 *     from conforming protocols at the syntactic level — we record every
 *     conformer as an `extends` edge.
 *   - `call_expression` inside a function/method body emits a `call` node
 *     plus a `calls` edge from the enclosing symbol.
 *
 * Limitations (v1, EC-55):
 *   - Generic parameters and where-clauses are not captured as separate
 *     nodes.
 *   - Computed properties' getter/setter bodies are not walked for calls.
 *   - `extension`s do not attempt to merge methods with the original type
 *     declaration — each extension produces its own `class` node, and
 *     downstream passes can dedupe by name if desired.
 *   - Operator definitions (`func +(...)`) record the operator text as the
 *     symbol name.
 *   - Nested type declarations (`class Foo { struct Inner {} }`) emit the
 *     inner type as its own top-level-style `class` node parented to the
 *     outer type; full nested qualification is left to downstream passes.
 */

import { basename, extname } from 'node:path';

import Parser = require('tree-sitter');

import { register } from './registry';
import {
  LanguageExtractor,
  ParseResult,
  StructureEdge,
  StructureNode,
} from './types';

type TsNode = Parser.SyntaxNode;

const Swift = require('tree-sitter-swift');

function parseSource(source: string): Parser.Tree {
  // Fresh parser per call: tree-sitter's native singleton retains the
  // last `setLanguage` call across spec sandboxes in the same worker.
  const p = new Parser();
  p.setLanguage(Swift);
  return p.parse(source);
}

/** tree-sitter rows are 0-based; ParseResult lines are 1-based, inclusive. */
function startLine(node: TsNode): number {
  return node.startPosition.row + 1;
}
function endLine(node: TsNode): number {
  return node.endPosition.row + 1;
}

function moduleNameFromPath(filePath: string): string {
  const base = basename(filePath);
  const ext = extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

/**
 * The Swift grammar represents `class`, `struct`, `enum`, `actor`, and
 * `extension` all as `class_declaration`. They are distinguished by the
 * leading unnamed keyword token. Returns one of `class | struct | enum |
 * actor | extension`, or null when the leading token is unrecognized.
 */
function classKindOf(decl: TsNode): string | null {
  for (const child of decl.children) {
    if (child.isNamed) break;
    const t = child.type;
    if (
      t === 'class' ||
      t === 'struct' ||
      t === 'enum' ||
      t === 'actor' ||
      t === 'extension'
    ) {
      return t;
    }
  }
  return null;
}

/**
 * Resolve the declared name on a `class_declaration`. For class/struct/
 * enum/actor the name is a `type_identifier` child. For `extension` the
 * name is a `user_type` (which may itself be a dotted path).
 */
function classDeclName(decl: TsNode): string | null {
  // Prefer the grammar's own `name` field when available — it returns the
  // appropriate node for both regular declarations and extensions.
  const named = decl.childForFieldName('name');
  if (named) return named.text;
  for (const child of decl.namedChildren) {
    if (child.type === 'type_identifier') return child.text;
    if (child.type === 'user_type') return child.text;
  }
  return null;
}

/**
 * Pull the bare type name out of an inheritance_specifier (the conformance
 * or base class listed after `:` on a class/struct/enum/actor/extension).
 * `inheritance_specifier` wraps a `user_type`.
 */
function inheritanceName(spec: TsNode): string | null {
  for (const child of spec.namedChildren) {
    if (child.type === 'user_type') return child.text;
    if (child.type === 'type_identifier') return child.text;
  }
  return null;
}

/**
 * Resolve a `call_expression`'s target to a name suitable for a `calls`
 * edge. Swift call expressions are `<callee><call_suffix>` where the
 * callee is typically a `simple_identifier` or `navigation_expression`
 * (e.g. `Foo.bar` or `obj.method`). Returns null for callees we don't
 * model (closure invocations, parenthesized expressions, etc.).
 */
function callTarget(call: TsNode): string | null {
  if (call.type !== 'call_expression') return null;
  const callee = call.namedChildren[0];
  if (!callee) return null;
  if (callee.type === 'simple_identifier') return callee.text;
  if (callee.type === 'navigation_expression') return callee.text;
  return null;
}

/**
 * Resolve the dotted import path from an `import_declaration`. The Swift
 * grammar models `import` targets as an `identifier` node that wraps one
 * or more `simple_identifier`s separated by dots in source. Concatenate
 * them with `.` so the result matches how programmers refer to the
 * imported symbol.
 *
 * Submodule import forms — `import struct Foo.Bar`, `import func Foo.bar`,
 * `import class Foo.Bar` — record the dotted path and surface the
 * specifier (struct/func/class/...) in metadata.
 */
function importPathOf(
  decl: TsNode,
): { path: string; specifier?: string } | null {
  let specifier: string | undefined;
  for (const child of decl.children) {
    if (child.isNamed) continue;
    const t = child.type;
    if (
      t === 'typealias' ||
      t === 'struct' ||
      t === 'class' ||
      t === 'enum' ||
      t === 'protocol' ||
      t === 'let' ||
      t === 'var' ||
      t === 'func'
    ) {
      specifier = t;
    }
  }
  for (const child of decl.namedChildren) {
    if (child.type === 'identifier') {
      const parts = child.namedChildren
        .filter((c) => c.type === 'simple_identifier')
        .map((c) => c.text);
      const path = parts.length > 0 ? parts.join('.') : child.text;
      return specifier ? { path, specifier } : { path };
    }
  }
  return null;
}

interface CollectCtx {
  filePath: string;
  nodes: StructureNode[];
  edges: StructureEdge[];
}

/**
 * Walk a function/method body and record every `call_expression` as a
 * `call` node plus a `calls` edge from the enclosing symbol.
 */
function collectCalls(fnNode: TsNode, fromName: string, ctx: CollectCtx): void {
  const body = fnNode.childForFieldName('body') ?? fnNode;
  const { nodes, edges, filePath } = ctx;
  for (const call of body.descendantsOfType('call_expression')) {
    const target = callTarget(call);
    if (!target) continue;
    nodes.push({
      kind: 'call',
      name: target,
      filePath,
      startLine: startLine(call),
      endLine: endLine(call),
      parent: fromName,
    });
    edges.push({ from: fromName, to: target, type: 'calls' });
  }
}

/**
 * Walk the body of a class/struct/enum/actor/extension and emit `method`
 * nodes for each function declaration found. Nested type declarations
 * inside the body are emitted as their own `class` / `interface` nodes
 * parented to the enclosing type.
 */
function collectTypeBody(
  body: TsNode | null,
  parentName: string,
  ctx: CollectCtx,
): void {
  if (!body) return;
  const { nodes, edges, filePath } = ctx;
  for (const child of body.namedChildren) {
    switch (child.type) {
      case 'function_declaration': {
        const nameNode = child.childForFieldName('name');
        const fnName = nameNode ? nameNode.text : firstSimpleIdentifier(child);
        if (!fnName) break;
        nodes.push({
          kind: 'method',
          name: fnName,
          filePath,
          startLine: startLine(child),
          endLine: endLine(child),
          parent: parentName,
        });
        edges.push({
          from: parentName,
          to: `${parentName}.${fnName}`,
          type: 'contains',
        });
        collectCalls(child, `${parentName}.${fnName}`, ctx);
        break;
      }
      case 'protocol_function_declaration': {
        const fnName = firstSimpleIdentifier(child);
        if (!fnName) break;
        nodes.push({
          kind: 'method',
          name: fnName,
          filePath,
          startLine: startLine(child),
          endLine: endLine(child),
          parent: parentName,
          metadata: { declaration: true },
        });
        edges.push({
          from: parentName,
          to: `${parentName}.${fnName}`,
          type: 'contains',
        });
        break;
      }
      case 'class_declaration': {
        collectClassDecl(child, parentName, ctx);
        break;
      }
      case 'protocol_declaration': {
        collectProtocolDecl(child, parentName, ctx);
        break;
      }
      default:
        break;
    }
  }
}

function firstSimpleIdentifier(node: TsNode): string | null {
  for (const child of node.namedChildren) {
    if (child.type === 'simple_identifier') return child.text;
  }
  return null;
}

function collectClassDecl(
  decl: TsNode,
  parentName: string,
  ctx: CollectCtx,
): void {
  const { filePath, nodes, edges } = ctx;
  const kindKw = classKindOf(decl);
  const name = classDeclName(decl);
  if (!name) return;
  // For extensions, we treat the extension target as the node name and
  // attach `shape: "extension"`. Downstream passes can dedupe extensions
  // against the original type if they choose.
  nodes.push({
    kind: 'class',
    name,
    filePath,
    startLine: startLine(decl),
    endLine: endLine(decl),
    parent: parentName,
    metadata: { shape: kindKw ?? 'class' },
  });
  edges.push({ from: parentName, to: name, type: 'contains' });

  // Inheritance / conformance — every entry becomes an `extends` edge.
  // Swift's syntax does not distinguish the base class from conformed
  // protocols, and conflating them keeps the v2 surface uniform.
  for (const child of decl.namedChildren) {
    if (child.type !== 'inheritance_specifier') continue;
    const inh = inheritanceName(child);
    if (!inh) continue;
    edges.push({ from: name, to: inh, type: 'extends' });
  }

  // The body is either `class_body` (for class/struct/actor/extension)
  // or `enum_class_body` (for enum). Either way it sits under the `body`
  // field when the grammar exposes it.
  const body =
    decl.childForFieldName('body') ??
    decl.namedChildren.find(
      (c) => c.type === 'class_body' || c.type === 'enum_class_body',
    ) ??
    null;
  collectTypeBody(body, name, ctx);
}

function collectProtocolDecl(
  decl: TsNode,
  parentName: string,
  ctx: CollectCtx,
): void {
  const { filePath, nodes, edges } = ctx;
  const nameNode =
    decl.childForFieldName('name') ??
    decl.namedChildren.find((c) => c.type === 'type_identifier');
  if (!nameNode) return;
  const name = nameNode.text;
  nodes.push({
    kind: 'interface',
    name,
    filePath,
    startLine: startLine(decl),
    endLine: endLine(decl),
    parent: parentName,
  });
  edges.push({ from: parentName, to: name, type: 'contains' });

  for (const child of decl.namedChildren) {
    if (child.type !== 'inheritance_specifier') continue;
    const inh = inheritanceName(child);
    if (!inh) continue;
    edges.push({ from: name, to: inh, type: 'extends' });
  }

  const body =
    decl.childForFieldName('body') ??
    decl.namedChildren.find((c) => c.type === 'protocol_body') ??
    null;
  collectTypeBody(body, name, ctx);
}

function collectTopLevel(
  top: TsNode,
  moduleName: string,
  ctx: CollectCtx,
): void {
  const { filePath, nodes, edges } = ctx;
  switch (top.type) {
    case 'import_declaration': {
      const imp = importPathOf(top);
      if (!imp) break;
      nodes.push({
        kind: 'import',
        name: imp.path,
        filePath,
        startLine: startLine(top),
        endLine: endLine(top),
        parent: moduleName,
        metadata: imp.specifier ? { specifier: imp.specifier } : undefined,
      });
      edges.push({
        from: moduleName,
        to: imp.path,
        type: 'imports',
        metadata: imp.specifier ? { specifier: imp.specifier } : undefined,
      });
      break;
    }
    case 'function_declaration': {
      const nameNode = top.childForFieldName('name');
      const fnName = nameNode ? nameNode.text : firstSimpleIdentifier(top);
      if (!fnName) break;
      nodes.push({
        kind: 'function',
        name: fnName,
        filePath,
        startLine: startLine(top),
        endLine: endLine(top),
        parent: moduleName,
      });
      edges.push({ from: moduleName, to: fnName, type: 'contains' });
      collectCalls(top, fnName, ctx);
      break;
    }
    case 'class_declaration': {
      collectClassDecl(top, moduleName, ctx);
      break;
    }
    case 'protocol_declaration': {
      collectProtocolDecl(top, moduleName, ctx);
      break;
    }
    default:
      break;
  }
}

export const swiftExtractor: LanguageExtractor = {
  language: 'swift',
  extensions: ['.swift'],
  parse(filePath: string, source: string): ParseResult {
    const nodes: StructureNode[] = [];
    const edges: StructureEdge[] = [];
    const parseErrors: string[] = [];

    let tree: Parser.Tree;
    try {
      tree = parseSource(source);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        filePath,
        language: 'swift',
        nodes: [],
        edges: [],
        parseErrors: [message],
      };
    }

    const root = tree.rootNode;

    if (root.hasError) {
      for (const errNode of root.descendantsOfType('ERROR')) {
        parseErrors.push(
          `parse error at ${errNode.startPosition.row + 1}:${errNode.startPosition.column + 1}`,
        );
      }
      const stack: TsNode[] = [root];
      while (stack.length > 0) {
        const n = stack.pop()!;
        if (n.isMissing) {
          parseErrors.push(
            `missing token at ${n.startPosition.row + 1}:${n.startPosition.column + 1}`,
          );
        }
        for (const c of n.children) stack.push(c);
      }
    }

    const moduleName = moduleNameFromPath(filePath);
    nodes.push({
      kind: 'module',
      name: moduleName,
      filePath,
      startLine: 1,
      endLine: Math.max(1, endLine(root)),
      metadata: { source: 'file' },
    });

    const ctx: CollectCtx = { filePath, nodes, edges };
    for (const top of root.namedChildren) {
      collectTopLevel(top, moduleName, ctx);
    }

    return { filePath, language: 'swift', nodes, edges, parseErrors };
  },
};

/**
 * Register the Swift extractor. Side-effecting import target, mirroring
 * the other language extractors.
 */
export function registerSwiftExtractor(): void {
  register(swiftExtractor);
}
