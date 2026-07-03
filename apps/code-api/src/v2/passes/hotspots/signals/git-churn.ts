/**
 * Git churn signal collector (engram-code v2, Pass 4 — hotspots).
 *
 * Walks `git log` over a bounded window and emits a {@link GitChurnSignal}
 * per file touched. The window, repo root, and include/exclude globs are
 * caller-controlled. The `exec` hook is injectable so tests can stub git
 * output without spawning subprocesses.
 *
 * Output format is locked to:
 *
 *   git log --since=<windowDays>.days.ago \
 *           --name-only \
 *           --pretty=format:%H%x09%ae%x09%aI
 *
 * which produces, per commit:
 *
 *   <sha>\t<author-email>\t<iso-author-date>
 *   path/one
 *   path/two
 *   <blank>
 *
 * Renames show up as a single post-rename path (we don't pass
 * `--follow`; per-file rename tracking is a Pass 4 concern that the
 * orchestrator handles separately if needed).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const minimatch = require('minimatch') as (
  path: string,
  pattern: string,
  options?: { dot?: boolean },
) => boolean;

import type { GitChurnSignal } from '../types';

export type GitExec = (
  cmd: string,
  args: string[],
  cwd: string,
) => Promise<string>;

export interface GitChurnOptions {
  repoRoot: string;
  /** Look back this many days. Default 90. */
  windowDays?: number;
  /** If set, only files matching at least one glob are kept. */
  includeGlobs?: string[];
  /** Files matching any glob are dropped (applied after include). */
  excludeGlobs?: string[];
  /** Test seam: replace the underlying git invocation. */
  exec?: GitExec;
}

export const DEFAULT_WINDOW_DAYS = 90;

const execFileAsync = promisify(execFile);

/** Default git driver. Kept private so callers can't accidentally bypass `exec`. */
const defaultExec: GitExec = async (cmd, args, cwd) => {
  const { stdout } = await execFileAsync(cmd, args, {
    cwd,
    // Generous buffer — long git logs on big repos can exceed the default 1MB.
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
};

/**
 * Collect per-file git churn over a bounded window.
 *
 * Returns `[]` (never throws) when the window has no commits or the
 * repo is empty. Any underlying git failure is rethrown wrapped with
 * the offending `repoRoot` so callers can attribute it.
 */
export async function collectGitChurn(
  opts: GitChurnOptions,
): Promise<GitChurnSignal[]> {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const exec = opts.exec ?? defaultExec;

  const args = [
    'log',
    `--since=${windowDays}.days.ago`,
    '--name-only',
    '--pretty=format:%H%x09%ae%x09%aI',
  ];

  let raw: string;
  try {
    raw = await exec('git', args, opts.repoRoot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `git-churn: git log failed in ${opts.repoRoot}: ${message}`,
    );
  }

  if (!raw || raw.trim() === '') {
    return [];
  }

  const perFile = aggregate(raw);
  const filtered = filterByGlobs(perFile, opts.includeGlobs, opts.excludeGlobs);

  const now = Date.now();
  return filtered.map(([filePath, agg]) => ({
    filePath,
    commitCount: agg.commits.size,
    uniqueAuthors: agg.authors.size,
    daysSinceLastTouch: daysBetween(agg.lastTouchMs, now),
    lastTouchSha: agg.lastTouchSha,
  }));
}

interface FileAggregate {
  commits: Set<string>;
  authors: Set<string>;
  lastTouchMs: number;
  lastTouchSha: string;
}

/**
 * Parse the raw `git log` output and reduce it to per-file aggregates.
 *
 * Streaming line-by-line so we can handle very large repos without
 * holding a parsed object graph the size of the whole log.
 */
function aggregate(raw: string): Map<string, FileAggregate> {
  const out = new Map<string, FileAggregate>();

  let currentSha: string | null = null;
  let currentEmail: string | null = null;
  let currentTimeMs = 0;

  for (const line of raw.split('\n')) {
    if (line === '') {
      // Blank line separates commits in this format; keep header state until
      // we see a new header so the trailing blank is harmless.
      continue;
    }

    // Commit header lines contain two tabs (SHA \t email \t iso-date).
    // File paths cannot contain tabs in git's default output, so this is a
    // reliable discriminator.
    const tabCount = (line.match(/\t/g) ?? []).length;
    if (tabCount === 2) {
      const [sha, email, iso] = line.split('\t');
      currentSha = sha;
      currentEmail = email;
      currentTimeMs = Date.parse(iso);
      continue;
    }

    if (currentSha === null || currentEmail === null) {
      // Defensive: a file path appeared before any header. Skip rather
      // than throw — git output should never look like this, but a
      // misconfigured exec stub could produce it.
      continue;
    }

    const filePath = line;
    let agg = out.get(filePath);
    if (!agg) {
      agg = {
        commits: new Set(),
        authors: new Set(),
        lastTouchMs: currentTimeMs,
        lastTouchSha: currentSha,
      };
      out.set(filePath, agg);
    }
    agg.commits.add(currentSha);
    agg.authors.add(currentEmail);
    if (currentTimeMs > agg.lastTouchMs) {
      agg.lastTouchMs = currentTimeMs;
      agg.lastTouchSha = currentSha;
    }
  }

  return out;
}

function filterByGlobs(
  perFile: Map<string, FileAggregate>,
  includeGlobs: string[] | undefined,
  excludeGlobs: string[] | undefined,
): Array<[string, FileAggregate]> {
  const entries = Array.from(perFile.entries());
  const hasInclude = includeGlobs && includeGlobs.length > 0;
  const hasExclude = excludeGlobs && excludeGlobs.length > 0;
  if (!hasInclude && !hasExclude) {
    return entries;
  }
  return entries.filter(([filePath]) => {
    if (hasInclude) {
      const matched = includeGlobs.some((g) =>
        minimatch(filePath, g, { dot: true }),
      );
      if (!matched) return false;
    }
    if (hasExclude) {
      const blocked = excludeGlobs.some((g) =>
        minimatch(filePath, g, { dot: true }),
      );
      if (blocked) return false;
    }
    return true;
  });
}

function daysBetween(thenMs: number, nowMs: number): number {
  if (!Number.isFinite(thenMs) || thenMs <= 0) return 0;
  const diff = nowMs - thenMs;
  if (diff <= 0) return 0;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
