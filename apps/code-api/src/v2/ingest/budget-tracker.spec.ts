/**
 * Tests for {@link BudgetTracker} (EC-48).
 *
 * Mirrors the in-memory fake style used by pass-run.repository.spec.ts —
 * a tiny stand-in for `prisma.passRun.findMany` lets us exercise the
 * UTC-day filter without spinning up a real database.
 *
 * Acceptance coverage (per Linear EC-48):
 *   1. under cap → ok
 *   2. at-or-above daily cap → aborts
 *   3. per-pass cap independent of daily cap
 *   4. multi-pass accumulation correct (in-process)
 *   5. UTC day boundary respected (yesterday's spend doesn't count)
 *   6. Prisma errors surface (not silently allowed)
 *   7. canStartPass ignores other repos' spend
 *   8. snapshot reflects per-pass breakdown
 *   9. recordSpend clamps negative / non-finite inputs
 */

import type { PassRun, Prisma } from '@prisma/client';

import { BudgetTracker, startOfUtcDay } from './budget-tracker';
import type { PassRunPrismaClient } from '../passes/pass-run.repository';

interface FakeRow {
  repoId: string;
  passName: string;
  startedAt: Date;
  tokenCost: number | null;
}

/**
 * Minimal `prisma.passRun` mock — only `findMany` is exercised by the
 * tracker. We deliberately do not implement the other methods to keep the
 * surface honest.
 */
function makeFakePrisma(rows: FakeRow[] = []): PassRunPrismaClient & {
  rows: FakeRow[];
  findManyCalls: number;
} {
  let findManyCalls = 0;
  const passRun = {
    create: jest.fn(),
    findMany: jest.fn(async (args: { where?: Prisma.PassRunWhereInput }) => {
      findManyCalls++;
      const where = args.where ?? {};
      let out = rows.slice();
      if (where.repoId !== undefined) {
        out = out.filter((r) => r.repoId === where.repoId);
      }
      if (where.startedAt !== undefined) {
        const sa = where.startedAt as { gte?: Date };
        if (sa.gte) out = out.filter((r) => r.startedAt >= sa.gte!);
      }
      return out as unknown as PassRun[];
    }),
    count: jest.fn(),
  };
  const client = { passRun } as unknown as PassRunPrismaClient & {
    rows: FakeRow[];
    findManyCalls: number;
  };
  Object.defineProperty(client, 'rows', { get: () => rows });
  Object.defineProperty(client, 'findManyCalls', { get: () => findManyCalls });
  return client;
}

const FIXED_NOW = new Date('2026-05-26T12:00:00Z'); // mid-UTC-day

function tracker(
  prisma: PassRunPrismaClient,
  overrides: {
    dailyCap?: number;
    perPassCap?: number;
    now?: () => Date;
    repoId?: string;
  } = {},
) {
  return new BudgetTracker({
    dailyCap: overrides.dailyCap ?? 1000,
    perPassCap: overrides.perPassCap ?? 500,
    prisma,
    repoId: overrides.repoId ?? 'repo-a',
    now: overrides.now ?? (() => FIXED_NOW),
  });
}

