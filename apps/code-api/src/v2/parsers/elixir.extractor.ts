/**
 * Elixir language extractor backed by tree-sitter-elixir.
 *
 * Projects an Elixir source file onto the language-agnostic v2 structure
 * graph. Elixir's grammar models almost every construct as a generic
 * `call` node — `defmodule`, `def`, `import`, `use`, etc. all share the
 * same shape: an `identifier` (the macro name) plus an `arguments` node
 * and an optional `do_block`. We walk these by inspecting the leading
 * identifier and routing accordingly.
 *
 * Mapping:
 *   - `defmodule Foo do ... end` becomes a `module` node spanning the call.
 *     The first source file may contain multiple `defmodule`s; the first
 *     one is treated as the file's primary module for `from`/`parent`
 *     attribution.
 *   - `def`, `defp`, `defmacro`, `defmacrop`, `defguard`, `defguardp`,
 *     `defdelegate`, `defcallback`, `defmacrocallback` become `function`
 *     nodes when at module top level (with `parent` set to the enclosing
 *     module). The Elixir grammar has no separate "method" — module
 *     functions are functions.
 *   - `defstruct`, `defprotocol`, `defimpl`, `defexception` become `class`
 *     nodes (Elixir has no class — these are the nearest analogues for
 *     the v2 NodeKind enum and downstream passes treat them uniformly).
 *   - `alias`, `import`, `require`, `use` at module top level become
 *     `import` nodes with `imports` edges from the module.
 *   - Calls inside function bodies become `call` nodes with `calls` edges
 *     from the enclosing function. Dotted calls (`Mod.fn(...)`) are
 *     recorded with their full qualified text.
 *
 * Limitations (v1):
 *   - Nested module definitions are flattened: an inner `defmodule` is
 *     emitted as its own module node but does not nest under the outer
 *     one in the structure graph (downstream passes can resolve via the
 *     dotted module name).
 *   - Function clause heads (multiple `def foo` for the same arity/name)
 *     each produce their own function node — we deliberately do not
 *     deduplicate, since each clause carries distinct line ranges.
 *   - Pipe expressions (`x |> f |> g`) record only their top-level call
 *     target; we do not unfold the pipeline into separate `calls` edges.
 */

import Parser = require('tree-sitter');

import { register } from './registry';
import {
  LanguageExtractor,
  ParseResult,
  StructureEdge,
  StructureNode,
} from './types';

type TsNode = Parser.SyntaxNode;

 
const Elixir = require('tree-sitter-elixir');

function parseSource(source: string): Parser.Tree {
  // Fresh parser per call: tree-sitter's native singleton retains the
  // last `setLanguage` call across spec sandboxes in the same worker.
  const p = new Parser();
  p.setLanguage(Elixir);
  return p.parse(source);
}

function startLine(node: TsNode): number {
  return node.startPosition.row + 1;
}
function endLine(node: TsNode): number {
  return node.endPosition.row + 1;
}

/** Identifier macros that introduce a function-like binding. */
const FUNCTION_DEFINERS = new Set([
  'def',
  'defp',
  'defmacro',
  'defmacrop',
  'defguard',
  'defguardp',
  'defdelegate',
  'defcallback',
  'defmacrocallback',
]);

/** Identifier macros that introduce a class-like binding. */
const CLASS_DEFINERS = new Set([
  'defstruct',
  'defprotocol',
  'defimpl',
  'defexception',
]);

/** Identifier macros that introduce an import-style dependency. */
const IMPORT_DEFINERS = new Set(['alias', 'import', 'require', 'use']);

/**
 * If `node` is a `call` whose target is a bare `identifier`, return that
 * identifier's text. Used to classify Elixir macros (`def`, `alias`, ...).
 */
function macroName(call: TsNode): string | null {
  if (call.type !== 'call') return null;
  const target = call.childForFieldName('target');
  if (target && target.type === 'identifier') return target.text;
  // Field name may be absent on some grammar versions — fall back to the
  // first named child.
  const first = call.namedChildren[0];
  if (first && first.type === 'identifier') return first.text;
  return null;
}

/**
 * Resolve the `do_block` child of a call, or null when absent.
 */
function doBlockOf(call: TsNode): TsNode | null {
  for (const c of call.namedChildren) {
    if (c.type === 'do_block') return c;
  }
  return null;
}

