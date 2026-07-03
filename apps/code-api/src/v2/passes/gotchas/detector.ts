/**
 * Structural gotcha detection (engram-code v2, Pass 5).
 *
 * Pure filter — NO LLM. Scans per-module sources + sibling .md files to
 * surface candidates that probably warrant a "watch out" note:
 *
 *   - Tag comments: TODO / FIXME / HACK / XXX / WARNING / NOTE
 *   - Long docstrings (> 5 lines) — likely contain hard-won caveats
 *   - Sibling .md docs (README.md, ADR-*.md, etc.) — usually editorial
 *   - Convention outliers: when a module's classes overwhelmingly carry
 *     a decorator (e.g. `@Injectable` ≥ 70% of classes), the missing
 *     decorator on a sibling is suspicious.
 *
 * The orchestrator only calls the LLM on modules with at least one
 * candidate, so we stay cheap on quiet repos.
 *
 * Spec: docs/specs/engram-code-v2.md §4.2 Pass 5.
 */

import { posix } from 'node:path';

export type GotchaCandidateKind =
  | 'tag-comment'
  | 'long-docstring'
  | 'sibling-doc'
  | 'convention-outlier';

export interface GotchaCandidate {
  kind: GotchaCandidateKind;
  /** Repo-relative file path the candidate was sourced from. */
  filePath: string;
  /** 1-based line of first interest (start of the comment / docstring / decl). */
  line: number;
  /** Short excerpt (≤ 400 chars) suitable for inlining into a prompt. */
  excerpt: string;
  /** Extra tags — e.g. {"tag":"FIXME"} or {"missing":"@Injectable"}. */
  metadata?: Record<string, unknown>;
}

export interface GotchaModuleCandidates {
  modulePath: string;
  candidates: GotchaCandidate[];
}

/** Input file shape — body + optional language for excerpting rules. */
export interface GotchaInputFile {
  /** Repo-relative path. */
  path: string;
  /** Full source body. */
  source: string;
  /** Logical language tag — e.g. `typescript`, `python`, `go`. Optional. */
  language?: string;
}

/** Sibling markdown that may add gotchas to a module (README / ADR / etc.). */
export interface GotchaSiblingDoc {
  /** Repo-relative path. */
  path: string;
  /** Markdown body. */
  source: string;
}

export interface DetectGotchasInput {
  /** Repo-relative module path (a directory). */
  modulePath: string;
  /** Source files inside the module. */
  files: GotchaInputFile[];
  /** Sibling docs to fold in (typically the module's README.md + ADRs). */
  siblingDocs?: GotchaSiblingDoc[];
}

/**
 * Run the structural filter for a single module.
 *
 * Returns the candidate list — empty when the module has nothing to
 * flag (orchestrator will skip it).
 */
export function detectModuleGotchas(input: DetectGotchasInput): GotchaModuleCandidates {
  const candidates: GotchaCandidate[] = [];

  for (const file of input.files) {
    collectTagComments(file, candidates);
    collectLongDocstrings(file, candidates);
  }

  for (const doc of input.siblingDocs ?? []) {
    candidates.push({
      kind: 'sibling-doc',
      filePath: doc.path,
      line: 1,
      excerpt: excerpt(doc.source, 0, 400),
      metadata: { name: posix.basename(doc.path) },
    });
  }

  collectConventionOutliers(input.files, candidates);

  // Stable order: by file path, then line.
  candidates.sort((a, b) => {
    if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
    return a.line - b.line;
  });

  return { modulePath: input.modulePath, candidates };
}

/* ───────────────────────── tag comments ───────────────────────── */

