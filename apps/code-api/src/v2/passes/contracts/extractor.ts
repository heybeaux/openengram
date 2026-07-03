/**
 * Mechanical contracts extraction (engram-code v2, Pass 3).
 *
 * Reads Pass 1 structure output + source bodies and produces a list of
 * exported symbols per module, each with:
 *   - kind (function/class/interface/method/export)
 *   - signature (one-line slice from the source — first non-blank line
 *     of the symbol body, with body braces stripped)
 *
 * This is the *typed-language-first* path: TS/Go nodes are tagged
 * `metadata.exported = true` by Pass 1 extractors, so we filter on that.
 * For Python, Pass 1 emits dedicated `kind: 'export'` nodes (either from
 * `__all__` or top-level non-underscore symbols), so we accept those too.
 *
 * No LLM here. The orchestrator (in `orchestrator.ts`) layers the LLM
 * annotation pass on top.
 *
 * Spec: docs/specs/engram-code-v2.md §4.2 Pass 3.
 */

import { dirname, posix } from 'node:path';

import type { ParseResult, StructureNode } from '../../parsers/types';

/** A symbol that should appear in the module's contract table. */
export interface ContractSymbol {
  /** Symbol name (function/class/interface/etc.). */
  name: string;
  /** Coarse classification (mirrors `NodeKind`, but narrowed to exportable). */
  kind: ContractSymbolKind;
  /** Repo-relative file path the symbol was extracted from. */
  filePath: string;
  /** 1-based start line of the declaration. */
  startLine: number;
  /** First-line signature (trimmed, body stripped). May be empty if unresolved. */
  signature: string;
  /** Language tag from `ParseResult.language` (informational). */
  language: string;
  /** True when the source emits this as a `default` export. */
  isDefault?: boolean;
}

export type ContractSymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'method'
  | 'export';

/** One module-worth of contract input ready for the LLM annotation pass. */
export interface ContractModuleSymbols {
  /** Repo-relative module path, e.g. `src/v2/passes/contracts`. */
  modulePath: string;
  /** Language tag — passed through to the LLM so it can shape the prose. */
  language: string;
  /** Exported symbols, ordered alphabetically by name. */
  symbols: ContractSymbol[];
}

/**
 * Given a flat list of Pass 1 nodes + a per-file source resolver, group
 * exported symbols by module.
 *
 * `resolveSource(filePath)` returns the file body so we can slice signatures.
 * Returning `undefined` means we still emit the symbol but with an empty
 * signature — the LLM pass can still describe what it can.
 */
export function buildContractsFromStructure(
  nodes: StructureNode[],
  language: string,
  resolveSource: (filePath: string) => string | undefined,
): ContractModuleSymbols[] {
  const byModule = new Map<string, ContractSymbol[]>();

  for (const node of nodes) {
    if (!node.filePath) continue;
    if (!isExportable(node)) continue;

    const modulePath = posix.normalize(dirname(node.filePath));
    const signature = sliceSignature(resolveSource(node.filePath), node);
    const list = byModule.get(modulePath) ?? [];
    list.push({
      name: node.name,
      kind: node.kind as ContractSymbolKind,
      filePath: node.filePath,
      startLine: node.startLine,
      signature,
      language,
      isDefault: pickBool(node.metadata, 'default'),
    });
    byModule.set(modulePath, list);
  }

  const modules: ContractModuleSymbols[] = [];
  for (const [modulePath, symbols] of byModule) {
    symbols.sort((a, b) => a.name.localeCompare(b.name));
    modules.push({ modulePath, language, symbols: dedupeByName(symbols) });
  }
  modules.sort((a, b) => a.modulePath.localeCompare(b.modulePath));
  return modules;
}

/**
 * `node` is exportable if it carries `metadata.exported === true` OR it is
 * a Python-style `export` node. We *deliberately* don't treat raw
 * `export` nodes from TS as duplicates of the function/class they wrap —
 * the TS extractor emits the function/class with `exported:true` AND a
 * separate `export` node. We pick the typed kind (function/class/...) so
 * we can present a proper signature, and dedupe by name afterward.
 */
function isExportable(node: StructureNode): boolean {
  const kind = node.kind;
  if (kind === 'export') return true; // Python __all__ or TS aggregate exports
  if (kind === 'function' || kind === 'class' || kind === 'interface' || kind === 'method') {
    return pickBool(node.metadata, 'exported') === true;
  }
  return false;
}

function pickBool(meta: Record<string, unknown> | undefined, key: string): boolean | undefined {
  if (!meta) return undefined;
  const v = meta[key];
  return typeof v === 'boolean' ? v : undefined;
}

/**
 * Prefer the typed node (function/class/interface/method) over a bare
 * `export` node when both exist for the same name. The typed one has a
 * real signature; the bare export is just a name advertisement.
 */
function dedupeByName(symbols: ContractSymbol[]): ContractSymbol[] {
  const byName = new Map<string, ContractSymbol>();
  for (const sym of symbols) {
    const existing = byName.get(sym.name);
    if (!existing) {
      byName.set(sym.name, sym);
      continue;
    }
    // Prefer the symbol with a non-empty signature; tie-break on richer kind.
    const existingScore = scoreSymbol(existing);
    const candidateScore = scoreSymbol(sym);
    if (candidateScore > existingScore) byName.set(sym.name, sym);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function scoreSymbol(s: ContractSymbol): number {
  let n = 0;
  if (s.signature.length > 0) n += 10;
  if (s.kind !== 'export') n += 5;
  return n;
}

/**
 * Pull the first meaningful line of the symbol declaration out of the
 * source. We want the function/class signature, not the body.
 *
 * Heuristic: take the first non-blank line in `[startLine, endLine]`, then
 * trim trailing `{`, `:`, `=>` and anything after them. If the signature
 * looks split (e.g. multi-line generics), we join through to the first
 * `{`/`=>` so the LLM sees the full type.
 */
export function sliceSignature(
  source: string | undefined,
  node: Pick<StructureNode, 'startLine' | 'endLine'>,
): string {
  if (!source) return '';
  const lines = source.split(/\r?\n/);
  const start = Math.max(0, node.startLine - 1);
  const end = Math.min(lines.length, node.endLine);
  if (start >= lines.length) return '';

  let buf = '';
  for (let i = start; i < end; i++) {
    const raw = lines[i];
    if (!raw) continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    buf += (buf.length > 0 ? ' ' : '') + trimmed;
    if (/[{=>]\s*$/.test(trimmed) || /\b(pass|\.\.\.)\s*$/.test(trimmed)) break;
    // 3 lines is plenty for any reasonable signature.
    if (i - start >= 2) break;
  }

  // Arrow function: keep up to and including the `=>` so the return type shows.
  // We only honour `=>` when no body brace precedes it; a brace before `=>`
  // means the line is `function foo(): { x: 1 } {` — strip at the brace instead.
  const braceIdx = buf.indexOf('{');
  const arrowIdx = buf.indexOf('=>');
  if (arrowIdx >= 0 && (braceIdx < 0 || arrowIdx < braceIdx)) {
    buf = buf.slice(0, arrowIdx + 2);
  } else if (braceIdx >= 0) {
    buf = buf.slice(0, braceIdx);
  }

  return buf.trim();
}