/**
 * Resolve the `arguments` child of a call, or null when absent.
 */
function argumentsOf(call: TsNode): TsNode | null {
  for (const c of call.namedChildren) {
    if (c.type === 'arguments') return c;
  }
  return null;
}

/**
 * Resolve the dotted module name from a `defmodule X.Y.Z do ... end` call's
 * arguments. Returns the alias text (e.g. `MyApp.Foo`) or null.
 */
function moduleNameFromArgs(args: TsNode | null): string | null {
  if (!args) return null;
  for (const child of args.namedChildren) {
    if (child.type === 'alias') return child.text;
  }
  return null;
}

/**
 * Resolve the function/macro name from a `def`-family call's first
 * argument. The first argument may be:
 *   - `call`: standard `name(args)` head — name is the inner identifier
 *   - `identifier`: zero-arity head like `def bar, do: 1`
 *   - `binary_operator`: `name(args) when guard` — recurse into the left
 *     side, which is itself a `call`
 * Returns null when nothing recognizable is found.
 */
function functionNameFromArgs(args: TsNode | null): string | null {
  if (!args) return null;
  const first = args.namedChildren[0];
  if (!first) return null;
  return functionNameFromHead(first);
}

function functionNameFromHead(head: TsNode): string | null {
  if (head.type === 'identifier') return head.text;
  if (head.type === 'call') {
    const inner = head.namedChildren[0];
    if (inner && inner.type === 'identifier') return inner.text;
    // Operator definitions: `def a + b`, `def @attr`, etc. — the head's
    // text is the cleanest representation we have.
    return head.text;
  }
  if (head.type === 'binary_operator') {
    // `name(args) when guard` — the left side is the head.
    const left = head.namedChildren[0];
    if (left) return functionNameFromHead(left);
  }
  // Unrecognized: fall back to a trimmed text snapshot rather than null
  // so downstream passes still see *something* for malformed defs.
  const text = head.text.split('\n')[0].trim();
  return text.length > 0 ? text : null;
}

/**
 * Resolve an import-style dependency name from a call's arguments. For
 * `alias Foo.Bar` / `import Foo` / `use GenServer`, the first argument is
 * an `alias` (or sometimes an `identifier` for nonstandard usage).
 */
function importNameFromArgs(args: TsNode | null): string | null {
  if (!args) return null;
  const first = args.namedChildren[0];
  if (!first) return null;
  if (first.type === 'alias') return first.text;
  if (first.type === 'identifier') return first.text;
  // `alias Foo, as: Bar` — first child is still the alias node.
  return first.text;
}

/**
 * Resolve a call's target as a string suitable for `to` on a `calls` edge.
 * For `helper(x)` returns `helper`; for `Mod.fn(...)` returns `Mod.fn`.
 * Returns null when the target is something we don't model (e.g. an
 * anonymous function invocation).
 */
function callTarget(call: TsNode): string | null {
  if (call.type !== 'call') return null;
  // Prefer the `target` field when the grammar exposes it.
  const target = call.childForFieldName('target');
  const node = target ?? call.namedChildren[0];
  if (!node) return null;
  if (node.type === 'identifier') return node.text;
  if (node.type === 'dot') return node.text;
  return null;
}

interface ExtractCtx {
  filePath: string;
  primaryModule: string;
  nodes: StructureNode[];
  edges: StructureEdge[];
}

/**
 * Walk a body (the `do_block` of a defmodule) and emit nodes/edges for
 * each module-level construct.
 */
function walkModuleBody(
  body: TsNode,
  moduleName: string,
  ctx: ExtractCtx,
): void {
  for (const stmt of body.namedChildren) {
    if (stmt.type !== 'call') continue;
    const macro = macroName(stmt);
    if (!macro) continue;

    if (IMPORT_DEFINERS.has(macro)) {
      handleImport(stmt, macro, moduleName, ctx);
      continue;
    }

    if (FUNCTION_DEFINERS.has(macro)) {
      handleFunction(stmt, macro, moduleName, ctx);
      continue;
    }

    if (CLASS_DEFINERS.has(macro)) {
      handleClassLike(stmt, macro, moduleName, ctx);
      continue;
    }

    // Nested `defmodule` inside a module body: emit as its own module and
    // recurse. The outer module does not "contain" the nested module in
    // the edge sense; downstream passes can infer ownership from the
    // dotted name.
    if (macro === 'defmodule') {
      handleModule(stmt, ctx);
      continue;
    }
  }
}

