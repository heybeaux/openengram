/**
 * Go language extractor backed by tree-sitter-go.
 *
 * Projects a Go source file onto the language-agnostic v2 structure graph:
 *   - the `package <name>` clause becomes a `module` node spanning the file
 *   - top-level `func` declarations become `function` nodes
 *   - top-level `func (recv) Name()` declarations become `method` nodes with
 *     `parent` set to the bare receiver type name
 *   - `type X struct { ... }` becomes a `class` node (Go has no class — struct
 *     is its nearest analogue for the v2 NodeKind enum)
 *   - `type X interface { ... }` becomes an `interface` node
 *   - each `import_spec` becomes an `import` node and an `imports` edge from
 *     the module to the imported path
 *   - call expressions inside top-level functions/methods become `call` nodes
 *     and `calls` edges from the enclosing function/method
 *   - struct type embedding (`type Embedder struct { Foo }`) becomes an
 *     `extends` edge from the outer type to each embedded type
 *
 * Limitations (v1, EC-11):
 *   - Go interface satisfaction is implicit and not statically resolvable
 *     without full type info. We do NOT attempt to infer `T implements I`
 *     edges; only explicit struct embedding produces `extends` edges.
 *   - Generic type parameters are not captured as separate nodes.
 *   - Calls inside non-top-level closures are still attributed to the
 *     enclosing top-level function/method.
 */

import Parser = require('tree-sitter');

import { register } from './registry';
import {
  LanguageExtractor,
  NodeKind,
  ParseResult,
  StructureEdge,
  StructureNode,
} from './types';

type TsNode = Parser.SyntaxNode;

/**
 * Parsers are expensive to construct (native binding init + language load),
 * so we lazily build one per process and reuse it. tree-sitter parsers are
 * not thread-safe, but Node is single-threaded for this code path.
 */
 
const Go = require('tree-sitter-go');

function parseSource(source: string): Parser.Tree {
  const p = new Parser();
  p.setLanguage(Go);
  return p.parse(source);
}

function isExported(name: string): boolean {
  if (!name) return false;
  const first = name[0];
  return first >= 'A' && first <= 'Z';
}

/** tree-sitter rows are 0-based; ParseResult lines are 1-based, inclusive. */
function startLine(node: TsNode): number {
  return node.startPosition.row + 1;
}
function endLine(node: TsNode): number {
  return node.endPosition.row + 1;
}

/**
 * Strip the surrounding quotes from an import path literal. tree-sitter-go
 * exposes the `path` field as the quoted `interpreted_string_literal` (or a
 * raw string literal); we want just the package path.
 */
