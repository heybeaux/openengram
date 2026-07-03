/**
 * Coverage signal collector (engram-code v2, Pass 4 — hotspots).
 *
 * Parses an Istanbul-format `coverage-summary.json` (the file Jest /
 * Vitest / nyc all emit when `--coverage` is on) and emits one
 * {@link CoverageSignal} per file with the absolute path resolvable
 * inside `coverageRoot`.
 *
 * Expected input shape (Istanbul):
 *
 *   {
 *     "total":            { "lines": { ... }, ... },
 *     "/abs/path/x.ts":   {
 *        "lines":      { "total": 10, "covered": 7, "skipped": 0, "pct": 70 },
 *        "statements": { ... },
 *        "branches":   { ... },
 *        "functions":  { ... }
 *     },
 *     ...
 *   }
 *
 * We use `total` (covered/total) rather than `pct`, since `pct` is
 * pre-rounded and lossy for combining downstream. The "total" key is
 * dropped — it's a roll-up, not a file.
 *
 * The `readFile` hook is injectable so tests can stub the filesystem.
 */

import { readFile as fsReadFile } from 'node:fs/promises';
import * as path from 'node:path';

import type { CoverageSignal } from '../types';

export type ReadFile = (absPath: string) => Promise<string>;

export interface CoverageOptions {
  /** Repo root — used to compute repo-relative POSIX paths in output. */
  repoRoot: string;
  /** Absolute path to `coverage-summary.json`. */
  summaryPath: string;
  /**
   * If set, only files whose absolute path is in this set survive. Use
   * it to scope the signal to the same file universe as the other
   * hotspot collectors.
   */
  files?: string[];
  /** Test seam: replace the underlying file read. */
  readFile?: ReadFile;
}

interface IstanbulMetric {
  total?: number;
  covered?: number;
  skipped?: number;
  pct?: number;
}

interface IstanbulFileEntry {
  lines?: IstanbulMetric;
  statements?: IstanbulMetric;
  branches?: IstanbulMetric;
  functions?: IstanbulMetric;
}

/**
 * Read and parse an Istanbul coverage summary into per-file signals.
 *
 * Returns `[]` (no throw) when the summary file is unreadable or the
 * JSON is malformed — coverage is an optional input and the orchestrator
 * already weights its absence (the file simply doesn't contribute a
 * coverage signal). Read failures are *not* wrapped because callers
 * routinely run with no coverage on disk.
 */
export async function collectCoverage(
  opts: CoverageOptions,
): Promise<CoverageSignal[]> {
  const read = opts.readFile ?? defaultReadFile;

  let raw: string;
  try {
    raw = await read(opts.summaryPath);
  } catch {
    return [];
  }

  let parsed: Record<string, IstanbulFileEntry>;
  try {
    parsed = JSON.parse(raw) as Record<string, IstanbulFileEntry>;
  } catch {
    return [];
  }

  const fileSet = opts.files
    ? new Set(opts.files.map((f) => path.resolve(f)))
    : null;

  const out: CoverageSignal[] = [];
  for (const [key, entry] of Object.entries(parsed)) {
    if (key === 'total') continue;
    const absKey = path.resolve(key);
    if (fileSet && !fileSet.has(absKey)) continue;
    out.push({
      filePath: toPosixRel(opts.repoRoot, absKey),
      statementCoverage: ratio(entry.statements),
      branchCoverage: ratio(entry.branches),
      lineCoverage: ratio(entry.lines),
    });
  }
  out.sort((a, b) =>
    a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0,
  );
  return out;
}

const defaultReadFile: ReadFile = (absPath) =>
  fsReadFile(absPath, { encoding: 'utf8' });

/**
 * Compute covered/total as a 0..1 ratio, clamping out the
 * divide-by-zero and missing-field cases to 0. Istanbul reports
 * `pct: 100` for total=0, which is misleading for ranking — a file
 * with no statements should not look fully covered.
 */
function ratio(m: IstanbulMetric | undefined): number {
  if (!m) return 0;
  const total = typeof m.total === 'number' ? m.total : 0;
  const covered = typeof m.covered === 'number' ? m.covered : 0;
  if (total <= 0) return 0;
  const r = covered / total;
  if (!Number.isFinite(r)) return 0;
  if (r < 0) return 0;
  if (r > 1) return 1;
  return r;
}

function toPosixRel(repoRoot: string, absPath: string): string {
  const rel = path.relative(path.resolve(repoRoot), absPath);
  return rel.split(path.sep).join('/');
}
