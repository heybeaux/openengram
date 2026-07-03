/**
 * Python language extractor.
 *
 * Walks a tree-sitter-python parse of a single file and projects it into the
 * language-agnostic `ParseResult` shape. Only module-level constructs and
 * one level of class members are surfaced — anything deeper is intentionally
 * dropped so the structure graph stays a coarse projection, not a mirror of
 * the AST.
 */

import Parser = require('tree-sitter');
type SyntaxNode = Parser.SyntaxNode;

import { register } from './registry';
import {
  LanguageExtractor,
  NodeKind,
  ParseResult,
  StructureEdge,
  StructureNode,
} from './types';

// A fresh Parser per call. tree-sitter's native bindings share per-process
// state across extractors — caching parsers leaks `setLanguage` between
// extractors in the same Jest worker and produces `undefined` rootNodes.
// Parser construction is cheap relative to actual parsing.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Python = require('tree-sitter-python');

function parseSource(source: string): Parser.Tree {
  // Create a fresh parser and set language immediately before parsing.
  // tree-sitter's native singleton retains the last setLanguage call
  // across spec files in the same Jest worker; always re-setting here
  // ensures correctness regardless of load order.
  const p = new Parser();
  p.setLanguage(Python);
  return p.parse(source);
}

function lineOf(node: SyntaxNode, end = false): number {
  return (end ? node.endPosition.row : node.startPosition.row) + 1;
}

/** Resolve the imported module name from `import X` / `from X import ...`. */
function moduleNameFrom(node: SyntaxNode): string {
  // For `relative_import`, concatenate dots + dotted_name (e.g. `.foo`, `..bar`).
  if (node.type === 'relative_import') {
    return node.text;
  }
  return node.text;
}

function pushNode(nodes: StructureNode[], n: StructureNode): void {
  nodes.push(n);
}

/** Collect decorator source strings from a `decorated_definition` wrapper. */
function decoratorsOf(decorated: SyntaxNode): string[] {
  const out: string[] = [];
  for (const child of decorated.namedChildren) {
    if (child.type !== 'decorator') continue;
    // Decorator text includes the leading `@`; strip it for cleaner metadata.
    const text = child.text.replace(/^@/, '').trim();
    out.push(text);
  }
  return out;
}

