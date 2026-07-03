/**
 * Complexity signal collector (engram-code v2, Pass 4 — hotspots).
 *
 * Emits a {@link ComplexitySignal} per input file with two scalars:
 *
 *   - `sloc`       — source lines of code, excluding blank lines and
 *                    lines that are *only* a comment (`//`, leading `*`,
 *                    or whole-line `/* … *\/`). Mixed lines (code +
 *                    trailing comment) count as code.
 *   - `cyclomatic` — McCabe-style decision count + 1. We count whole-
 *                    word occurrences of `if`, `else if`, `for`, `while`,
 *                    `case`, `catch`, plus `&&`, `||`, and the ternary
 *                    `?`. Strings and comments are stripped first so a
 *                    `||` inside a string literal doesn't inflate the
 *                    number.
 *
 * Both metrics are heuristics — explicitly *not* a real cyclomatic
 * complexity engine. They're cheap, language-agnostic enough for
 * TypeScript/JavaScript, and stable: the orchestrator normalizes them
 * into 0..1 before combining with the other signals.
 *
 * The `readFile` hook is injectable so tests can stub the filesystem.
 */

import { readFile as fsReadFile } from 'node:fs/promises';
import * as path from 'node:path';

import type { ComplexitySignal } from '../types';

export type ReadFile = (absPath: string) => Promise<string>;

export interface ComplexityOptions {
  /** Repo root — used to compute repo-relative POSIX paths in output. */
  repoRoot: string;
  /** Absolute paths to files to score. */
  files: string[];
  /** Test seam: replace the underlying file read. */
  readFile?: ReadFile;
}

/**
 * Score complexity for each input file.
 *
 * Returns one signal per input file, in stable repo-relative order.
 * A file that reads but parses to zero non-comment content emits
 * `{ sloc: 0, cyclomatic: 1 }` — the baseline of straight-line code.
 *
 * If `readFile` rejects for a given path, the error is wrapped with the
 * offending path and rethrown; partial results are not returned.
 */
export async function collectComplexity(
  opts: ComplexityOptions,
): Promise<ComplexitySignal[]> {
  const read = opts.readFile ?? defaultReadFile;
  const out: ComplexitySignal[] = [];
  for (const abs of opts.files) {
    let source: string;
    try {
      source = await read(abs);
    } catch (err) {
      throw new Error(
        `complexity: read failed for ${abs}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    out.push({
      filePath: toPosixRel(opts.repoRoot, abs),
      sloc: countSloc(source),
      cyclomatic: countCyclomatic(source),
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
 * Count non-blank, non-pure-comment lines.
 *
 * We track a block-comment state machine so a `/* ... *\/` spanning
 * many lines doesn't get counted as code. A line containing both code
 * and an inline comment counts as code (one line of work, one of
 * explanation).
 */
function countSloc(source: string): number {
  let inBlock = false;
  let count = 0;
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (line === '') continue;
    let i = 0;
    let sawCode = false;
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf('*/', i);
        if (end === -1) {
          i = line.length;
          break;
        }
        i = end + 2;
        inBlock = false;
        continue;
      }
      // Line comment: rest of line is comment.
      if (line[i] === '/' && line[i + 1] === '/') {
        break;
      }
      // Block comment opens.
      if (line[i] === '/' && line[i + 1] === '*') {
        i += 2;
        inBlock = true;
        continue;
      }
      // Any whitespace before non-comment content is not "code" yet.
      if (line[i] === ' ' || line[i] === '\t') {
        i += 1;
        continue;
      }
      sawCode = true;
      i += 1;
    }
    if (sawCode) count += 1;
  }
  return count;
}

/**
 * Count McCabe-style decisions + 1. Strings and comments are stripped
 * first so literal `||` / `?` inside them don't inflate the number.
 */
function countCyclomatic(source: string): number {
  const cleaned = stripStringsAndComments(source);
  let decisions = 0;
  // Keyword decisions (word-boundary anchored).
  const kwRe = /\b(?:if|for|while|case|catch)\b/g;
  decisions += (cleaned.match(kwRe) ?? []).length;
  // `else if` collapses to one decision in classic McCabe — already
  // counted once via `if`; do nothing.

  // Boolean shortcut operators.
  decisions += (cleaned.match(/&&/g) ?? []).length;
  decisions += (cleaned.match(/\|\|/g) ?? []).length;

  // Ternary `?`. Avoid `??` (nullish coalescing) which is not a decision
  // in the classic sense, and avoid optional chaining `?.`.
  decisions += countTernaries(cleaned);

  return decisions + 1;
}

function countTernaries(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] !== '?') continue;
    const next = s[i + 1];
    if (next === '?' || next === '.') continue;
    // Also skip the second char of `??` when we land on the trailing `?`.
    const prev = s[i - 1];
    if (prev === '?') continue;
    n += 1;
  }
  return n;
}

/**
 * Replace string-literal and comment contents with spaces, preserving
 * length so subsequent regex offsets still line up if a caller wants to
 * cross-reference. Handles single, double, and backtick quotes plus
 * `//` and `/* *\/` comments.
 *
 * Template-literal expressions (`${...}`) are preserved as code: those
 * are real code, just embedded.
 */
function stripStringsAndComments(src: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];

    // Line comment
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') {
        out.push(' ');
        i += 1;
      }
      continue;
    }
    // Block comment
    if (c === '/' && n === '*') {
      out.push(' ', ' ');
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out.push(src[i] === '\n' ? '\n' : ' ');
        i += 1;
      }
      if (i < src.length) {
        out.push(' ', ' ');
        i += 2;
      }
      continue;
    }
    // String literal
    if (c === '"' || c === "'") {
      out.push(c);
      i += 1;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\' && i + 1 < src.length) {
          out.push(' ', ' ');
          i += 2;
          continue;
        }
        out.push(src[i] === '\n' ? '\n' : ' ');
        i += 1;
      }
      if (i < src.length) {
        out.push(c);
        i += 1;
      }
      continue;
    }
    // Template literal: keep `${...}` expressions, blank the rest.
    if (c === '`') {
      out.push('`');
      i += 1;
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\' && i + 1 < src.length) {
          out.push(' ', ' ');
          i += 2;
          continue;
        }
        if (src[i] === '$' && src[i + 1] === '{') {
          out.push('$', '{');
          i += 2;
          let depth = 1;
          while (i < src.length && depth > 0) {
            if (src[i] === '{') depth += 1;
            else if (src[i] === '}') depth -= 1;
            out.push(src[i]);
            i += 1;
          }
          continue;
        }
        out.push(src[i] === '\n' ? '\n' : ' ');
        i += 1;
      }
      if (i < src.length) {
        out.push('`');
        i += 1;
      }
      continue;
    }

    out.push(c);
    i += 1;
  }
  return out.join('');
}

function toPosixRel(repoRoot: string, absPath: string): string {
  const rel = path.relative(path.resolve(repoRoot), absPath);
  return rel.split(path.sep).join('/');
}
