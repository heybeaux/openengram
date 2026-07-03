/**
 * Structure pass orchestrator (engram-code v2, Pass 1).
 *
 * Walks a repository, parses every supported file through the language
 * harness, and aggregates the per-file `nodes` / `edges` into a single
 * repo-level structure graph. The output is intentionally pre-deduplicated
 * so downstream persistence can treat it as a set.
 *
 * No I/O happens here beyond the walker + parser harness — persistence is
 * a separate step (`persist.ts`) so this module can be exercised in tests
 * without touching the database.
 */

import { relative } from 'node:path';

import { parseFile } from '../../parsers/harness';
import type {
  ParseResult,
  StructureEdge,
  StructureNode,
} from '../../parsers/types';
import { walkRepo, type WalkOptions } from './walker';

/**
 * Aggregated structure-pass output for a single repository run.
 */
export interface StructurePassResult {
  /** Repo identifier as supplied by the caller (typically a `Project.id`). */
  repoId: string;
  /** Absolute path to the repo root that was walked. */
  repoPath: string;
  /** Deduplicated structure nodes across every parsed file. */
  nodes: StructureNode[];
  /** Deduplicated structure edges across every parsed file. */
  edges: StructureEdge[];
  /** Number of files yielded by the walker. */
  filesWalked: number;
  /** Number of files that produced a non-null parse result. */
  filesParsed: number;
  /**
   * Files where the extractor reported one or more `parseErrors`.
   * Each entry's `errors` array is the raw extractor output.
   *
   * `language` is the logical language id from {@link ParseResult.language}
   * (e.g. `typescript`, `python`) so CLI callers can attribute the failure to
   * a specific extractor without re-deriving it from the file extension.
   */
  fileErrors: Array<{ filePath: string; language: string; errors: string[] }>;
}

/**
 * Options accepted by {@link runStructurePass}.
 */
export interface StructurePassOptions extends WalkOptions {
  /**
   * Override the file walker. Used by tests to feed a fixed list of files
   * without standing up a real directory tree.
   */
  walker?: (repoPath: string) => Iterable<string>;
  /**
   * Override the per-file parser. Used by tests to avoid loading the
   * tree-sitter native bindings.
   */
  parser?: (filePath: string) => ParseResult | null;
}

/**
 * Stable key for deduplicating nodes. Includes location so the same name in
 * two files (or two scopes in one file) doesn't collide.
 */
function nodeKey(n: StructureNode): string {
  return [n.filePath, n.kind, n.parent ?? '', n.name, n.startLine, n.endLine].join('\u0000');
}

/**
 * Stable key for deduplicating edges across files.
 */
function edgeKey(e: StructureEdge): string {
  return [e.type, e.from, e.to].join('\u0000');
}

/**
 * Run the structure pass against `repoPath`, aggregating into the
 * `repoId`-tagged result.
 *
 * The pass is intentionally serial: throughput on a typical repo is limited
 * by tree-sitter parse cost, but the dominant constraint is determinism for
 * downstream cards. Parallelization is left to a future revision.
 */
export async function runStructurePass(
  repoPath: string,
  repoId: string,
  options: StructurePassOptions = {},
): Promise<StructurePassResult> {
  const walker = options.walker ?? ((p) => walkRepo(p, options));
  const parser = options.parser ?? parseFile;

  const nodes = new Map<string, StructureNode>();
  const edges = new Map<string, StructureEdge>();
  const fileErrors: StructurePassResult['fileErrors'] = [];

  let filesWalked = 0;
  let filesParsed = 0;

  for (const absPath of walker(repoPath)) {
    filesWalked++;
    const result = parser(absPath);
    if (!result) continue;
    filesParsed++;

    if (result.parseErrors.length > 0) {
      fileErrors.push({
        filePath: toRepoRelative(repoPath, result.filePath),
        language: result.language,
        errors: result.parseErrors,
      });
    }

    for (const node of result.nodes) {
      const rebased: StructureNode = {
        ...node,
        filePath: toRepoRelative(repoPath, node.filePath),
      };
      const key = nodeKey(rebased);
      if (!nodes.has(key)) nodes.set(key, rebased);
    }

    for (const edge of result.edges) {
      const key = edgeKey(edge);
      if (!edges.has(key)) edges.set(key, edge);
    }
  }

  return {
    repoId,
    repoPath,
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
    filesWalked,
    filesParsed,
    fileErrors,
  };
}

/**
 * Convert an extractor-supplied path to a repo-relative form when possible.
 *
 * Extractors are documented to echo back whatever the caller passes in, but
 * in practice the harness hands them absolute paths. We normalize here so
 * downstream pieces (persistence, card synthesis) get stable, portable
 * identifiers.
 */
function toRepoRelative(repoPath: string, filePath: string): string {
  if (!filePath) return filePath;
  const rel = relative(repoPath, filePath);
  // If `filePath` is outside the repo, `relative` returns something starting
  // with `..` — in that case we leave it alone so the original survives.
  if (rel.startsWith('..')) return filePath;
  return rel || filePath;
}
