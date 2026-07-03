/**
 * Rust language extractor backed by tree-sitter-rust.
 *
 * Projects a Rust source file onto the language-agnostic v2 structure graph:
 *   - the file itself becomes a `module` node spanning the file (named after
 *     the file stem; Rust modules are file-based by default and the actual
 *     module path is determined by `mod` declarations elsewhere)
 *   - top-level `fn` items become `function` nodes
 *   - `struct` / `enum` / `union` items become `class` nodes
 *   - `trait` items become `interface` nodes
 *   - `mod foo { ... }` items become `module` nodes nested under the file
 *   - `impl T { ... }` and `impl Trait for T { ... }` blocks emit `method`
 *     nodes for each contained `fn`, with `parent` set to the bare type name.
 *     `impl Trait for T` additionally emits an `extends` edge from `T` to
 *     `Trait` (Rust's nearest analogue to "implements")
 *   - `use` declarations become `import` nodes and `imports` edges; each
 *     leaf path in a `use a::{b, c as d}` expands to its own import
 *   - call expressions inside fn bodies become `call` nodes and `calls` edges
 *     from the enclosing fn (macro invocations are intentionally NOT included
 *     — they're a separate analysis axis)
 *
 * Limitations (v1, EC-54):
 *   - Generic parameters / lifetimes / where-clauses are not captured as
 *     separate nodes.
 *   - `impl<T>` blocks attribute methods to the bare type name; generic
 *     instantiations are not distinguished.
 *   - Calls inside nested closures are still attributed to the enclosing
 *     top-level fn or method.
 *   - `mod foo;` (file-reference form, no body) is recorded as a child
 *     module node but produces no cross-file resolution.
 */

import { basename, extname } from 'node:path';

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

const Rust = require('tree-sitter-rust');

function parseSource(source: string): Parser.Tree {
  const p = new Parser();
  p.setLanguage(Rust);
  return p.parse(source);
}

/** tree-sitter rows are 0-based; ParseResult lines are 1-based, inclusive. */
function startLine(node: TsNode): number {
  return node.startPosition.row + 1;
}
function endLine(node: TsNode): number {
  return node.endPosition.row + 1;
}

/**
 * Module name derived from the file stem. Rust's actual module path comes
 * from `mod` declarations in parent files, which we can't resolve at the
 * single-file granularity this extractor runs at.
 */
