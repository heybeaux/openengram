/**
 * Hotspots pass orchestrator (engram-code v2, Pass 4 — EC-45).
 *
 * Runs the four signal collectors (git churn, in-degree, complexity,
 * coverage), normalizes their outputs into 0..1 ranks, then combines them
 * into a single hotspot score per file. Files scoring above `scoreThreshold`
 * are emitted as `CardInput`s — one MODULE-level card per finding plus a
 * single REPOSITORY-level roll-up card summarizing the top hotspots.
 *
 * Why deterministic: hotspots is the only Pass 4 component that doesn't call
 * an LLM. The signals are mechanical and the score is a weighted blend, so
 * we get repeatable rankings across runs (a property the dashboard's
 * "what's risky right now" panel relies on). LLM-backed enrichment of
 * hotspot cards (e.g. "why is this risky?") is deferred — when we add it,
 * this orchestrator becomes the input source to a follow-on pass.
 *
 * Why a weighted blend rather than a fancier model: the spec calls out the
 * classic Tornhill heuristic (high churn × low coverage = risk). We weight
 * churn highest, complexity second, in-degree third, and (1 - coverage)
 * fourth. Weights are exposed via {@link HotspotsPassOptions.weights} so
 * tunings can land as code reviews, not silent config drift.
 *
 * Persistence + observability are the conductor's responsibility — this
 * orchestrator returns a `PassRunInput` (token cost 0, deterministic) and
 * the cards. The conductor pipes them through `wrapPassRun` /
 * `persistPassRun` (EC-47) and `writeCard` (EC-14) just like the other
 * passes. Mirror in `runSynth` lives in `src/v2/cli/synth.ts`.
 *
 * Spec: Linear EC-45 (Phase 3, P2).
 */

import type { CardInput, PassRunInput } from '../../types/cards';

import {
  collectComplexity,
  collectCoverage,
  collectGitChurn,
  collectInDegree,
  DEFAULT_WINDOW_DAYS,
  type GitExec,
} from './signals';
import type {
  ComplexitySignal,
  CoverageSignal,
  GitChurnSignal,
  InDegreeSignal,
} from './types';

/** Built-in score weights. Sum is intentionally != 1 so we normalize. */
export const DEFAULT_HOTSPOT_WEIGHTS = Object.freeze({
  churn: 0.4,
  complexity: 0.25,
  inDegree: 0.2,
  /** Applied to `(1 - coverage)` so untested files score higher. */
  coverage: 0.15,
});

/**
 * Files scoring at or above this rank (0..1) are emitted as a card. A
 * relatively high default keeps the noise floor down — most repos have a
 * long tail of files with zero churn that aren't interesting.
 */
export const DEFAULT_SCORE_THRESHOLD = 0.6;

/** Cap on per-file cards persisted in one pass, sorted by score. */
export const DEFAULT_MAX_HOTSPOT_CARDS = 50;

/** Top-N hotspots included in the repository roll-up body. */
export const DEFAULT_REPO_ROLLUP_TOP_N = 10;

export interface HotspotWeights {
  churn: number;
  complexity: number;
  inDegree: number;
  coverage: number;
}

export interface HotspotsPassOptions {
  /** Repo-relative POSIX paths of files in scope; absolute paths to read. */
  files: string[];
  /** Absolute path to the repo root. */
  repoRoot: string;
  /** Git churn lookback window. Defaults to {@link DEFAULT_WINDOW_DAYS}. */
  windowDays?: number;
  /** Globs included for the churn signal. Forwarded verbatim. */
  includeGlobs?: string[];
  /** Globs excluded for the churn signal. Forwarded verbatim. */
  excludeGlobs?: string[];
  /**
   * Absolute path to an Istanbul-style coverage summary. When omitted, the
   * coverage signal is treated as empty (every file effectively scores
   * `1 - 0 = 1` on the coverage axis — the weight is small enough that
   * this doesn't dominate, but tests assert the no-coverage path).
   */
  coverageSummaryPath?: string;
  /** Tuning for the four-signal blend. */
  weights?: Partial<HotspotWeights>;
  /** Files at or above this score (0..1) become a card. */
  scoreThreshold?: number;
  /** Hard cap on emitted MODULE cards. Top-N by score. */
  maxCards?: number;
  /** Top-N hotspots referenced in the repository roll-up card. */
  rollupTopN?: number;
  /** Test seam: replace git driver. */
  gitExec?: GitExec;
  /** Test seam: replace file reads (used by complexity + in-degree). */
  readFile?: (absPath: string) => Promise<string>;
  /** Test seam: replace coverage file read. Defaults to fs. */
  readCoverageFile?: (absPath: string) => Promise<string>;
}

