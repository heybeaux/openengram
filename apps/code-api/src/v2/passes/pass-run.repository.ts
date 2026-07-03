/**
 * Pass-run persistence + aggregates (EC-47).
 *
 * Every higher pass already emits a {@link PassRunInput} as part of its
 * orchestrator result, but the rows were never persisted — `runSynth` just
 * dropped them on the floor. This module is the single place that knows how
 * to turn a `PassRunInput` into a `pass_runs` row, plus the read-side
 * aggregates that back the `/v2/pass-runs/stats` endpoint.
 *
 * Three exports:
 *   - {@link persistPassRun}  → write one row (insert-only — runs are append-only ledger entries)
 *   - {@link getRecentRuns}   → list recent runs filtered by repo / pass / status
 *   - {@link getRunStats}     → per-pass aggregates (count, success rate, avg tokens, p50/p95)
 *
 * Plus {@link wrapPassRun}, a thin async helper that records start/finish
 * timestamps + catches errors and persists a FAILED row so callers don't have
 * to wire try/finally by hand. Currently unused by the four orchestrators
 * (they already build a `PassRunInput` end-to-end and we pass it through);
 * `wrapPassRun` exists as the documented seam for new passes.
 *
 * The Prisma client is accepted via the structural `Pick<PrismaClient,
 * 'passRun'>` so unit tests can inject a tiny mock.
 *
 * Spec: Linear EC-47.
 */

import type {
  PassRun,
  PassRunStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';

import type { PassRunInput } from '../types/cards';

/** Subset of Prisma we need — keeps the test mock surface minimal. */
export type PassRunPrismaClient = Pick<PrismaClient, 'passRun'>;

/**
 * Insert a single `pass_runs` row from an in-memory {@link PassRunInput}.
 *
 * `durationMs` is derived from `finishedAt - startedAt` when both are
 * present, so callers don't have to compute it themselves. `metadata` is
 * passed through verbatim.
 *
 * Returns the freshly-inserted row (with the generated `id`) so callers can
 * correlate downstream artifacts (e.g. a card row) with the run that produced
 * them.
 */
export async function persistPassRun(
  prisma: PassRunPrismaClient,
  run: PassRunInput,
): Promise<PassRun> {
  const startedAt = run.startedAt ?? new Date();
  const finishedAt = run.finishedAt;
  const durationMs =
    finishedAt !== undefined
      ? Math.max(0, finishedAt.getTime() - startedAt.getTime())
      : null;

  // Build the create payload field-by-field so we never send `undefined` to
  // Prisma (it tightens nullability rules in v6).
  const data: Prisma.PassRunUncheckedCreateInput = {
    repoId: run.repoId,
    passName: run.passName,
    status: run.status ?? 'SUCCESS',
    startedAt,
  };
  if (finishedAt !== undefined) data.finishedAt = finishedAt;
  if (durationMs !== null) data.durationMs = durationMs;
  if (run.model !== undefined) data.model = run.model;
  if (run.tokenCost !== undefined) data.tokenCost = run.tokenCost;
  if (run.inputHash !== undefined) data.inputHash = run.inputHash;
  if (run.outputHash !== undefined) data.outputHash = run.outputHash;
  if (run.errorMessage !== undefined) data.errorMessage = run.errorMessage;
  if (run.metadata !== undefined) {
    data.metadata = run.metadata as Prisma.InputJsonValue;
  }

  return prisma.passRun.create({ data });
}

export interface GetRecentRunsOptions {
  repoId?: string;
  passName?: string;
  status?: PassRunStatus;
  /** Default 50; capped at 500 to avoid runaway responses. */
  limit?: number;
  /** Skip the first N rows (for offset-based pagination). */
  offset?: number;
}

export interface GetRecentRunsResult {
  rows: PassRun[];
  total: number;
  limit: number;
  offset: number;
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 500;

/**
 * Fetch recent pass runs, newest first, along with the total count of rows
 * matching the same filters. Any combination of filters can be omitted;
 * passing none returns the global tail of the ledger.
 *
 * The total is returned alongside the rows so HTTP callers can render
 * "page X of Y" UIs without a second round-trip. Both queries share the
 * same `where` so they always agree.
 */
export async function getRecentRuns(
  prisma: PassRunPrismaClient,
  opts: GetRecentRunsOptions = {},
): Promise<GetRecentRunsResult> {
  const where: Prisma.PassRunWhereInput = {};
  if (opts.repoId !== undefined) where.repoId = opts.repoId;
  if (opts.passName !== undefined) where.passName = opts.passName;
  if (opts.status !== undefined) where.status = opts.status;

  const limit = clampLimit(opts.limit ?? DEFAULT_LIST_LIMIT);
  const offset = clampOffset(opts.offset ?? 0);
  const [rows, total] = await Promise.all([
    prisma.passRun.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.passRun.count({ where }),
  ]);
  return { rows, total, limit, offset };
}

function clampLimit(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIST_LIMIT;
  return Math.min(Math.floor(n), MAX_LIST_LIMIT);
}

function clampOffset(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/**
 * Per-pass aggregate shape returned by {@link getRunStats}. One entry per
 * distinct `passName` observed in the window.
 *
 * `p50Ms` / `p95Ms` are computed from `durationMs` (null durations excluded).
 * `avgTokenCost` averages the populated `tokenCost` values.
 */
export interface PassRunStats {
  passName: string;
  runs: number;
  successRate: number;
  avgTokenCost: number;
  avgDurationMs: number;
  p50Ms: number;
  p95Ms: number;
  /** ISO timestamp of the most recent run in this window, or null if none. */
  lastRunAt: string | null;
}

export interface GetRunStatsOptions {
  /** Defaults to 7 days when omitted. */
  windowDays?: number;
}

const DEFAULT_STATS_WINDOW_DAYS = 7;

/**
 * Aggregate per-pass stats over the trailing `windowDays`. We pull the raw
 * rows and aggregate in memory so the percentile math is portable across
 * Postgres versions (Prisma's `aggregate` doesn't expose `PERCENTILE_CONT`).
 *
 * The row volume is bounded by the `pass_runs` table size — typically a few
 * hundred per repo per week — so the in-memory sort is fine for the
 * foreseeable future. If/when we cross 100k rows per window we can move
 * this to a raw SQL query against `percentile_disc(...)`.
 */
export async function getRunStats(
  prisma: PassRunPrismaClient,
  repoIdOrOpts?: string | GetRunStatsOptions,
  maybeOpts?: GetRunStatsOptions,
): Promise<PassRunStats[]> {
  const repoId = typeof repoIdOrOpts === 'string' ? repoIdOrOpts : undefined;
  const opts: GetRunStatsOptions =
    (typeof repoIdOrOpts === 'string' ? maybeOpts : repoIdOrOpts) ?? {};
  const windowDays = opts.windowDays ?? DEFAULT_STATS_WINDOW_DAYS;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const where: Prisma.PassRunWhereInput = { startedAt: { gte: since } };
  if (repoId !== undefined) where.repoId = repoId;

  const rows = await prisma.passRun.findMany({
    where,
    orderBy: { startedAt: 'asc' },
  });

  const byPass = new Map<string, PassRun[]>();
  for (const row of rows) {
    const arr = byPass.get(row.passName) ?? [];
    arr.push(row);
    byPass.set(row.passName, arr);
  }

  const out: PassRunStats[] = [];
  for (const [passName, group] of byPass) {
    const runs = group.length;
    const successes = group.filter((r) => r.status === 'SUCCESS').length;
    const tokens = group
      .map((r) => r.tokenCost)
      .filter((t): t is number => typeof t === 'number');
    const durations = group
      .map((r) => r.durationMs)
      .filter((d): d is number => typeof d === 'number')
      .sort((a, b) => a - b);
    const lastRunAt = group.reduce<Date | null>((acc, r) => {
      const ts = r.finishedAt ?? r.startedAt;
      return acc === null || ts > acc ? ts : acc;
    }, null);

    out.push({
      passName,
      runs,
      successRate: runs > 0 ? successes / runs : 0,
      avgTokenCost: tokens.length > 0 ? sum(tokens) / tokens.length : 0,
      avgDurationMs:
        durations.length > 0 ? sum(durations) / durations.length : 0,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      lastRunAt: lastRunAt ? lastRunAt.toISOString() : null,
    });
  }

  // Stable alphabetical order — callers can re-sort if they care about
  // a different ranking.
  out.sort((a, b) => a.passName.localeCompare(b.passName));
  return out;
}

function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

/**
 * Nearest-rank percentile against a sorted ascending array. Returns 0 when
 * the array is empty so callers don't have to special-case "no data yet".
 */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = Math.ceil(p * sortedAsc.length);
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1));
  return sortedAsc[idx];
}