function moduleNameFromPath(filePath: string): string {
  const base = basename(filePath);
  const ext = extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

/**
 * Resolve a `call_expression`'s callee to a name suitable for an edge `to`.
 * Returns null for callees we don't model (e.g. invoking an arbitrary
 * expression, an index, a parenthesized closure).
 */
function callTarget(call: TsNode): string | null {
  const fn = call.childForFieldName('function');
  if (!fn) return null;
  if (
    fn.type === 'identifier' ||
    fn.type === 'scoped_identifier' ||
    fn.type === 'field_expression'
  ) {
    return fn.text;
  }
  // generic_function is `foo::<T>` — strip the turbofish for a clean name.
  if (fn.type === 'generic_function') {
    const inner = fn.childForFieldName('function');
    if (inner) return inner.text;
  }
  return null;
}

/**
 * Expand a single `use_declaration` subtree into a list of fully-qualified
 * import paths and their optional aliases.
 *
 * Handles the common forms:
 *   use a::b::c;                  -> [{ path: "a::b::c" }]
 *   use a::b::c as d;             -> [{ path: "a::b::c", alias: "d" }]
 *   use a::b::{c, d as e};        -> [{ path: "a::b::c" }, { path: "a::b::d", alias: "e" }]
 *   use a::b::*;                  -> [{ path: "a::b::*" }]
 *   use a::b::{c::{d, e}};        -> recurses
 */
function expandUse(
  node: TsNode,
  prefix: string,
): Array<{ path: string; alias?: string }> {
  const out: Array<{ path: string; alias?: string }> = [];

  function join(p: string, leaf: string): string {
    return p ? `${p}::${leaf}` : leaf;
  }

  switch (node.type) {
    case 'identifier':
    case 'self':
    case 'super':
    case 'crate':
    case 'metavariable': {
      out.push({ path: join(prefix, node.text) });
      break;
    }
    case 'scoped_identifier': {
      out.push({ path: join(prefix, node.text) });
      break;
    }
    case 'use_as_clause': {
      const pathNode = node.childForFieldName('path');
      const aliasNode = node.childForFieldName('alias');
      const path = pathNode ? join(prefix, pathNode.text) : prefix;
      out.push({ path, alias: aliasNode?.text });
      break;
    }
    case 'use_wildcard': {
      // The wildcard's children include the scope identifier and the `*`.
      const scope = node.namedChildren.find(
        (c) => c.type === 'scoped_identifier' || c.type === 'identifier',
      );
      const base = scope ? join(prefix, scope.text) : prefix;
      out.push({ path: `${base}::*` });
      break;
    }
    case 'scoped_use_list': {
      const pathNode = node.childForFieldName('path');
      const listNode = node.childForFieldName('list');
      const nextPrefix = pathNode ? join(prefix, pathNode.text) : prefix;
      if (listNode) {
        for (const item of listNode.namedChildren) {
          out.push(...expandUse(item, nextPrefix));
        }
      }
      break;
    }
    case 'use_list': {
      for (const item of node.namedChildren) {
        out.push(...expandUse(item, prefix));
      }
      break;
    }
    default: {
      // Unknown leaf — fall back to raw text so downstream passes still see
      // something rather than silently dropping the import.
      const text = node.text;
      if (text) out.push({ path: join(prefix, text) });
      break;
    }
  }
  return out;
}

/**
 * Bare type name out of an `impl` block's `type` field. The field can be a
 * `type_identifier` (`impl Foo`), a `generic_type` (`impl Foo<T>`), a
 * `reference_type` (`impl &Foo`), or a `scoped_type_identifier`
 * (`impl crate::Foo`). We strip to the rightmost `type_identifier`.
 */
function bareTypeName(typeNode: TsNode | null): string | null {
  if (!typeNode) return null;
  if (typeNode.type === 'type_identifier') return typeNode.text;
  const ids = typeNode.descendantsOfType('type_identifier');
  if (ids.length > 0) return ids[ids.length - 1].text;
  return typeNode.text || null;
}

function hasPubVisibility(item: TsNode): boolean {
  for (const child of item.children) {
    if (child.type === 'visibility_modifier' && child.text.startsWith('pub')) {
      return true;
    }
  }
  return false;
}

interface CollectCtx {
  filePath: string;
  nodes: StructureNode[];
  edges: StructureEdge[];
}

/**
 * Recursively walk a declaration list (module body or file root) and emit
 * structure nodes/edges. `parentName` is the enclosing container (file
 * module name or nested `mod` name).
 */
function collectDecls(
  items: TsNode[],
  parentName: string,
  ctx: CollectCtx,
): void {
  const { filePath, nodes, edges } = ctx;

  function addContains(child: string): void {
    edges.push({ from: parentName, to: child, type: 'contains' });
  }

  for (const item of items) {
    switch (item.type) {
      case 'use_declaration': {
        // The use tree is the single named child (identifier, scoped_*,
        // scoped_use_list, use_wildcard, or use_as_clause).
        const treeRoot = item.namedChildren.find(
          (c) => c.type !== 'visibility_modifier',
        );
        if (!treeRoot) break;
        const imports = expandUse(treeRoot, '');
        for (const imp of imports) {
          nodes.push({
            kind: 'import',
            name: imp.path,
            filePath,
            startLine: startLine(item),
            endLine: endLine(item),
            parent: parentName,
            metadata: imp.alias ? { alias: imp.alias } : undefined,
          });
          edges.push({
            from: parentName,
            to: imp.path,
            type: 'imports',
            metadata: imp.alias ? { alias: imp.alias } : undefined,
          });
        }
        break;
      }

      case 'mod_item': {
        const nameNode = item.childForFieldName('name');
        if (!nameNode) break;
        const modName = nameNode.text;
        nodes.push({
          kind: 'module',
          name: modName,
          filePath,
          startLine: startLine(item),
          endLine: endLine(item),
          parent: parentName,
          metadata: { exported: hasPubVisibility(item) },
        });
        addContains(modName);
        const body = item.childForFieldName('body');
        if (body) {
          collectDecls(body.namedChildren, modName, ctx);
        }
        break;
      }

      case 'function_item': {
        const nameNode = item.childForFieldName('name');
        if (!nameNode) break;
        const fnName = nameNode.text;
        nodes.push({
          kind: 'function',
          name: fnName,
          filePath,
          startLine: startLine(item),
          endLine: endLine(item),
          parent: parentName,
          metadata: { exported: hasPubVisibility(item) },
        });
        addContains(fnName);
        collectCalls(item, fnName, ctx);
        break;
      }

      case 'struct_item':
      case 'union_item':
      case 'enum_item': {
        const nameNode = item.childForFieldName('name');
        if (!nameNode) break;
        const typeName = nameNode.text;
        const kind: NodeKind = 'class';
        nodes.push({
          kind,
          name: typeName,
          filePath,
          startLine: startLine(item),
          endLine: endLine(item),
          parent: parentName,
          metadata: {
            exported: hasPubVisibility(item),
            shape:
              item.type === 'struct_item'
                ? 'struct'
                : item.type === 'enum_item'
                  ? 'enum'
                  : 'union',
          },
        });
        addContains(typeName);
        break;
      }

      case 'trait_item': {
        const nameNode = item.childForFieldName('name');
        if (!nameNode) break;
        const traitName = nameNode.text;
        nodes.push({
          kind: 'interface',
          name: traitName,
          filePath,
          startLine: startLine(item),
          endLine: endLine(item),
          parent: parentName,
          metadata: { exported: hasPubVisibility(item) },
        });
        addContains(traitName);
        // Methods declared in a trait body — emit them as methods so the
        // surface matches what an `impl` block would produce.
        const body = item.childForFieldName('body');
        if (body) {
          for (const child of body.namedChildren) {
            if (
              child.type === 'function_item' ||
              child.type === 'function_signature_item'
            ) {
              const fnName = child.childForFieldName('name')?.text;
              if (!fnName) continue;
              nodes.push({
                kind: 'method',
                name: fnName,
                filePath,
                startLine: startLine(child),
                endLine: endLine(child),
                parent: traitName,
                metadata: { trait: traitName, declaration: true },
              });
              edges.push({
                from: traitName,
                to: `${traitName}.${fnName}`,
                type: 'contains',
              });
            }
          }
        }
        break;
      }

      case 'impl_item': {
        const typeNode = item.childForFieldName('type');
        const traitNode = item.childForFieldName('trait');
        const typeName = bareTypeName(typeNode);
        const traitName = bareTypeName(traitNode);
        if (!typeName) break;
        if (traitName) {
          edges.push({
            from: typeName,
            to: traitName,
            type: 'extends',
            metadata: { kind: 'impl_trait' },
          });
        }
        const body = item.childForFieldName('body');
        if (body) {
          for (const child of body.namedChildren) {
            if (child.type !== 'function_item') continue;
            const fnName = child.childForFieldName('name')?.text;
            if (!fnName) continue;
            nodes.push({
              kind: 'method',
              name: fnName,
              filePath,
              startLine: startLine(child),
              endLine: endLine(child),
              parent: typeName,
              metadata: {
                exported: hasPubVisibility(child),
                trait: traitName ?? null,
              },
            });
            const qualified = `${typeName}.${fnName}`;
            edges.push({ from: typeName, to: qualified, type: 'contains' });
            collectCalls(child, qualified, ctx);
          }
        }
        break;
      }

      default:
        break;
    }
  }
}

/**
 * Walk a function/method body and record every `call_expression` as a `call`
 * node plus a `calls` edge from the enclosing symbol. Macros are excluded.
 */
function collectCalls(fnNode: TsNode, fromName: string, ctx: CollectCtx): void {
  const body = fnNode.childForFieldName('body');
  if (!body) return;
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

export const rustExtractor: LanguageExtractor = {
  language: 'rust',
  extensions: ['.rs'],
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
        language: 'rust',
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

    collectDecls(root.namedChildren, moduleName, { filePath, nodes, edges });

    return { filePath, language: 'rust', nodes, edges, parseErrors };
  },
};

/**
 * Register the Rust extractor. Side-effecting import target, mirroring
 * the other language extractors.
 */
export function registerRustExtractor(): void {
  register(rustExtractor);
}