/** Per-file aggregated score for downstream consumers. */
export interface HotspotScore {
  /** Repo-relative POSIX path. */
  filePath: string;
  /** Final blended score, 0..1. Higher = riskier. */
  score: number;
  /** Per-axis normalized rank, 0..1. Useful for "why is this a hotspot?". */
  axes: {
    churn: number;
    complexity: number;
    inDegree: number;
    /** Already inverted: 1 = untested, 0 = fully covered. */
    coverage: number;
  };
  /** Raw signal values that fed the score. `null` when the signal was absent. */
  raw: {
    churn: GitChurnSignal | null;
    complexity: ComplexitySignal | null;
    inDegree: InDegreeSignal | null;
    coverage: CoverageSignal | null;
  };
}

export interface HotspotsPassResult {
  repoId: string;
  /** Every scored file, sorted descending by score. */
  scores: HotspotScore[];
  /** Files above `scoreThreshold`, capped by `maxCards`. */
  hotspots: HotspotScore[];
  /** MODULE cards for each hotspot, plus one REPOSITORY roll-up card. */
  cards: CardInput[];
  /** Pre-built `PassRunInput` for the conductor to feed `persistPassRun`. */
  passRun: PassRunInput;
}

/**
 * Run the hotspots pass against `repoId` / `repoRoot`.
 *
 * Throws if a collector fails in a way that signals a misconfigured repo
 * (e.g. `git log` errors on a non-repo path). Missing inputs (no coverage
 * file, no commits in window) degrade gracefully — the pass still emits a
 * PassRunInput so the conductor's ledger has a row.
 */