const TAG_RE = /\b(TODO|FIXME|HACK|XXX|WARNING|NOTE)\b\s*(?:[:\-(].*)?/g;

function collectTagComments(file: GotchaInputFile, out: GotchaCandidate[]): void {
  const lines = file.source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Cheap skip: only consider commented lines (covers // /* # ; -- etc.).
    if (!isLikelyComment(line)) continue;
    TAG_RE.lastIndex = 0;
    const match = TAG_RE.exec(line);
    if (!match) continue;
    out.push({
      kind: 'tag-comment',
      filePath: file.path,
      line: i + 1,
      excerpt: line.trim().slice(0, 400),
      metadata: { tag: match[1] },
    });
  }
}

function isLikelyComment(line: string): boolean {
  const t = line.trimStart();
  return (
    t.startsWith('//') ||
    t.startsWith('/*') ||
    t.startsWith('*') ||
    t.startsWith('#') ||
    t.startsWith(';') ||
    t.startsWith('--')
  );
}

/* ───────────────────────── long docstrings ───────────────────────── */

function collectLongDocstrings(file: GotchaInputFile, out: GotchaCandidate[]): void {
  const lang = file.language ?? guessLanguage(file.path);
  if (lang === 'python') {
    collectTripleQuotedDocstrings(file, out);
  } else {
    collectJsDocDocstrings(file, out);
  }
}

function guessLanguage(path: string): string {
  if (path.endsWith('.py')) return 'python';
  if (path.endsWith('.ts') || path.endsWith('.tsx') || path.endsWith('.js')) return 'typescript';
  if (path.endsWith('.go')) return 'go';
  return 'unknown';
}

const MIN_DOCSTRING_LINES = 5;

function collectJsDocDocstrings(file: GotchaInputFile, out: GotchaCandidate[]): void {
  const src = file.source;
  const re = /\/\*\*([\s\S]*?)\*\//g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const block = m[0];
    const lineCount = block.split(/\r?\n/).length;
    if (lineCount < MIN_DOCSTRING_LINES) continue;
    const startLine = lineNumberAt(src, m.index);
    out.push({
      kind: 'long-docstring',
      filePath: file.path,
      line: startLine,
      excerpt: excerpt(block, 0, 400),
      metadata: { lines: lineCount },
    });
  }
}

function collectTripleQuotedDocstrings(file: GotchaInputFile, out: GotchaCandidate[]): void {
  const src = file.source;
  // Both """ and ''' triple-quoted, non-greedy.
  const re = /("""|''')([\s\S]*?)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const block = m[0];
    const lineCount = block.split(/\r?\n/).length;
    if (lineCount < MIN_DOCSTRING_LINES) continue;
    const startLine = lineNumberAt(src, m.index);
    out.push({
      kind: 'long-docstring',
      filePath: file.path,
      line: startLine,
      excerpt: excerpt(block, 0, 400),
      metadata: { lines: lineCount },
    });
  }
}

function lineNumberAt(src: string, idx: number): number {
  let n = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === '\n') n++;
  return n;
}

function excerpt(text: string, start: number, max: number): string {
  return text.slice(start, start + max).replace(/\s+/g, ' ').trim();
}

/* ───────────────────────── convention outliers ───────────────────────── */

const DECORATOR_RE = /^\s*@([A-Za-z_][\w]*)/;

/**
 * For each module-level file, we scan for class declarations and the
 * decorator directly above them. If ≥ 70% of classes in the module
 * carry the same decorator AND there are at least 3 classes total,
 * any class without that decorator is flagged.
 *
 * Cheap heuristic — no AST. Misses generic decorators applied via
 * function calls, but those are rare. The LLM ultimately decides
 * whether the outlier is worth mentioning.
 */
function collectConventionOutliers(
  files: GotchaInputFile[],
  out: GotchaCandidate[],
): void {
  interface ClassDecl {
    filePath: string;
    line: number;
    name: string;
    decorator?: string;
  }
  const classes: ClassDecl[] = [];

  for (const file of files) {
    const lines = file.source.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trimStart();
      const classMatch =
        /^export\s+(?:abstract\s+)?class\s+([A-Za-z_][\w]*)/.exec(trimmed) ||
        /^class\s+([A-Za-z_][\w]*)/.exec(trimmed);
      if (!classMatch) continue;
      // Look back for the nearest non-blank line — if it's a decorator, capture it.
      let j = i - 1;
      while (j >= 0 && lines[j].trim() === '') j--;
      const decorator = j >= 0 ? DECORATOR_RE.exec(lines[j])?.[1] : undefined;
      classes.push({
        filePath: file.path,
        line: i + 1,
        name: classMatch[1],
        decorator,
      });
    }
  }

  if (classes.length < 3) return;
  const counts = new Map<string, number>();
  for (const c of classes) {
    if (!c.decorator) continue;
    counts.set(c.decorator, (counts.get(c.decorator) ?? 0) + 1);
  }
  let dominant: { name: string; count: number } | null = null;
  for (const [name, count] of counts) {
    if (!dominant || count > dominant.count) dominant = { name, count };
  }
  if (!dominant) return;
  const ratio = dominant.count / classes.length;
  if (ratio < 0.7) return;

  for (const c of classes) {
    if (c.decorator === dominant.name) continue;
    out.push({
      kind: 'convention-outlier',
      filePath: c.filePath,
      line: c.line,
      excerpt: `class ${c.name} (no @${dominant.name})`,
      metadata: { missing: `@${dominant.name}`, dominantRatio: Number(ratio.toFixed(2)) },
    });
  }
}