function unquotePath(raw: string): string {
  if (raw.length >= 2) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' && last === '"') || (first === '`' && last === '`')) {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

/**
 * Resolve a receiver `parameter_list` like `(f *Foo)` or `(b bar)` to the
 * bare type name `Foo` / `bar`. Returns null for malformed receivers.
 */
function receiverTypeName(receiver: TsNode | null): string | null {
  if (!receiver) return null;
  const param = receiver.descendantsOfType('parameter_declaration')[0];
  if (!param) return null;
  // The type is the last named child of parameter_declaration; it may be a
  // `type_identifier`, a `pointer_type` wrapping one, or a `generic_type`.
  const typeNode = param.namedChildren[param.namedChildren.length - 1];
  if (!typeNode) return null;
  if (typeNode.type === 'type_identifier') return typeNode.text;
  if (typeNode.type === 'pointer_type') {
    const inner = typeNode.descendantsOfType('type_identifier')[0];
    if (inner) return inner.text;
  }
  if (typeNode.type === 'generic_type') {
    const inner = typeNode.descendantsOfType('type_identifier')[0];
    if (inner) return inner.text;
  }
  return null;
}

/**
 * Resolve a `call_expression` to a callee name suitable for `to` on an edge.
 * For `pkg.Fn(...)` returns `pkg.Fn`; for `Fn(...)` returns `Fn`. Returns null
 * when the function expression is something we don't model (e.g. a closure
 * invocation `(func(){})()`).
 */
function callTarget(call: TsNode): string | null {
  const fn = call.childForFieldName('function');
  if (!fn) return null;
  if (fn.type === 'identifier' || fn.type === 'selector_expression') {
    return fn.text;
  }
  return null;
}

/**
 * Collect the names of types embedded directly in a struct or interface
 * body. Used to emit `extends` edges. Only bare `type_identifier` embeddings
 * are captured; qualified (`pkg.Type`) embedding is reported as the full
 * text so downstream passes can resolve it.
 */
function embeddedTypeNames(typeNode: TsNode): string[] {
  const names: string[] = [];
  if (typeNode.type === 'struct_type') {
    for (const field of typeNode.descendantsOfType('field_declaration')) {
      // A field with no field_identifier and a single type child is an
      // embedded type: `type X struct { Foo }` or `{ pkg.Foo }`.
      const fieldIds = field.descendantsOfType('field_identifier');
      if (fieldIds.length > 0) continue;
      const named = field.namedChildren;
      if (named.length === 1) {
        const t = named[0];
        if (t.type === 'type_identifier') names.push(t.text);
        else if (t.type === 'qualified_type') names.push(t.text);
        else if (t.type === 'pointer_type') {
          const inner = t.descendantsOfType('type_identifier')[0];
          if (inner) names.push(inner.text);
        }
      }
    }
  } else if (typeNode.type === 'interface_type') {
    // An interface_type's direct named children are `method_elem`s and
    // `type_elem`s. A bare `type_identifier` child means interface embedding.
    for (const child of typeNode.namedChildren) {
      if (child.type === 'type_identifier') names.push(child.text);
      else if (child.type === 'qualified_type') names.push(child.text);
    }
  }
  return names;
}

export const goExtractor: LanguageExtractor = {
  language: 'go',
  extensions: ['.go'],
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
        language: 'go',
        nodes: [],
        edges: [],
        parseErrors: [message],
      };
    }

    const root = tree.rootNode;

    // Surface tree-sitter recovery errors as parse errors without aborting:
    // a partially valid file still yields useful structure.
    if (root.hasError) {
      for (const errNode of root.descendantsOfType('ERROR')) {
        parseErrors.push(
          `parse error at ${errNode.startPosition.row + 1}:${errNode.startPosition.column + 1}`,
        );
      }
      // descendantsOfType doesn't include MISSING leaves; walk for those.
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

    const packageClause = root.descendantsOfType('package_clause')[0];
    const packageId = packageClause?.descendantsOfType('package_identifier')[0];
    const moduleName = packageId?.text ?? filePath;

    const moduleNode: StructureNode = {
      kind: 'module',
      name: moduleName,
      filePath,
      startLine: 1,
      endLine: Math.max(1, endLine(root)),
      metadata: { package: moduleName },
    };
    nodes.push(moduleNode);

    function addContains(child: string): void {
      edges.push({ from: moduleName, to: child, type: 'contains' });
    }

    for (const top of root.namedChildren) {
      switch (top.type) {
        case 'import_declaration': {
          for (const spec of top.descendantsOfType('import_spec')) {
            const pathNode = spec.childForFieldName('path');
            if (!pathNode) continue;
            const importPath = unquotePath(pathNode.text);
            const aliasNode = spec.childForFieldName('name');
            const alias = aliasNode?.text;
            nodes.push({
              kind: 'import',
              name: importPath,
              filePath,
              startLine: startLine(spec),
              endLine: endLine(spec),
              parent: moduleName,
              metadata: alias ? { alias } : undefined,
            });
            edges.push({
              from: moduleName,
              to: importPath,
              type: 'imports',
              metadata: alias ? { alias } : undefined,
            });
          }
          break;
        }

        case 'type_declaration': {
          for (const spec of top.descendantsOfType('type_spec')) {
            const nameNode = spec.childForFieldName('name');
            const typeNode = spec.childForFieldName('type');
            if (!nameNode || !typeNode) continue;
            const typeName = nameNode.text;
            let kind: NodeKind | null = null;
            if (typeNode.type === 'struct_type') kind = 'class';
            else if (typeNode.type === 'interface_type') kind = 'interface';
            if (!kind) continue;
            nodes.push({
              kind,
              name: typeName,
              filePath,
              startLine: startLine(spec),
              endLine: endLine(spec),
              parent: moduleName,
              metadata: { exported: isExported(typeName) },
            });
            addContains(typeName);
            for (const embedded of embeddedTypeNames(typeNode)) {
              edges.push({ from: typeName, to: embedded, type: 'extends' });
            }
          }
          break;
        }

        case 'function_declaration': {
          const nameNode = top.childForFieldName('name');
          if (!nameNode) break;
          const fnName = nameNode.text;
          nodes.push({
            kind: 'function',
            name: fnName,
            filePath,
            startLine: startLine(top),
            endLine: endLine(top),
            parent: moduleName,
            metadata: { exported: isExported(fnName) },
          });
          addContains(fnName);
          collectCalls(top, fnName, edges, nodes, filePath);
          break;
        }

        case 'method_declaration': {
          const nameNode = top.childForFieldName('name');
          const receiver = top.childForFieldName('receiver');
          if (!nameNode) break;
          const methodName = nameNode.text;
          const recvType = receiverTypeName(receiver);
          nodes.push({
            kind: 'method',
            name: methodName,
            filePath,
            startLine: startLine(top),
            endLine: endLine(top),
            parent: recvType ?? moduleName,
            metadata: {
              exported: isExported(methodName),
              receiver: recvType ?? null,
            },
          });
          const qualified = recvType ? `${recvType}.${methodName}` : methodName;
          if (recvType) {
            edges.push({ from: recvType, to: qualified, type: 'contains' });
          } else {
            addContains(qualified);
          }
          collectCalls(top, qualified, edges, nodes, filePath);
          break;
        }

        default:
          break;
      }
    }

    return { filePath, language: 'go', nodes, edges, parseErrors };
  },
};

/**
 * Walk a function/method body and record every `call_expression` as a `call`
 * node plus a `calls` edge from the enclosing symbol. Inner closures are
 * still attributed to the outer symbol; refining this needs scope tracking
 * we deliberately defer past v1.
 */
function collectCalls(
  fnNode: TsNode,
  fromName: string,
  edges: StructureEdge[],
  nodes: StructureNode[],
  filePath: string,
): void {
  const body = fnNode.childForFieldName('body');
  if (!body) return;
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
 * Register the Go extractor. Side-effecting import target, mirroring
 * `stub.extractor.ts`.
 */
export function registerGoExtractor(): void {
  register(goExtractor);
}