/**
 * Wrap an async pass body so start/finish bookkeeping + error capture happen
 * in one place. New passes can call this instead of constructing a
 * `PassRunInput` by hand:
 *
 * ```ts
 * const run = await wrapPassRun(prisma, 'my-pass', repoId, async () => {
 *   const result = await doWork();
 *   return { tokenCost: result.tokens, model: 'opus-4-7', result };
 * });
 * ```
 *
 * The function callback returns optional `tokenCost` / `model` / `metadata`
 * fields plus an arbitrary `result` payload that's returned to the caller.
 * Existing pass orchestrators (contracts/gotchas/subsystem/repository) build
 * their own `PassRunInput` and feed it straight to `persistPassRun` — they
 * pre-date this helper and don't need to migrate.
 */
export interface WrapPassRunResult<T> {
  run: PassRun;
  result: T | undefined;
  /** True when the wrapped function threw. */
  failed: boolean;
}

export interface WrapPassRunCallbackReturn<T> {
  tokenCost?: number;
  model?: string;
  inputHash?: string;
  outputHash?: string;
  metadata?: Record<string, unknown>;
  result: T;
}

export async function wrapPassRun<T>(
  prisma: PassRunPrismaClient,
  passName: string,
  repoId: string,
  fn: () => Promise<WrapPassRunCallbackReturn<T>>,
): Promise<WrapPassRunResult<T>> {
  const startedAt = new Date();
  try {
    const payload = await fn();
    const finishedAt = new Date();
    const run = await persistPassRun(prisma, {
      repoId,
      passName: passName as PassRunInput['passName'],
      status: 'SUCCESS',
      startedAt,
      finishedAt,
      tokenCost: payload.tokenCost,
      model: payload.model,
      inputHash: payload.inputHash,
      outputHash: payload.outputHash,
      metadata: payload.metadata,
    });
    return { run, result: payload.result, failed: false };
  } catch (err) {
    const finishedAt = new Date();
    const run = await persistPassRun(prisma, {
      repoId,
      passName: passName as PassRunInput['passName'],
      status: 'FAILED',
      startedAt,
      finishedAt,
      errorMessage: (err as Error).message ?? String(err),
    });
    return { run, result: undefined, failed: true };
  }
}
