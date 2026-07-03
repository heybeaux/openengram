/**
 * Repo walker for the structure pass.
 *
 * Walks a repository root and yields candidate file paths to feed into the
 * parser harness. Honours `.gitignore` at the repo root (via the `ignore`
 * package) and additionally skips a hardcoded set of conventionally-ignored
 * directories (`node_modules`, `dist`, `.git`, etc.) so we don't pay the
 * cost of statting tens of thousands of entries on a typical repo.
 *
 * The walker is intentionally synchronous: structure-pass throughput is
 * dominated by the per-file parser work, not directory traversal, and a
 * synchronous generator keeps the orchestrator easy to reason about.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { Ignore } from 'ignore';

 
const ignoreFactory: () => Ignore = require('ignore');

/**
 * Directory names that are always skipped, regardless of `.gitignore`.
 *
 * These cover virtualenvs, build artifacts, VCS metadata, and language
 * package caches. Keeping this list short and obvious — anything more
 * exotic should land in the repo's own `.gitignore`.
 */
const ALWAYS_SKIP_DIRS = new Set<string>([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.hg',
  '.svn',
  'target',
  '__pycache__',
  '.venv',
  'venv',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
  '.idea',
  '.vscode',
]);

/**
 * Options accepted by {@link walkRepo}.
 */
export interface WalkOptions {
  /**
   * When true (default), read `.gitignore` at the repo root and skip any
   * file or directory matched by it. Disable for tests that want pure
   * directory-only filtering.
   */
  respectGitignore?: boolean;
  /**
   * Additional directory basenames to skip beyond the built-in list.
   */
  extraSkipDirs?: Iterable<string>;
}

/**
 * Build an `ignore` matcher from `<repoPath>/.gitignore`, or `null` if the
 * file is missing or unreadable.
 */
function loadGitignore(repoPath: string): Ignore | null {
  try {
    const text = readFileSync(join(repoPath, '.gitignore'), 'utf8');
    return ignoreFactory().add(text);
  } catch {
    return null;
  }
}

/**
 * Normalize a path for `ignore`: relative to repo, forward-slashed.
 *
 * The `ignore` package documents that paths must use `/` regardless of OS.
 */
function toIgnorePath(repoPath: string, fullPath: string): string {
  const rel = relative(repoPath, fullPath);
  return sep === '/' ? rel : rel.split(sep).join('/');
}

/**
 * Walk `repoPath` and yield absolute paths of regular files.
 *
 * Skips:
 *  - any directory in {@link ALWAYS_SKIP_DIRS} (plus user-supplied
 *    `extraSkipDirs`)
 *  - any path matched by `.gitignore` when `respectGitignore` is true
 *  - symlinks (we don't follow, to avoid cycles)
 *
 * Errors reading a directory are swallowed — a broken subtree should never
 * abort an indexing run.
 */
export function* walkRepo(
  repoPath: string,
  options: WalkOptions = {},
): Generator<string> {
  const respectGitignore = options.respectGitignore ?? true;
  const skipDirs = new Set(ALWAYS_SKIP_DIRS);
  if (options.extraSkipDirs) {
    for (const d of options.extraSkipDirs) skipDirs.add(d);
  }
  const ig = respectGitignore ? loadGitignore(repoPath) : null;

  const stack: string[] = [repoPath];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = join(current, entry.name);

      // Skip symlinks unconditionally to avoid cycles and surprise targets.
      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        if (ig && ig.ignores(`${toIgnorePath(repoPath, full)}/`)) continue;
        stack.push(full);
        continue;
      }

      if (!entry.isFile()) continue;
      if (ig && ig.ignores(toIgnorePath(repoPath, full))) continue;

      // Defensive: confirm the entry still exists and is a regular file.
      try {
        if (!statSync(full).isFile()) continue;
      } catch {
        continue;
      }

      yield full;
    }
  }
}
