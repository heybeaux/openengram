/**
 * Tests for the pass-run repository (EC-47).
 *
 * Unit-level — drives the helpers against an in-memory fake of
 * `prisma.passRun`. The fake intentionally mirrors only the methods we
 * use (`create`, `findMany`, `count`); anything else would be over-fit.
 * The intent here is to pin behaviour:
 *
 *   - `persistPassRun` computes `durationMs` from `finishedAt - startedAt`,
 *     defaults `status` to SUCCESS, and stamps `startedAt` when missing.
 *   - `getRecentRuns` applies filters, clamps pagination, and returns the
 *     parallel total count.
 *   - `getRunStats` aggregates per-pass (success rate, avg, p50/p95,
 *     lastRunAt) over the trailing window.
 *   - `wrapPassRun` writes one row on success and one on failure.
 */

import type { PassRun, PassRunStatus, Prisma } from '@prisma/client';

import {
  getRecentRuns,
  getRunStats,
  persistPassRun,
  wrapPassRun,
  type PassRunPrismaClient,
} from './pass-run.repository';

interface FakeRow {
  id: string;
  repoId: string;
  passName: string;
  status: PassRunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  tokenCost: number | null;
  model: string | null;
  inputHash: string | null;
  outputHash: string | null;
  errorMessage: string | null;
  metadata: unknown;
}

/**
 * Tiny in-memory stand-in for `prisma.passRun`. Just enough surface to
 * exercise the repository functions; nothing more.
 */
function makeFakePrisma(): PassRunPrismaClient & { rows: FakeRow[] } {
  const rows: FakeRow[] = [];
  let nextId = 1;

  function matches(row: FakeRow, where: Prisma.PassRunWhereInput): boolean {
    if (where.repoId !== undefined && row.repoId !== where.repoId) return false;
    if (where.passName !== undefined && row.passName !== where.passName)
      return false;
    if (where.status !== undefined && row.status !== where.status) return false;
    if (where.startedAt !== undefined) {
      const sa = where.startedAt as { gte?: Date };
      if (sa.gte && row.startedAt < sa.gte) return false;
    }
    return true;
  }

  const passRun = {
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row: FakeRow = {
        id: `pr-${nextId++}`,
        repoId: String(data.repoId),
        passName: String(data.passName),
        status: (data.status as PassRunStatus) ?? 'PENDING',
        startedAt: (data.startedAt as Date) ?? new Date(),
        finishedAt: (data.finishedAt as Date | undefined) ?? null,
        durationMs: (data.durationMs as number | undefined) ?? null,
        tokenCost: (data.tokenCost as number | undefined) ?? null,
        model: (data.model as string | undefined) ?? null,
        inputHash: (data.inputHash as string | undefined) ?? null,
        outputHash: (data.outputHash as string | undefined) ?? null,
        errorMessage: (data.errorMessage as string | undefined) ?? null,
        metadata: data.metadata ?? null,
      };
      rows.push(row);
      return row as unknown as PassRun;
    }),
    findMany: jest.fn(
      async (
        args: {
          where?: Prisma.PassRunWhereInput;
          orderBy?: { startedAt: 'asc' | 'desc' };
          take?: number;
          skip?: number;
        } = {},
      ) => {
        const where = args.where ?? {};
        let out = rows.filter((r) => matches(r, where));
        const order = args.orderBy?.startedAt ?? 'asc';
        out.sort((a, b) =>
          order === 'asc'
            ? a.startedAt.getTime() - b.startedAt.getTime()
            : b.startedAt.getTime() - a.startedAt.getTime(),
        );
        if (args.skip) out = out.slice(args.skip);
        if (args.take !== undefined) out = out.slice(0, args.take);
        return out as unknown as PassRun[];
      },
    ),
    count: jest.fn(async (args: { where?: Prisma.PassRunWhereInput } = {}) => {
      const where = args.where ?? {};
      return rows.filter((r) => matches(r, where)).length;
    }),
  };

  return { passRun, rows } as unknown as PassRunPrismaClient & {
    rows: FakeRow[];
  };
}

