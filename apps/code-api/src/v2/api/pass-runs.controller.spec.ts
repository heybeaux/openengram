/**
 * Tests for the pass-runs HTTP controller (EC-47).
 *
 * Boots a Nest app with PrismaService swapped for a tiny in-memory fake
 * so we exercise the real controller wiring (param parsing, error mapping,
 * response serialisation) without standing up a Postgres instance.
 *
 * Asserts:
 *   - `GET /v1/pass-runs` paginates, filters, and serialises dates to ISO.
 *   - `GET /v1/pass-runs` rejects bad `status` / non-integer `limit` with 400.
 *   - `GET /v1/pass-runs/stats` returns one entry per pass with the
 *     expected aggregate fields.
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { PrismaService } from '../../prisma/prisma.service';
import { PassRunsController } from './pass-runs.controller';

interface FakeRow {
  id: string;
  repoId: string;
  passName: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  tokenCost: number | null;
  model: string | null;
  errorMessage: string | null;
}

class FakePrisma {
  rows: FakeRow[] = [];
  passRun = {
    create: jest.fn(async () => null as never),
    findMany: jest.fn(
      async (
        args: {
          where?: Record<string, unknown>;
          orderBy?: { startedAt: 'asc' | 'desc' };
          take?: number;
          skip?: number;
        } = {},
      ) => {
        let out = this.rows.filter((r) => this.matches(r, args.where ?? {}));
        const order = args.orderBy?.startedAt ?? 'asc';
        out.sort((a, b) =>
          order === 'asc'
            ? a.startedAt.getTime() - b.startedAt.getTime()
            : b.startedAt.getTime() - a.startedAt.getTime(),
        );
        if (args.skip) out = out.slice(args.skip);
        if (args.take !== undefined) out = out.slice(0, args.take);
        return out;
      },
    ),
    count: jest.fn(
      async (args: { where?: Record<string, unknown> } = {}) =>
        this.rows.filter((r) => this.matches(r, args.where ?? {})).length,
    ),
  };

  private matches(row: FakeRow, where: Record<string, unknown>): boolean {
    if (where.repoId !== undefined && row.repoId !== where.repoId) return false;
    if (where.passName !== undefined && row.passName !== where.passName)
      return false;
    if (where.status !== undefined && row.status !== where.status) return false;
    const sa = where.startedAt as { gte?: Date } | undefined;
    if (sa?.gte && row.startedAt < sa.gte) return false;
    return true;
  }
}

describe('PassRunsController (supertest)', () => {
  let app: INestApplication;
  let fake: FakePrisma;

  beforeEach(async () => {
    fake = new FakePrisma();
    const moduleRef = await Test.createTestingModule({
      controllers: [PassRunsController],
      providers: [{ provide: PrismaService, useValue: fake }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  function seed(): void {
    const base = new Date('2026-05-26T00:00:00Z').getTime();
    for (let i = 0; i < 6; i++) {
      fake.rows.push({
        id: `pr-${i}`,
        repoId: i % 2 === 0 ? 'r1' : 'r2',
        passName: i % 2 === 0 ? 'contracts' : 'gotchas',
        status: i === 4 ? 'FAILED' : 'SUCCESS',
        startedAt: new Date(base + i * 1000),
        finishedAt: new Date(base + i * 1000 + 500),
        durationMs: 500,
        tokenCost: 100 + i,
        model: 'sonnet-4-6',
        errorMessage: null,
      });
    }
  }

  describe('GET /v1/pass-runs', () => {
    it('returns all rows newest-first with total / limit / offset', async () => {
      seed();
      const res = await request(app.getHttpServer())
        .get('/v1/pass-runs')
        .expect(200);
      expect(res.body.total).toBe(6);
      expect(res.body.runs).toHaveLength(6);
      expect(res.body.limit).toBe(50);
      expect(res.body.offset).toBe(0);
      expect(res.body.runs[0].id).toBe('pr-5');
      // Dates are ISO strings.
      expect(typeof res.body.runs[0].startedAt).toBe('string');
      expect(res.body.runs[0].startedAt).toMatch(/Z$/);
    });

    it('paginates via ?limit and ?offset', async () => {
      seed();
      const res = await request(app.getHttpServer())
        .get('/v1/pass-runs?limit=2&offset=2')
        .expect(200);
      expect(res.body.runs).toHaveLength(2);
      expect(res.body.total).toBe(6);
      expect(res.body.limit).toBe(2);
      expect(res.body.offset).toBe(2);
    });

    it('filters by ?status, ?passName, ?repoId', async () => {
      seed();
      const failed = await request(app.getHttpServer())
        .get('/v1/pass-runs?status=FAILED')
        .expect(200);
      expect(failed.body.total).toBe(1);
      expect(failed.body.runs[0].status).toBe('FAILED');

      const contracts = await request(app.getHttpServer())
        .get('/v1/pass-runs?passName=contracts')
        .expect(200);
      expect(
        contracts.body.runs.every(
          (r: { passName: string }) => r.passName === 'contracts',
        ),
      ).toBe(true);

      const r1 = await request(app.getHttpServer())
        .get('/v1/pass-runs?repoId=r1')
        .expect(200);
      expect(
        r1.body.runs.every((r: { repoId: string }) => r.repoId === 'r1'),
      ).toBe(true);
    });

    it('rejects bogus ?status with 400', async () => {
      await request(app.getHttpServer())
        .get('/v1/pass-runs?status=DEFINITELY_NOT_VALID')
        .expect(400);
    });

    it('rejects non-integer ?limit with 400', async () => {
      await request(app.getHttpServer())
        .get('/v1/pass-runs?limit=banana')
        .expect(400);
    });

    it('returns an empty page when the ledger is empty', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/pass-runs')
        .expect(200);
      expect(res.body.total).toBe(0);
      expect(res.body.runs).toEqual([]);
    });
  });

  describe('GET /v1/pass-runs/stats', () => {
    it('returns per-pass aggregates', async () => {
      seed();
      const res = await request(app.getHttpServer())
        .get('/v1/pass-runs/stats')
        .expect(200);
      const passNames = res.body.stats.map(
        (s: { passName: string }) => s.passName,
      );
      expect(passNames).toEqual(
        expect.arrayContaining(['contracts', 'gotchas']),
      );
      const contracts = res.body.stats.find(
        (s: { passName: string }) => s.passName === 'contracts',
      );
      expect(contracts).toBeDefined();
      expect(typeof contracts.successRate).toBe('number');
      expect(typeof contracts.avgDurationMs).toBe('number');
      expect(typeof contracts.p50Ms).toBe('number');
      expect(contracts.lastRunAt).toMatch(/Z$/);
      expect(res.body.windowDays).toBe(7);
    });

    it('honours ?windowDays and ?repoId', async () => {
      seed();
      const res = await request(app.getHttpServer())
        .get('/v1/pass-runs/stats?windowDays=30&repoId=r1')
        .expect(200);
      expect(res.body.windowDays).toBe(30);
      // Only r1 was seeded with `contracts`, so we should only see contracts.
      const passNames = res.body.stats.map(
        (s: { passName: string }) => s.passName,
      );
      expect(passNames).toEqual(['contracts']);
    });

    it('returns an empty stats list outside the window', async () => {
      // Seed rows but with very old startedAt so the 7d window excludes them.
      const old = new Date('2025-01-01T00:00:00Z');
      fake.rows.push({
        id: 'old',
        repoId: 'r1',
        passName: 'contracts',
        status: 'SUCCESS',
        startedAt: old,
        finishedAt: old,
        durationMs: 1,
        tokenCost: 1,
        model: null,
        errorMessage: null,
      });
      const res = await request(app.getHttpServer())
        .get('/v1/pass-runs/stats')
        .expect(200);
      expect(res.body.stats).toEqual([]);
    });
  });
});