function handleModule(call: TsNode, ctx: ExtractCtx): void {
  const args = argumentsOf(call);
  const name = moduleNameFromArgs(args) ?? ctx.filePath;
  ctx.nodes.push({
    kind: 'module',
    name,
    filePath: ctx.filePath,
    startLine: startLine(call),
    endLine: endLine(call),
  });
  const body = doBlockOf(call);
  if (body) walkModuleBody(body, name, ctx);
}

function handleImport(
  call: TsNode,
  macro: string,
  moduleName: string,
  ctx: ExtractCtx,
): void {
  const args = argumentsOf(call);
  const name = importNameFromArgs(args);
  if (!name) return;
  ctx.nodes.push({
    kind: 'import',
    name,
    filePath: ctx.filePath,
    startLine: startLine(call),
    endLine: endLine(call),
    parent: moduleName,
    metadata: { macro },
  });
  ctx.edges.push({
    from: moduleName,
    to: name,
    type: 'imports',
    metadata: { macro },
  });
}

function handleFunction(
  call: TsNode,
  macro: string,
  moduleName: string,
  ctx: ExtractCtx,
): void {
  const args = argumentsOf(call);
  const name = functionNameFromArgs(args);
  if (!name) return;
  const visibility =
    macro === 'defp' || macro === 'defmacrop' || macro === 'defguardp'
      ? 'private'
      : 'public';
  ctx.nodes.push({
    kind: 'function',
    name,
    filePath: ctx.filePath,
    startLine: startLine(call),
    endLine: endLine(call),
    parent: moduleName,
    metadata: { macro, visibility },
  });
  const qualified = `${moduleName}.${name}`;
  ctx.edges.push({ from: moduleName, to: name, type: 'contains' });
  // Walk the function body (if any) for calls. defdelegate / callbacks
  // typically have no `do_block`.
  const body = doBlockOf(call);
  if (body) collectCalls(body, qualified, ctx);
}

/**
 * Pull the value of a `for:` keyword argument from a call's arguments,
 * if present. Used by `defimpl Proto, for: T` to recover the implemented
 * target type.
 */
function forKeywordOfArgs(args: TsNode | null): string | null {
  if (!args) return null;
  for (const child of args.namedChildren) {
    if (child.type !== 'keywords') continue;
    for (const pair of child.namedChildren) {
      if (pair.type !== 'pair') continue;
      const key = pair.namedChildren[0];
      const value = pair.namedChildren[1];
      if (!key || !value) continue;
      // The `keyword` node text includes the trailing colon and space,
      // e.g. `"for: "`.
      const keyText = key.text.replace(/:\s*$/, '').trim();
      if (keyText === 'for') return value.text;
    }
  }
  return null;
}

function handleClassLike(
  call: TsNode,
  macro: string,
  moduleName: string,
  ctx: ExtractCtx,
): void {
  // Naming rules:
  //   - `defstruct [...]` is anonymous within its module — use the
  //     enclosing module name as the node name.
  //   - `defexception [...]` is similar in shape and also anonymous.
  //   - `defprotocol Proto do ... end` — the first alias argument is the
  //     protocol name.
  //   - `defimpl Proto, for: T do ... end` — Elixir canonicalizes the
  //     resulting module as `Proto.T`, so use that.
  const args = argumentsOf(call);
  let name: string | null = null;
  let protoForImpl: string | null = null;
  if (macro === 'defstruct' || macro === 'defexception') {
    name = moduleName;
  } else if (macro === 'defimpl') {
    protoForImpl = moduleNameFromArgs(args);
    const forType = forKeywordOfArgs(args);
    if (protoForImpl && forType) name = `${protoForImpl}.${forType}`;
    else name = protoForImpl ?? moduleName;
  } else {
    name = moduleNameFromArgs(args) ?? moduleName;
  }
  if (!name) return;
  ctx.nodes.push({
    kind: 'class',
    name,
    filePath: ctx.filePath,
    startLine: startLine(call),
    endLine: endLine(call),
    parent: moduleName,
    metadata: { macro },
  });
  ctx.edges.push({ from: moduleName, to: name, type: 'contains' });
  // `defimpl Proto, for: T` — record the implemented protocol as an
  // `extends` edge so downstream passes can see the relationship.
  if (macro === 'defimpl' && protoForImpl) {
    ctx.edges.push({ from: name, to: protoForImpl, type: 'extends' });
  }
  // Walk the body for nested `def`s (e.g. protocol implementations).
  const body = doBlockOf(call);
  if (body) walkModuleBody(body, name, ctx);
}