describe('pass-run repository', () => {
  describe('persistPassRun', () => {
    it('computes durationMs from finishedAt - startedAt', async () => {
      const prisma = makeFakePrisma();
      const startedAt = new Date('2026-05-26T00:00:00Z');
      const finishedAt = new Date('2026-05-26T00:00:01.500Z');
      await persistPassRun(prisma, {
        repoId: 'r1',
        passName: 'contracts',
        status: 'SUCCESS',
        startedAt,
        finishedAt,
        tokenCost: 150,
        model: 'sonnet-4-6',
      });
      expect(prisma.rows).toHaveLength(1);
      expect(prisma.rows[0].durationMs).toBe(1500);
      expect(prisma.rows[0].status).toBe('SUCCESS');
      expect(prisma.rows[0].tokenCost).toBe(150);
    });

    it('defaults status to SUCCESS and stamps startedAt when missing', async () => {
      const prisma = makeFakePrisma();
      await persistPassRun(prisma, {
        repoId: 'r1',
        passName: 'structure',
      });
      expect(prisma.rows[0].status).toBe('SUCCESS');
      expect(prisma.rows[0].startedAt).toBeInstanceOf(Date);
      // No finishedAt → no durationMs.
      expect(prisma.rows[0].durationMs).toBeNull();
    });

    it('clamps negative durations to 0 (clock skew defense)', async () => {
      const prisma = makeFakePrisma();
      await persistPassRun(prisma, {
        repoId: 'r1',
        passName: 'contracts',
        startedAt: new Date('2026-05-26T00:00:05Z'),
        finishedAt: new Date('2026-05-26T00:00:00Z'),
      });
      expect(prisma.rows[0].durationMs).toBe(0);
    });

    it('forwards metadata when provided', async () => {
      const prisma = makeFakePrisma();
      await persistPassRun(prisma, {
        repoId: 'r1',
        passName: 'gotchas',
        metadata: { retries: 2 },
      });
      expect(prisma.rows[0].metadata).toEqual({ retries: 2 });
    });
  });

  describe('getRecentRuns', () => {
    async function seed(prisma: PassRunPrismaClient) {
      const base = new Date('2026-05-26T00:00:00Z').getTime();
      for (let i = 0; i < 7; i++) {
        await persistPassRun(prisma, {
          repoId: i % 2 === 0 ? 'r1' : 'r2',
          passName: i % 3 === 0 ? 'contracts' : 'gotchas',
          status: i === 5 ? 'FAILED' : 'SUCCESS',
          startedAt: new Date(base + i * 1000),
          finishedAt: new Date(base + i * 1000 + 500),
        });
      }
    }

    it('returns newest first with total count', async () => {
      const prisma = makeFakePrisma();
      await seed(prisma);
      const res = await getRecentRuns(prisma);
      expect(res.total).toBe(7);
      expect(res.rows[0].startedAt.getTime()).toBeGreaterThan(
        res.rows[1].startedAt.getTime(),
      );
    });

    it('honours limit/offset and clamps over-large limits', async () => {
      const prisma = makeFakePrisma();
      await seed(prisma);
      const page1 = await getRecentRuns(prisma, { limit: 3, offset: 0 });
      const page2 = await getRecentRuns(prisma, { limit: 3, offset: 3 });
      expect(page1.rows).toHaveLength(3);
      expect(page2.rows).toHaveLength(3);
      expect(page1.rows[0].id).not.toBe(page2.rows[0].id);

      const overSized = await getRecentRuns(prisma, { limit: 10000 });
      expect(overSized.limit).toBeLessThanOrEqual(500);
    });

    it('filters by passName, status, and repoId', async () => {
      const prisma = makeFakePrisma();
      await seed(prisma);
      const failed = await getRecentRuns(prisma, { status: 'FAILED' });
      expect(failed.total).toBe(1);
      expect(failed.rows[0].status).toBe('FAILED');

      const r1 = await getRecentRuns(prisma, { repoId: 'r1' });
      expect(r1.rows.every((r) => r.repoId === 'r1')).toBe(true);

      const contracts = await getRecentRuns(prisma, { passName: 'contracts' });
      expect(contracts.rows.every((r) => r.passName === 'contracts')).toBe(
        true,
      );
    });
  });

  describe('getRunStats', () => {
    it('aggregates runs per pass with successRate / durations / lastRunAt', async () => {
      const prisma = makeFakePrisma();
      const now = Date.now();
      // 4 contracts: 3 success, 1 fail, durations 100,200,300,400
      for (let i = 0; i < 4; i++) {
        await persistPassRun(prisma, {
          repoId: 'r1',
          passName: 'contracts',
          status: i === 3 ? 'FAILED' : 'SUCCESS',
          startedAt: new Date(now - 1_000_000 + i),
          finishedAt: new Date(now - 1_000_000 + i + (i + 1) * 100),
          tokenCost: 100,
        });
      }
      // 1 gotchas — should appear separately
      await persistPassRun(prisma, {
        repoId: 'r1',
        passName: 'gotchas',
        status: 'SUCCESS',
        startedAt: new Date(now - 500),
        finishedAt: new Date(now - 100),
        tokenCost: 50,
      });

      const stats = await getRunStats(prisma, 'r1');
      const contracts = stats.find((s) => s.passName === 'contracts');
      const gotchas = stats.find((s) => s.passName === 'gotchas');
      expect(contracts).toBeDefined();
      expect(contracts!.runs).toBe(4);
      expect(contracts!.successRate).toBeCloseTo(0.75);
      expect(contracts!.avgTokenCost).toBe(100);
      expect(contracts!.avgDurationMs).toBe(250);
      expect(contracts!.lastRunAt).not.toBeNull();
      expect(gotchas!.runs).toBe(1);
    });

    it('works without repoId (global stats)', async () => {
      const prisma = makeFakePrisma();
      const now = Date.now();
      await persistPassRun(prisma, {
        repoId: 'r1',
        passName: 'structure',
        startedAt: new Date(now - 1000),
        finishedAt: new Date(now - 900),
      });
      await persistPassRun(prisma, {
        repoId: 'r2',
        passName: 'structure',
        startedAt: new Date(now - 800),
        finishedAt: new Date(now - 700),
      });
      const stats = await getRunStats(prisma);
      expect(stats).toHaveLength(1);
      expect(stats[0].runs).toBe(2);
    });

    it('excludes rows outside the window', async () => {
      const prisma = makeFakePrisma();
      // Way before the default 7-day window.
      await persistPassRun(prisma, {
        repoId: 'r1',
        passName: 'structure',
        startedAt: new Date('2025-01-01T00:00:00Z'),
        finishedAt: new Date('2025-01-01T00:00:01Z'),
      });
      const stats = await getRunStats(prisma, 'r1');
      expect(stats).toHaveLength(0);
    });
  });

  describe('wrapPassRun', () => {
    it('writes a SUCCESS row when the callback resolves', async () => {
      const prisma = makeFakePrisma();
      const out = await wrapPassRun(prisma, 'contracts', 'r1', async () => ({
        tokenCost: 42,
        model: 'sonnet-4-6',
        result: 'ok',
      }));
      expect(out.failed).toBe(false);
      expect(out.result).toBe('ok');
      expect(prisma.rows).toHaveLength(1);
      expect(prisma.rows[0].status).toBe('SUCCESS');
      expect(prisma.rows[0].tokenCost).toBe(42);
    });

    it('writes a FAILED row when the callback throws', async () => {
      const prisma = makeFakePrisma();
      const out = await wrapPassRun(prisma, 'gotchas', 'r1', async () => {
        throw new Error('boom');
      });
      expect(out.failed).toBe(true);
      expect(prisma.rows[0].status).toBe('FAILED');
      expect(prisma.rows[0].errorMessage).toBe('boom');
    });
  });
});