describe('BudgetTracker', () => {
  it('allows a pass when total spend is below the daily cap', async () => {
    const prisma = makeFakePrisma([
      {
        repoId: 'repo-a',
        passName: 'contracts',
        startedAt: new Date('2026-05-26T01:00:00Z'),
        tokenCost: 100,
      },
    ]);
    const t = tracker(prisma);
    const decision = await t.canStartPass('gotchas');
    expect(decision.ok).toBe(true);
    expect(decision.remainingDaily).toBe(900);
  });

  it('aborts when historical + in-process spend already meets the daily cap', async () => {
    const prisma = makeFakePrisma([
      {
        repoId: 'repo-a',
        passName: 'contracts',
        startedAt: new Date('2026-05-26T01:00:00Z'),
        tokenCost: 600,
      },
    ]);
    const t = tracker(prisma, { dailyCap: 1000 });
    t.recordSpend('gotchas', 400); // brings us to 1000
    const decision = await t.canStartPass('subsystem');
    expect(decision.ok).toBe(false);
    expect(decision.reason).toBe('budget-exceeded:daily');
    expect(decision.remainingDaily).toBe(0);
  });

  it('enforces per-pass cap independently of daily cap', async () => {
    const prisma = makeFakePrisma();
    const t = tracker(prisma, { dailyCap: 10_000, perPassCap: 500 });
    t.recordSpend('contracts', 500); // hits per-pass cap exactly
    const decision = await t.canStartPass('contracts');
    expect(decision.ok).toBe(false);
    expect(decision.reason).toBe('budget-exceeded:per-pass');
    // Daily room remains; only the per-pass slot is exhausted.
    expect(decision.remainingDaily).toBe(9500);

    // A different pass with no prior spend is still allowed.
    const other = await t.canStartPass('gotchas');
    expect(other.ok).toBe(true);
  });

  it('accumulates in-process spend across multiple passes', async () => {
    const prisma = makeFakePrisma();
    const t = tracker(prisma, { dailyCap: 1000, perPassCap: 1000 });
    t.recordSpend('contracts', 200);
    t.recordSpend('gotchas', 300);
    t.recordSpend('subsystem', 100);

    const decision = await t.canStartPass('synthesis-repository');
    expect(decision.ok).toBe(true);
    expect(decision.remainingDaily).toBe(400);

    const snap = t.snapshot();
    expect(snap.dailySpentSoFar).toBe(600);
    expect(snap.perPassSpend).toEqual({
      contracts: 200,
      gotchas: 300,
      subsystem: 100,
    });
  });

  it('respects the UTC day boundary (yesterday spend does not count)', async () => {
    const prisma = makeFakePrisma([
      // 23:59 UTC the previous day — must be excluded.
      {
        repoId: 'repo-a',
        passName: 'contracts',
        startedAt: new Date('2026-05-25T23:59:00Z'),
        tokenCost: 5000,
      },
      // 00:01 UTC today — must be included.
      {
        repoId: 'repo-a',
        passName: 'gotchas',
        startedAt: new Date('2026-05-26T00:01:00Z'),
        tokenCost: 200,
      },
    ]);
    const t = tracker(prisma, { dailyCap: 1000 });
    const decision = await t.canStartPass('subsystem');
    expect(decision.ok).toBe(true);
    expect(decision.remainingDaily).toBe(800);

    // Sanity check the boundary helper.
    expect(startOfUtcDay(FIXED_NOW).toISOString()).toBe(
      '2026-05-26T00:00:00.000Z',
    );
  });

  it('surfaces Prisma errors instead of silently allowing', async () => {
    const prisma = makeFakePrisma();
    (prisma.passRun.findMany as jest.Mock).mockRejectedValueOnce(
      new Error('connection refused'),
    );
    const t = tracker(prisma);
    await expect(t.canStartPass('contracts')).rejects.toThrow(
      'connection refused',
    );
  });

  it('only counts spend from the configured repo', async () => {
    const prisma = makeFakePrisma([
      {
        repoId: 'repo-other',
        passName: 'contracts',
        startedAt: new Date('2026-05-26T01:00:00Z'),
        tokenCost: 9999,
      },
      {
        repoId: 'repo-a',
        passName: 'contracts',
        startedAt: new Date('2026-05-26T01:00:00Z'),
        tokenCost: 100,
      },
    ]);
    const t = tracker(prisma, { repoId: 'repo-a', dailyCap: 1000 });
    const decision = await t.canStartPass('gotchas');
    expect(decision.ok).toBe(true);
    expect(decision.remainingDaily).toBe(900);
  });

  it('snapshot returns a fresh object (mutations do not leak)', async () => {
    const prisma = makeFakePrisma();
    const t = tracker(prisma);
    t.recordSpend('contracts', 50);
    const snap = t.snapshot();
    snap.perPassSpend.contracts = 999;
    snap.dailySpentSoFar = 999;
    const snap2 = t.snapshot();
    expect(snap2.perPassSpend.contracts).toBe(50);
    expect(snap2.dailySpentSoFar).toBe(50);
  });

  it('clamps negative / non-finite recordSpend inputs to zero', async () => {
    const prisma = makeFakePrisma();
    const t = tracker(prisma);
    t.recordSpend('contracts', -100);
    t.recordSpend('contracts', Number.NaN);
    t.recordSpend('contracts', Number.POSITIVE_INFINITY);
    t.recordSpend('contracts', 0);
    expect(t.snapshot().dailySpentSoFar).toBe(0);
    expect(t.snapshot().perPassSpend).toEqual({});
  });

  it('floors fractional token counts before recording', async () => {
    const prisma = makeFakePrisma();
    const t = tracker(prisma, { dailyCap: 1000 });
    t.recordSpend('contracts', 100.9);
    expect(t.snapshot().dailySpentSoFar).toBe(100);
  });
});
