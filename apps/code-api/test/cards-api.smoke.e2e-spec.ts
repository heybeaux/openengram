/**
 * EC-20 — HTTP smoke for /v1/cards/:path against a freshly-indexed repo.
 *
 * Exercises the real production read path:
 *   1. Run `engram-code index` over a tiny TS fixture (test/fixtures/smoke-repo)
 *   2. Boot Nest with ENGRAM_ARTIFACTS_ROOT pointed at the output dir
 *   3. Issue `GET /v1/cards/<conceptPath>?lod=summary` via supertest
 *   4. Assert 200 + the body matches the on-disk card byte-for-byte
 *
 * We mount only `CardsModule` (not `AppModule`) because the full module pulls
 * in PrismaService which $connect()s against Postgres on init. The point of
 * this smoke is the fs-backed read path, not the DB-backed services — so a
 * focused harness avoids requiring a live DB just to run `pnpm test`.
 */
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';

import { run } from '../src/v2/cli/cli';
import { readCard } from '../src/v2/writers/markdown/writer';
import { CardsModule } from '../src/v2/api/cards.module';

const FIXTURE_REPO = resolve(__dirname, 'fixtures', 'smoke-repo');

describe('Cards API smoke (EC-20)', () => {
  let workdir: string;
  let artifactsRoot: string;
  let app: INestApplication;
  let savedRoot: string | undefined;

  beforeAll(async () => {
    workdir = mkdtempSync(join(tmpdir(), 'engram-code-smoke-'));
    artifactsRoot = join(workdir, 'artifacts');

    // Step 1: run the real CLI against the fixture. Capture stdio so a green
    // run doesn't spam the test reporter; we surface output on failure.
    const out: string[] = [];
    const err: string[] = [];
    const exitCode = await run(['index', FIXTURE_REPO, `--out=${artifactsRoot}`], {
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    });
    if (exitCode !== 0) {
      throw new Error(
        `engram-code index failed (exit ${exitCode}):\nSTDOUT:\n${out.join('')}\nSTDERR:\n${err.join('')}`,
      );
    }

    // Step 2: boot Nest with the artifacts root pointed at our output.
    savedRoot = process.env.ENGRAM_ARTIFACTS_ROOT;
    process.env.ENGRAM_ARTIFACTS_ROOT = artifactsRoot;

    const moduleRef = await Test.createTestingModule({
      imports: [CardsModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (savedRoot === undefined) {
      delete process.env.ENGRAM_ARTIFACTS_ROOT;
    } else {
      process.env.ENGRAM_ARTIFACTS_ROOT = savedRoot;
    }
    rmSync(workdir, { recursive: true, force: true });
  });

  it('lists at least one card from the indexed fixture', async () => {
    const res = await request(app.getHttpServer()).get('/v1/cards').expect(200);
    expect(res.body.count).toBeGreaterThan(0);
    expect(Array.isArray(res.body.cards)).toBe(true);
    expect(res.body.cards[0]).toHaveProperty('conceptPath');
  });

  it('serves GET /v1/cards/:path?lod=summary matching the on-disk card', async () => {
    // Discover a real conceptPath via the list endpoint — the stub
    // synthesizer derives this from the fixture's file layout, so we don't
    // hardcode it (and the test survives fixture renames).
    const list = await request(app.getHttpServer()).get('/v1/cards').expect(200);
    const conceptPath: string = list.body.cards[0].conceptPath;
    expect(typeof conceptPath).toBe('string');
    expect(conceptPath.length).toBeGreaterThan(0);

    const res = await request(app.getHttpServer())
      .get(`/v1/cards/${conceptPath}?lod=summary`)
      .expect(200);

    expect(res.body.conceptPath).toBe(conceptPath);
    expect(res.body.lod).toBe('summary');
    expect(typeof res.body.content).toBe('string');
    expect(res.body.content.trim().length).toBeGreaterThan(0);

    // Body must match the on-disk card byte-for-byte for the requested LoD.
    const onDisk = await readCard(
      join(artifactsRoot, 'cards', `${conceptPath}.md`),
    );
    expect(res.body.content).toBe(onDisk.lod.summary);
    expect(res.body.kind).toBe(onDisk.kind);
    expect(res.body.metadata).toEqual(onDisk.metadata);
  });
});
