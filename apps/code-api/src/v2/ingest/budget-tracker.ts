/**
 * Budget guardrails (EC-48).
 *
 * Phase 3 spec: `config.budget.perPassTokenCap` and `dailyTokenCap` have
 * existed in the resolver since EC-27 but were advisory — nothing actually
 * stopped a runaway pass from blowing through the daily allowance. This
 * tracker is consulted by the conductor before each pass and aborts when
 * the per-repo daily total (read from `pass_runs.tokenCost`) would cross
 * the cap.
 *
 *   conductor:  const decision = await tracker.canStartPass('contracts');
 *               if (!decision.ok) → persist FAILED row, skip pass.
 *
 * Daily-window semantics are **UTC**: a "day" runs midnight-to-midnight UTC
 * to keep the math timezone-agnostic (the same repo ingesting from two
 * different shells shouldn't get a different answer based on $TZ).
 *
 * In-process spend is layered on top of the DB query so a single ingest
 * run can't outrun its own quota inside one process — `recordSpend` adds
 * to the tracker after each pass, and the next `canStartPass` reflects it
 * without waiting for the DB roundtrip.
 *
 * Failures from the Prisma query are intentionally surfaced to the caller;
 * see EC-48 acceptance — silently allowing on a DB error would defeat the
 * point of the guardrail.
 */

import type { Prisma } from '@prisma/client';

import type { PassRunPrismaClient } from '../passes/pass-run.repository';

/** Discriminator for which cap was hit. */
export type BudgetExceededReason =
  | 'budget-exceeded:daily'
  | 'budget-exceeded:per-pass';

export interface CanStartPassDecision {
  ok: boolean;
  /** Populated when `ok === false`; matches the `errorMessage` we log on the FAILED row. */
  reason?: BudgetExceededReason;
  /** Remaining daily budget *after* prior in-process spend. Never negative. */
  remainingDaily: number;
}

export interface BudgetSnapshot {
  dailySpentSoFar: number;
  perPassSpend: Record<string, number>;
}

export interface BudgetTrackerOpts {
  /** Hard ceiling across all passes for this repo on the current UTC day. */
  dailyCap: number;
  /** Hard ceiling for any single pass invocation. */
  perPassCap: number;
  prisma: PassRunPrismaClient;
  repoId: string;
  /** Injected clock for deterministic tests. Defaults to `() => new Date()`. */
  now?: () => Date;
}

/**
 * Per-ingest budget bookkeeper. One instance per ingest run — the
 * in-process counters die with the run, but `canStartPass` always re-reads
 * the historical daily total from `pass_runs` so a *new* ingest starting
 * later in the same UTC day still sees prior spend.
 */
export class BudgetTracker {
  private readonly dailyCap: number;
  private readonly perPassCap: number;
  private readonly prisma: PassRunPrismaClient;
  private readonly repoId: string;
  private readonly now: () => Date;

  /** Tokens spent by *this* tracker since construction, summed across all passes. */
  private inProcessSpend = 0;
  /** Per-pass breakdown for this tracker — surfaced via {@link snapshot}. */
  private readonly perPass: Map<string, number> = new Map();

  constructor(opts: BudgetTrackerOpts) {
    this.dailyCap = opts.dailyCap;
    this.perPassCap = opts.perPassCap;
    this.prisma = opts.prisma;
    this.repoId = opts.repoId;
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * Decide whether `passName` is allowed to start. Sums today's
   * `pass_runs.tokenCost` for the repo (UTC day boundary), adds any
   * in-process spend that hasn't been flushed to the DB yet, and rejects
   * when the total has already reached or exceeded the daily cap.
   *
   * The per-pass cap is *advisory* at start time — we don't know how many
   * tokens this pass will consume — but if its prior in-process spend for
   * this run already hit the cap (e.g. a retry loop), we refuse to start
   * another invocation.
   *
   * Prisma errors propagate; callers should treat them as fatal for the
   * pass (and log a FAILED row).
   */
  async canStartPass(passName: string): Promise<CanStartPassDecision> {
    const dailyHistorical = await this.queryDailyHistoricalSpend();
    const dailyTotal = dailyHistorical + this.inProcessSpend;
    const remainingDaily = Math.max(0, this.dailyCap - dailyTotal);

    if (dailyTotal >= this.dailyCap) {
      return {
        ok: false,
        reason: 'budget-exceeded:daily',
        remainingDaily: 0,
      };
    }

    const priorPerPass = this.perPass.get(passName) ?? 0;
    if (priorPerPass >= this.perPassCap) {
      return {
        ok: false,
        reason: 'budget-exceeded:per-pass',
        remainingDaily,
      };
    }

    return { ok: true, remainingDaily };
  }

  /**
   * Synchronously record spend after a pass returns. The next
   * `canStartPass` will reflect this without re-querying the DB.
   *
   * Negative or non-finite inputs are clamped to 0 — defensive against
   * upstream bugs in pass orchestrators.
   */
  recordSpend(passName: string, tokens: number): void {
    const safe = Number.isFinite(tokens) && tokens > 0 ? Math.floor(tokens) : 0;
    if (safe === 0) return;
    this.inProcessSpend += safe;
    this.perPass.set(passName, (this.perPass.get(passName) ?? 0) + safe);
  }

  /** Snapshot of in-process counters; the DB-side total isn't included. */
  snapshot(): BudgetSnapshot {
    const perPassSpend: Record<string, number> = {};
    for (const [k, v] of this.perPass) perPassSpend[k] = v;
    return {
      dailySpentSoFar: this.inProcessSpend,
      perPassSpend,
    };
  }

  /**
   * Sum `tokenCost` from `pass_runs` for this repo since the start of the
   * current UTC day. Done in JS rather than SQL aggregate so tests can
   * exercise the path with an in-memory fake (Prisma `aggregate` would
   * require a heavier mock).
   */
  private async queryDailyHistoricalSpend(): Promise<number> {
    const since = startOfUtcDay(this.now());
    const where: Prisma.PassRunWhereInput = {
      repoId: this.repoId,
      startedAt: { gte: since },
    };
    const rows = await this.prisma.passRun.findMany({ where });
    let total = 0;
    for (const r of rows) {
      const cost = r.tokenCost;
      if (typeof cost === 'number' && Number.isFinite(cost) && cost > 0) {
        total += cost;
      }
    }
    return total;
  }
}

/**
 * Truncate a Date to the start of its UTC day. Exported for test
 * fixtures that need to compare against the same boundary the tracker uses.
 */
export function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
  );
}
