/**
 * Shared types for the Pass 4 hotspots pass (engram-code v2).
 *
 * Hotspots is a multi-signal pass: several independent collectors emit
 * per-file signals which the orchestrator later normalizes and combines
 * into a single hotspot score. This module declares the common
 * vocabulary so each signal collector lives in its own file but speaks
 * the same shape.
 *
 * Signals intentionally stay pure-ish (no LLM, no DB writes). The
 * orchestrator owns persistence and ranking.
 */

/**
 * Per-file churn signal derived from git history over a bounded window.
 *
 * High churn + many distinct authors + recent activity is a classic
 * hotspot indicator (cf. "Your Code as a Crime Scene", Tornhill).
 */
export interface GitChurnSignal {
  /** Repo-relative POSIX path. */
  filePath: string;
  /** Commits touching the file inside the window. */
  commitCount: number;
  /** Distinct author emails inside the window. */
  uniqueAuthors: number;
  /** Whole days between last touch and "now". 0 if touched today. */
  daysSinceLastTouch: number;
  /** SHA of the most recent commit touching the file in the window. */
  lastTouchSha: string;
}

/**
 * Per-file in-degree signal derived from the static import graph.
 *
 * `inDegree` is the count of *other* files that import this one. Files
 * with high in-degree are central — a bug or rewrite ripples wider — so
 * they raise the hotspot score even when churn is low.
 *
 * Self-edges are excluded. Duplicate imports from the same source file
 * count once (we care about file-level fan-in, not statement count).
 */
export interface InDegreeSignal {
  /** Repo-relative POSIX path. */
  filePath: string;
  /** Distinct files importing this file. */
  inDegree: number;
  /** Distinct files this file imports (fan-out, useful for ratio metrics). */
  outDegree: number;
}

/**
 * Per-file complexity signal from a cheap structural read of the source.
 *
 * Intentionally heuristic: we count source lines (non-blank, non-comment)
 * and control-flow tokens (`if`, `else if`, `for`, `while`, `case`,
 * `catch`, `&&`, `||`, `?`) as a proxy for cyclomatic complexity. The
 * orchestrator can normalize these into a 0..1 score later.
 */
export interface ComplexitySignal {
  /** Repo-relative POSIX path. */
  filePath: string;
  /** Source lines of code (excludes blank lines and pure comment lines). */
  sloc: number;
  /** Cyclomatic-style decision count + 1 (1 means straight-line code). */
  cyclomatic: number;
}

/**
 * Per-file coverage signal parsed from an Istanbul `coverage-summary.json`
 * or v8 equivalent.
 *
 * Low coverage on a high-churn file is a classic "untested hotspot" —
 * the signal the orchestrator weights most heavily when combining.
 */
export interface CoverageSignal {
  /** Repo-relative POSIX path. */
  filePath: string;
  /** Covered statements / total statements, 0..1 (NaN-safe → 0). */
  statementCoverage: number;
  /** Covered branches / total branches, 0..1 (NaN-safe → 0). */
  branchCoverage: number;
  /** Covered lines / total lines, 0..1 (NaN-safe → 0). */
  lineCoverage: number;
}