/** Extract the literal string contents from a `string` AST node. */
function stringLiteralValue(node: SyntaxNode): string | null {
  if (node.type !== 'string') return null;
  // tree-sitter-python exposes string_content children for the inner text.
  const parts: string[] = [];
  for (const child of node.namedChildren) {
    if (child.type === 'string_content') parts.push(child.text);
  }
  if (parts.length > 0) return parts.join('');
  // Fallback: strip the outer quotes by hand for simple cases.
  const raw = node.text;
  const m = raw.match(/^[bru]*['"]{1,3}([\s\S]*?)['"]{1,3}$/i);
  return m ? m[1] : null;
}

/** Pull names out of `__all__ = [...]` / `(...)` on the RHS. */
function namesFromAllAssignment(rhs: SyntaxNode): string[] {
  if (rhs.type !== 'list' && rhs.type !== 'tuple') return [];
  const names: string[] = [];
  for (const child of rhs.namedChildren) {
    const v = stringLiteralValue(child);
    if (v !== null) names.push(v);
  }
  return names;
}

interface ExtractCtx {
  filePath: string;
  moduleName: string;
  nodes: StructureNode[];
  edges: StructureEdge[];
}

function handleFunction(
  fn: SyntaxNode,
  parent: string | undefined,
  decorators: string[],
  ctx: ExtractCtx,
): void {
  const nameNode = fn.childForFieldName('name');
  const name = nameNode?.text ?? '<anonymous>';
  const kind: NodeKind = parent ? 'method' : 'function';
  const metadata: Record<string, unknown> = {};
  if (decorators.length > 0) metadata.decorators = decorators;

  pushNode(ctx.nodes, {
    kind,
    name,
    filePath: ctx.filePath,
    startLine: lineOf(fn),
    endLine: lineOf(fn, true),
    parent,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  });

  if (parent) {
    ctx.edges.push({ from: parent, to: name, type: 'contains' });
  } else {
    ctx.edges.push({ from: ctx.moduleName, to: name, type: 'contains' });
  }
}

function handleClass(
  cls: SyntaxNode,
  decorators: string[],
  ctx: ExtractCtx,
): void {
  const nameNode = cls.childForFieldName('name');
  const name = nameNode?.text ?? '<anonymous>';
  const metadata: Record<string, unknown> = {};
  if (decorators.length > 0) metadata.decorators = decorators;

  // Collect base classes from the `superclasses` argument list.
  const supers = cls.childForFieldName('superclasses');
  const bases: string[] = [];
  if (supers) {
    for (const arg of supers.namedChildren) {
      // Ignore keyword arguments like `metaclass=...`.
      if (arg.type === 'keyword_argument') continue;
      bases.push(arg.text);
    }
  }
  if (bases.length > 0) metadata.bases = bases;

  pushNode(ctx.nodes, {
    kind: 'class',
    name,
    filePath: ctx.filePath,
    startLine: lineOf(cls),
    endLine: lineOf(cls, true),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  });

  ctx.edges.push({ from: ctx.moduleName, to: name, type: 'contains' });
  for (const base of bases) {
    ctx.edges.push({ from: name, to: base, type: 'extends' });
  }

  // Walk the class body for methods. Methods may themselves be wrapped in
  // `decorated_definition`, so handle that case the same way we do at module
  // level.
  const body = cls.childForFieldName('body');
  if (!body) return;
  for (const stmt of body.namedChildren) {
    if (stmt.type === 'function_definition') {
      handleFunction(stmt, name, [], ctx);
    } else if (stmt.type === 'decorated_definition') {
      const def = stmt.childForFieldName('definition');
      if (def?.type === 'function_definition') {
        handleFunction(def, name, decoratorsOf(stmt), ctx);
      }
    }
  }
}

function handleImport(stmt: SyntaxNode, ctx: ExtractCtx): void {
  if (stmt.type === 'import_statement') {
    // Children are `dotted_name` or `aliased_import` nodes.
    for (const child of stmt.namedChildren) {
      let modNode: SyntaxNode | null = null;
      let alias: string | null = null;
      if (child.type === 'aliased_import') {
        modNode = child.childForFieldName('name') ?? child.namedChild(0);
        alias = child.childForFieldName('alias')?.text ?? null;
      } else if (child.type === 'dotted_name') {
        modNode = child;
      }
      if (!modNode) continue;
      const mod = modNode.text;
      const metadata: Record<string, unknown> = {};
      if (alias) metadata.alias = alias;
      pushNode(ctx.nodes, {
        kind: 'import',
        name: mod,
        filePath: ctx.filePath,
        startLine: lineOf(stmt),
        endLine: lineOf(stmt, true),
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      });
      ctx.edges.push({ from: ctx.moduleName, to: mod, type: 'imports' });
    }
    return;
  }

  if (stmt.type === 'import_from_statement') {
    const modNode = stmt.childForFieldName('module_name');
    const mod = modNode ? moduleNameFrom(modNode) : '<unknown>';
    const symbols: { name: string; alias?: string }[] = [];
    const nameNodes = stmt.childrenForFieldName('name');
    for (const n of nameNodes) {
      if (n.type === 'aliased_import') {
        const sym = n.childForFieldName('name')?.text ?? n.text;
        const alias = n.childForFieldName('alias')?.text;
        symbols.push({ name: sym, ...(alias ? { alias } : {}) });
      } else {
        symbols.push({ name: n.text });
      }
    }
    const metadata: Record<string, unknown> = { from: mod };
    if (symbols.length > 0) metadata.symbols = symbols;
    pushNode(ctx.nodes, {
      kind: 'import',
      name: mod,
      filePath: ctx.filePath,
      startLine: lineOf(stmt),
      endLine: lineOf(stmt, true),
      metadata,
    });
    ctx.edges.push({ from: ctx.moduleName, to: mod, type: 'imports' });
  }
}

/** Emit one `export` node per name in `__all__`, plus a summary on the module. */
function handleAllAssignment(rhs: SyntaxNode, stmt: SyntaxNode, ctx: ExtractCtx): void {
  const names = namesFromAllAssignment(rhs);
  for (const name of names) {
    pushNode(ctx.nodes, {
      kind: 'export',
      name,
      filePath: ctx.filePath,
      startLine: lineOf(stmt),
      endLine: lineOf(stmt, true),
      parent: ctx.moduleName,
      metadata: { source: '__all__' },
    });
  }
}

function collectParseErrors(root: SyntaxNode): string[] {
  if (!root.hasError) return [];
  const errs: string[] = [];
  const stack: SyntaxNode[] = [root];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.isError) {
      errs.push(`syntax error at line ${n.startPosition.row + 1}`);
    } else if (n.isMissing) {
      errs.push(
        `missing '${n.type}' at line ${n.startPosition.row + 1}`,
      );
    }
    for (const c of n.children) stack.push(c);
  }
  return errs;
}

export const pythonExtractor: LanguageExtractor = {
  language: 'python',
  extensions: ['.py'],
  parse(filePath: string, source: string): ParseResult {
    const tree = parseSource(source);
    const root = tree.rootNode;
    const lineCount = source.length === 0 ? 0 : source.split('\n').length;

    const moduleName = filePath;
    const nodes: StructureNode[] = [
      {
        kind: 'module',
        name: moduleName,
        filePath,
        startLine: 1,
        endLine: Math.max(1, lineCount),
      },
    ];
    const edges: StructureEdge[] = [];
    const ctx: ExtractCtx = { filePath, moduleName, nodes, edges };

    for (const stmt of root.namedChildren) {
      switch (stmt.type) {
        case 'import_statement':
        case 'import_from_statement':
          handleImport(stmt, ctx);
          break;
        case 'function_definition':
          handleFunction(stmt, undefined, [], ctx);
          break;
        case 'class_definition':
          handleClass(stmt, [], ctx);
          break;
        case 'decorated_definition': {
          const def = stmt.childForFieldName('definition');
          const decorators = decoratorsOf(stmt);
          if (def?.type === 'function_definition') {
            handleFunction(def, undefined, decorators, ctx);
          } else if (def?.type === 'class_definition') {
            handleClass(def, decorators, ctx);
          }
          break;
        }
        case 'expression_statement': {
          // Look for `__all__ = [...]` only — other assignments are ignored.
          const assign = stmt.namedChild(0);
          if (!assign || assign.type !== 'assignment') break;
          const lhs = assign.childForFieldName('left');
          const rhs = assign.childForFieldName('right');
          if (lhs?.text === '__all__' && rhs) {
            handleAllAssignment(rhs, stmt, ctx);
          }
          break;
        }
        default:
          break;
      }
    }

    return {
      filePath,
      language: 'python',
      nodes,
      edges,
      parseErrors: collectParseErrors(root),
    };
  },
};

/**
 * Install the Python extractor. Importing this module for side effects (or
 * calling this function explicitly) wires it into the registry.
 */
export function registerPythonExtractor(): void {
  register(pythonExtractor);
}