/**
 * Walk a function body and emit `call` nodes / `calls` edges for every
 * call expression encountered. Calls that target a `def`-family macro are
 * skipped — those are definitions, not invocations.
 */
function collectCalls(body: TsNode, fromName: string, ctx: ExtractCtx): void {
  const stack: TsNode[] = [body];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.type === 'call') {
      const macro = macroName(n);
      // Skip pseudo-calls that are actually definition macros.
      const isDefinitionMacro =
        macro !== null &&
        (FUNCTION_DEFINERS.has(macro) ||
          CLASS_DEFINERS.has(macro) ||
          IMPORT_DEFINERS.has(macro) ||
          macro === 'defmodule');
      if (!isDefinitionMacro) {
        const target = callTarget(n);
        if (target) {
          ctx.nodes.push({
            kind: 'call',
            name: target,
            filePath: ctx.filePath,
            startLine: startLine(n),
            endLine: endLine(n),
            parent: fromName,
          });
          ctx.edges.push({ from: fromName, to: target, type: 'calls' });
        }
      }
    }
    for (const c of n.namedChildren) stack.push(c);
  }
}

export const elixirExtractor: LanguageExtractor = {
  language: 'elixir',
  extensions: ['.ex', '.exs'],
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
        language: 'elixir',
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

    // Determine a primary module name for the file. If the file is a
    // single top-level `defmodule`, use its dotted name; otherwise fall
    // back to the file path so script files (.exs) without a module
    // still produce a coherent structure root.
    let primaryModule: string | null = null;
    for (const top of root.namedChildren) {
      if (top.type === 'call' && macroName(top) === 'defmodule') {
        primaryModule = moduleNameFromArgs(argumentsOf(top));
        if (primaryModule) break;
      }
    }
    const fileModule = primaryModule ?? filePath;

    const ctx: ExtractCtx = {
      filePath,
      primaryModule: fileModule,
      nodes,
      edges,
    };

    // Always emit a file-level module node spanning the whole file so the
    // structure graph has a stable root even for script files with
    // bare top-level expressions.
    const lineCount = source.length === 0 ? 0 : source.split('\n').length;
    nodes.push({
      kind: 'module',
      name: fileModule,
      filePath,
      startLine: 1,
      endLine: Math.max(1, lineCount),
    });

    for (const top of root.namedChildren) {
      if (top.type !== 'call') continue;
      const macro = macroName(top);
      if (!macro) continue;

      if (macro === 'defmodule') {
        const args = argumentsOf(top);
        const modName = moduleNameFromArgs(args) ?? fileModule;
        // If this is the primary defmodule whose name matches the file
        // module we already pushed, skip the duplicate node and just
        // walk the body. Otherwise emit a fresh module node.
        if (modName !== fileModule) {
          nodes.push({
            kind: 'module',
            name: modName,
            filePath,
            startLine: startLine(top),
            endLine: endLine(top),
          });
        }
        const body = doBlockOf(top);
        if (body) walkModuleBody(body, modName, ctx);
        continue;
      }

      // Top-level constructs outside any defmodule (common in .exs
      // scripts): attribute them to the file module.
      if (IMPORT_DEFINERS.has(macro)) {
        handleImport(top, macro, fileModule, ctx);
      } else if (FUNCTION_DEFINERS.has(macro)) {
        handleFunction(top, macro, fileModule, ctx);
      } else if (CLASS_DEFINERS.has(macro)) {
        handleClassLike(top, macro, fileModule, ctx);
      }
    }

    return { filePath, language: 'elixir', nodes, edges, parseErrors };
  },
};

/**
 * Register the Elixir extractor. Side-effecting import target, mirroring
 * the Go and Python extractors.
 */
export function registerElixirExtractor(): void {
  register(elixirExtractor);
}