export async function runHotspotsPass(
  repoId: string,
  opts: HotspotsPassOptions,
): Promise<HotspotsPassResult> {
  const startedAt = new Date();

  const weights = mergeWeights(opts.weights);
  const threshold = opts.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
  const maxCards = opts.maxCards ?? DEFAULT_MAX_HOTSPOT_CARDS;
  const rollupTopN = opts.rollupTopN ?? DEFAULT_REPO_ROLLUP_TOP_N;

  // Git churn is best-effort. A non-repo path (fresh tarball, shallow
  // clone with `--depth=0`, in-memory fixture in tests) shouldn't fail
  // the whole pass — we just skip the churn signal. Other collector
  // failures still propagate because they signal a misconfigured pass
  // (bad file paths, malformed coverage JSON).
  const churnPromise = collectGitChurn({
    repoRoot: opts.repoRoot,
    windowDays: opts.windowDays ?? DEFAULT_WINDOW_DAYS,
    includeGlobs: opts.includeGlobs,
    excludeGlobs: opts.excludeGlobs,
    exec: opts.gitExec,
  }).catch(() => [] as GitChurnSignal[]);

  const [churnSignals, inDegreeSignals, complexitySignals, coverageSignals] =
    await Promise.all([
      churnPromise,
      collectInDegree({
        repoRoot: opts.repoRoot,
        files: opts.files,
        readFile: opts.readFile,
      }),
      collectComplexity({
        repoRoot: opts.repoRoot,
        files: opts.files,
        readFile: opts.readFile,
      }),
      opts.coverageSummaryPath
        ? collectCoverage({
            repoRoot: opts.repoRoot,
            summaryPath: opts.coverageSummaryPath,
            files: opts.files,
            readFile: opts.readCoverageFile,
          })
        : Promise.resolve<CoverageSignal[]>([]),
    ]);

  const churnByPath = indexByPath(churnSignals);
  const inDegreeByPath = indexByPath(inDegreeSignals);
  const complexityByPath = indexByPath(complexitySignals);
  const coverageByPath = indexByPath(coverageSignals);

  // The complete universe of files we'll score: anything any collector
  // reported. The in-degree collector reports a row per input file, so this
  // is normally the same as `opts.files`, but the churn collector can
  // surface deleted/renamed paths and we want them visible in the score
  // table.
  const allPaths = new Set<string>();
  for (const s of churnSignals) allPaths.add(s.filePath);
  for (const s of inDegreeSignals) allPaths.add(s.filePath);
  for (const s of complexitySignals) allPaths.add(s.filePath);
  for (const s of coverageSignals) allPaths.add(s.filePath);

  // Pre-compute axis maxima so we can normalize to 0..1 in a single pass.
  // Using max-based normalization (not z-scores) keeps the ranking
  // interpretable: a score of 1.0 always means "the worst file on this
  // axis."
  const maxChurnCommits = Math.max(
    1,
    ...churnSignals.map((s) => s.commitCount),
  );
  const maxChurnAuthors = Math.max(
    1,
    ...churnSignals.map((s) => s.uniqueAuthors),
  );
  const maxComplexity = Math.max(
    1,
    ...complexitySignals.map((s) => s.cyclomatic),
  );
  const maxInDegree = Math.max(
    1,
    ...inDegreeSignals.map((s) => s.inDegree),
  );

  const scores: HotspotScore[] = [];
  for (const filePath of allPaths) {
    const churn = churnByPath.get(filePath) ?? null;
    const complexity = complexityByPath.get(filePath) ?? null;
    const inDegree = inDegreeByPath.get(filePath) ?? null;
    const coverage = coverageByPath.get(filePath) ?? null;

    const axes = {
      churn: churn ? churnAxis(churn, maxChurnCommits, maxChurnAuthors) : 0,
      complexity: complexity ? complexity.cyclomatic / maxComplexity : 0,
      inDegree: inDegree ? inDegree.inDegree / maxInDegree : 0,
      // No coverage data = treat as untested (1). This is the conservative
      // direction for a "what's risky" view.
      coverage: coverage ? 1 - coverage.statementCoverage : 1,
    };

    const score = blend(axes, weights);
    scores.push({
      filePath,
      score,
      axes,
      raw: { churn, complexity, inDegree, coverage },
    });
  }

  scores.sort(byScoreDesc);

  const hotspots = scores
    .filter((s) => s.score >= threshold)
    .slice(0, maxCards);

  const cards: CardInput[] = [];
  for (const h of hotspots) {
    cards.push(buildHotspotCard(repoId, h));
  }
  cards.push(buildRollupCard(repoId, scores, hotspots, rollupTopN));

  const finishedAt = new Date();
  const passRun: PassRunInput = {
    repoId,
    passName: 'hotspots',
    status: 'SUCCESS',
    startedAt,
    finishedAt,
    // Deterministic pass — zero LLM cost, zero model.
    tokenCost: 0,
  };

  return { repoId, scores, hotspots, cards, passRun };
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function mergeWeights(override: Partial<HotspotWeights> | undefined): HotspotWeights {
  if (!override) return { ...DEFAULT_HOTSPOT_WEIGHTS };
  return {
    churn: override.churn ?? DEFAULT_HOTSPOT_WEIGHTS.churn,
    complexity: override.complexity ?? DEFAULT_HOTSPOT_WEIGHTS.complexity,
    inDegree: override.inDegree ?? DEFAULT_HOTSPOT_WEIGHTS.inDegree,
    coverage: override.coverage ?? DEFAULT_HOTSPOT_WEIGHTS.coverage,
  };
}

/**
 * Blend four 0..1 axis scores into a 0..1 final score. We normalize by the
 * sum of weights so callers can pass any positive numbers without having
 * to make them sum to 1.
 */
function blend(
  axes: HotspotScore['axes'],
  weights: HotspotWeights,
): number {
  const total =
    weights.churn + weights.complexity + weights.inDegree + weights.coverage;
  if (total <= 0) return 0;
  const weighted =
    axes.churn * weights.churn +
    axes.complexity * weights.complexity +
    axes.inDegree * weights.inDegree +
    axes.coverage * weights.coverage;
  // Clamp defensively — floating-point can nudge over 1.0 by epsilon.
  return Math.max(0, Math.min(1, weighted / total));
}

/**
 * Churn axis blends commit count + author count (50/50). A file touched
 * many times by one author is risky in a different way than the same file
 * touched by many authors; both raise the score.
 */
function churnAxis(
  churn: GitChurnSignal,
  maxCommits: number,
  maxAuthors: number,
): number {
  const commitsScore = churn.commitCount / maxCommits;
  const authorsScore = churn.uniqueAuthors / maxAuthors;
  return Math.max(0, Math.min(1, 0.5 * commitsScore + 0.5 * authorsScore));
}

function byScoreDesc(a: HotspotScore, b: HotspotScore): number {
  if (b.score !== a.score) return b.score - a.score;
  // Stable tiebreak on path so callers don't see jitter between runs.
  return a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0;
}

function indexByPath<T extends { filePath: string }>(
  signals: T[],
): Map<string, T> {
  const out = new Map<string, T>();
  for (const s of signals) out.set(s.filePath, s);
  return out;
}

// ---------------------------------------------------------------------------
// Card construction
// ---------------------------------------------------------------------------

/**
 * Concept path for a per-file hotspot card. Mirrors the contracts/gotchas
 * convention of `${repoId}/${repoRelativePath}` so the existing
 * `writeModuleCards` machinery in `synth.ts` can persist it without a
 * special case.
 */
export function hotspotConceptPath(repoId: string, filePath: string): string {
  return `${repoId}/${filePath}`;
}

/**
 * Concept path for the repository roll-up card. The dashboard's
 * `/v1/cards/hotspots` route resolves to this.
 */
export function hotspotsRollupConceptPath(repoId: string): string {
  return `${repoId}/hotspots`;
}

function buildHotspotCard(repoId: string, h: HotspotScore): CardInput {
  const body = renderHotspotBody(h);
  return {
    repoId,
    conceptPath: hotspotConceptPath(repoId, h.filePath),
    lod: 'STANDARD',
    level: 'MODULE',
    content: body,
    sourcePass: 'hotspots',
    tokenCount: Math.ceil(body.length / 4),
  };
}

function buildRollupCard(
  repoId: string,
  allScores: HotspotScore[],
  hotspots: HotspotScore[],
  rollupTopN: number,
): CardInput {
  // Only surface the hotspots themselves in the roll-up. Falling back to
  // "top scores" when no file crossed the threshold would lie about
  // severity — a cold repo's "top hotspot" isn't actually a hotspot.
  const body = renderRollupBody(
    hotspots.slice(0, rollupTopN),
    allScores.length,
  );
  return {
    repoId,
    conceptPath: hotspotsRollupConceptPath(repoId),
    lod: 'STANDARD',
    level: 'REPOSITORY',
    content: body,
    sourcePass: 'hotspots',
    tokenCount: Math.ceil(body.length / 4),
  };
}

/**
 * Render a single-file hotspot card body. Plain markdown so the existing
 * markdown reader/writer round-trips it without escaping issues.
 */
function renderHotspotBody(h: HotspotScore): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const lines: string[] = [];
  lines.push(`# Hotspot: ${h.filePath}`);
  lines.push('');
  lines.push(`**Score:** ${h.score.toFixed(3)} (0..1, higher = riskier)`);
  lines.push('');
  lines.push('## Axis breakdown');
  lines.push('');
  lines.push(`- Churn: ${pct(h.axes.churn)}`);
  lines.push(`- Complexity: ${pct(h.axes.complexity)}`);
  lines.push(`- In-degree (fan-in): ${pct(h.axes.inDegree)}`);
  lines.push(`- Uncovered (1 − coverage): ${pct(h.axes.coverage)}`);
  lines.push('');
  lines.push('## Raw signals');
  lines.push('');
  if (h.raw.churn) {
    lines.push(
      `- Commits in window: ${h.raw.churn.commitCount}, ` +
        `unique authors: ${h.raw.churn.uniqueAuthors}, ` +
        `days since last touch: ${h.raw.churn.daysSinceLastTouch}`,
    );
  } else {
    lines.push('- Git churn: _no commits in window_');
  }
  if (h.raw.complexity) {
    lines.push(
      `- SLOC: ${h.raw.complexity.sloc}, cyclomatic: ${h.raw.complexity.cyclomatic}`,
    );
  }
  if (h.raw.inDegree) {
    lines.push(
      `- In-degree: ${h.raw.inDegree.inDegree}, out-degree: ${h.raw.inDegree.outDegree}`,
    );
  }
  if (h.raw.coverage) {
    lines.push(
      `- Coverage — statements: ${pct(h.raw.coverage.statementCoverage)}, ` +
        `branches: ${pct(h.raw.coverage.branchCoverage)}, ` +
        `lines: ${pct(h.raw.coverage.lineCoverage)}`,
    );
  } else {
    lines.push('- Coverage: _no data_');
  }
  return lines.join('\n');
}

/**
 * Render the repository roll-up card body. Lists the top hotspots with a
 * one-line score so the dashboard can render a table without re-fetching
 * per-file cards.
 */
function renderRollupBody(top: HotspotScore[], totalScored: number): string {
  const lines: string[] = [];
  lines.push('# Repository hotspots');
  lines.push('');
  lines.push(
    `Scored ${totalScored} file${totalScored === 1 ? '' : 's'} ` +
      `across four signals (git churn, in-degree, complexity, ` +
      `coverage). Higher score = riskier.`,
  );
  lines.push('');
  if (top.length === 0) {
    lines.push('_No files scored above the hotspot threshold._');
    return lines.join('\n');
  }
  lines.push('## Top hotspots');
  lines.push('');
  for (const h of top) {
    lines.push(`- \`${h.filePath}\` — score ${h.score.toFixed(3)}`);
  }
  return lines.join('\n');
}
