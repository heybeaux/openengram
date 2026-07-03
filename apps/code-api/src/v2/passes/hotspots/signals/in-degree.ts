/**
 * In-degree signal collector (engram-code v2, Pass 4 — hotspots).
 *
 * Builds a file-to-file import graph from the source paths the caller
 * hands in, then emits one {@link InDegreeSignal} per file with the
 * count of distinct files importing it (in-degree) and the count of
 * distinct files it imports (out-degree).
 *
 * We parse `import ... from '<spec>'` and `require('<spec>')` with a
 * regex rather than an AST: the goal is a cheap structural fan-in
 * count, not a typecheck. The regex misses dynamic imports (`import(
 * pathVar)`) and template-literal specifiers — those are noise for
 * hotspot ranking.
 *
 * Resolution is deliberately conservative:
 *   - relative specifiers (`./` or `../`) are resolved against the
 *     importer's directory and matched against the input file set
 *     (with `.ts`, `.tsx`, `.js`, `.jsx`, `/index.<ext>` fallbacks);
 *   - bare specifiers (`react`, `@scope/x`, `node:fs`) are ignored —
 *     they live outside the repo and contribute nothing to in-degree.
 *
 * The `readFile` hook is injectable so tests can stub the filesystem
 * without writing real files.
 */

import { readFile as fsReadFile } from 'node:fs/promises';
import * as path from 'node:path';

import type { InDegreeSignal } from '../types';

export type ReadFile = (absPath: string) => Promise<string>;

export interface InDegreeOptions {
  /** Repo root — used to compute repo-relative POSIX paths in output. */
  repoRoot: string;
  /**
   * Absolute paths to source files in scope. Only edges where both
   * endpoints are in this set are counted.
   */
  files: string[];
  /** Test seam: replace the underlying file read. */
  readFile?: ReadFile;
}

/** Extensions tried (in order) when resolving an extensionless relative import. */
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'];

/**
 * Match `import ... from '<spec>'`, `import '<spec>'`, `export ... from '<spec>'`,
 * and `require('<spec>')`. The spec is captured in group 1 or 2.
 *
 * Anchored to single/double quotes only — template literals are skipped
 * by design (see file docstring).
 */
const IMPORT_RE =
  /(?:\bimport\b[^'";]*?from\s*|(?:\bimport|\bexport[^'";]*?from)\s*|\brequire\s*\(\s*)['"]([^'"\n]+)['"]/g;

/**
 * Collect per-file in-degree and out-degree across an input file set.
 *
 * Returns one signal per input file — files with no imports inbound *or*
 * outbound still appear (with zeros), so the orchestrator can rely on a
 * 1:1 mapping between inputs and signals.
 *
 * Throws (with the offending file appended) only if `readFile` rejects
 * on a path that exists in `files`. Parse errors are swallowed: a file
 * we can't read import edges from contributes no edges, which matches
 * what a real lint/type tool would see.
 */
export async function collectInDegree(
  opts: InDegreeOptions,
): Promise<InDegreeSignal[]> {
  const read = opts.readFile ?? defaultReadFile;
  const fileSet = new Set(opts.files.map((f) => path.resolve(f)));

  const inEdges = new Map<string, Set<string>>();
  const outEdges = new Map<string, Set<string>>();
  for (const f of fileSet) {
    inEdges.set(f, new Set());
    outEdges.set(f, new Set());
  }

  for (const importerAbs of fileSet) {
    let source: string;
    try {
      source = await read(importerAbs);
    } catch (err) {
      throw new Error(
        `in-degree: read failed for ${importerAbs}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    const importerDir = path.dirname(importerAbs);
    for (const spec of extractSpecifiers(source)) {
      if (!isRelative(spec)) continue;
      const resolved = resolveRelative(importerDir, spec, fileSet);
      if (!resolved || resolved === importerAbs) continue;
      outEdges.get(importerAbs)!.add(resolved);
      inEdges.get(resolved)!.add(importerAbs);
    }
  }

  const out: InDegreeSignal[] = [];
  for (const abs of fileSet) {
    out.push({
      filePath: toPosixRel(opts.repoRoot, abs),
      inDegree: inEdges.get(abs)!.size,
      outDegree: outEdges.get(abs)!.size,
    });
  }
  // Stable order (by repo-relative path) so callers — and tests — can
  // index without sorting.
  out.sort((a, b) =>
    a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0,
  );
  return out;
}

const defaultReadFile: ReadFile = (absPath) =>
  fsReadFile(absPath, { encoding: 'utf8' });

function extractSpecifiers(source: string): string[] {
  const specs: string[] = [];
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(source)) !== null) {
    specs.push(m[1]);
  }
  return specs;
}

function isRelative(spec: string): boolean {
  return (
    spec.startsWith('./') ||
    spec.startsWith('../') ||
    spec === '.' ||
    spec === '..'
  );
}

/**
 * Resolve a relative specifier to an absolute path that exists in the
 * input file set, trying the documented extension/index fallbacks.
 * Returns null when no candidate hits the set.
 */
function resolveRelative(
  importerDir: string,
  spec: string,
  fileSet: Set<string>,
): string | null {
  const base = path.resolve(importerDir, spec);
  // Exact hit (spec already had an extension and matches a file).
  if (fileSet.has(base)) return base;
  for (const ext of RESOLVE_EXTENSIONS) {
    const cand = base + ext;
    if (fileSet.has(cand)) return cand;
  }
  for (const ext of RESOLVE_EXTENSIONS) {
    const cand = path.join(base, `index${ext}`);
    if (fileSet.has(cand)) return cand;
  }
  return null;
}

function toPosixRel(repoRoot: string, absPath: string): string {
  const rel = path.relative(path.resolve(repoRoot), absPath);
  return rel.split(path.sep).join('/');
}
