/**
 * Tests for the v2 Concept Search API (EC-28).
 *
 * Validates ranking, filtering, snippet extraction, and input validation
 * end-to-end via supertest against a real Nest app pointed at a tmpdir.
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

import { writeCard } from '../writers/markdown/writer';
import type { Card } from '../writers/markdown/types';
import { CardsModule } from './cards.module';

describe('SearchConceptController (supertest)', () => {
  let app: INestApplication;
  let workdir: string;
  let savedRoot: string | undefined;

  beforeEach(async () => {
    workdir = mkdtempSync(join(tmpdir(), 'engram-search-api-'));
    savedRoot = process.env.ENGRAM_ARTIFACTS_ROOT;
    process.env.ENGRAM_ARTIFACTS_ROOT = workdir;
    const moduleRef = await Test.createTestingModule({
      imports: [CardsModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    if (savedRoot === undefined) delete process.env.ENGRAM_ARTIFACTS_ROOT;
    else process.env.ENGRAM_ARTIFACTS_ROOT = savedRoot;
    await app.close();
    rmSync(workdir, { recursive: true, force: true });
  });

  function makeCard(
    conceptPath: string,
    summary: string,
    kind: Card['kind'] = 'module',
  ): Card {
    return {
      conceptPath,
      kind,
      lod: {
        index: summary.slice(0, 40),
        summary,
        standard: `${summary} (standard tier with more detail)`,
        deep: `${summary} (deep tier with the long form)`,
      },
      metadata: {},
    };
  }

  async function seedCorpus(): Promise<void> {
    await writeCard(
      workdir,
      makeCard(
        'engram/ingestion/parsers/typescript',
        'Tree-sitter TypeScript parser for source code ingestion.',
      ),
    );
    await writeCard(
      workdir,
      makeCard(
        'engram/ingestion/parsers/python',
        'Tree-sitter Python parser for source code ingestion.',
      ),
    );
    await writeCard(
      workdir,
      makeCard(
        'engram/synthesis/orchestrator',
        'Pass orchestrator coordinating synthesis stages.',
        'subsystem',
      ),
    );
    await writeCard(
      workdir,
      makeCard(
        'engram',
        'Repository-level summary card for engram-code.',
        'repository',
      ),
    );
  }

  it('returns 400 when query is empty', async () => {
    await request(app.getHttpServer())
      .post('/v1/search/concept')
      .send({ query: '' })
      .expect(400);
  });

  it('ranks concept-path matches highest', async () => {
    await seedCorpus();
    const res = await request(app.getHttpServer())
      .post('/v1/search/concept')
      .send({ query: 'typescript parser' })
      .expect(200);

    expect(res.body.results.length).toBeGreaterThan(0);
    expect(res.body.results[0].conceptPath).toBe(
      'engram/ingestion/parsers/typescript',
    );
    expect(res.body.results[0].snippet).toContain('TypeScript');
    expect(typeof res.body.searchTimeMs).toBe('number');
  });

  it('filters by ?level=', async () => {
    await seedCorpus();
    const res = await request(app.getHttpServer())
      .post('/v1/search/concept')
      .send({ query: 'engram', level: 'repository' })
      .expect(200);
    expect(res.body.results.every((r: any) => r.level === 'repository')).toBe(
      true,
    );
  });

  it('honors lod selection', async () => {
    await seedCorpus();
    const res = await request(app.getHttpServer())
      .post('/v1/search/concept')
      .send({ query: 'tree-sitter', lod: 'deep' })
      .expect(200);
    expect(res.body.results.every((r: any) => r.lod === 'deep')).toBe(true);
  });

  it('caps limit at 50', async () => {
    await seedCorpus();
    const res = await request(app.getHttpServer())
      .post('/v1/search/concept')
      .send({ query: 'engram', limit: 1000 })
      .expect(200);
    expect(res.body.results.length).toBeLessThanOrEqual(50);
  });

  it('returns 400 for invalid level', async () => {
    await request(app.getHttpServer())
      .post('/v1/search/concept')
      .send({ query: 'x', level: 'nonsense' })
      .expect(400);
  });

  it('returns empty results for a query with no matches', async () => {
    await seedCorpus();
    const res = await request(app.getHttpServer())
      .post('/v1/search/concept')
      .send({ query: 'kubernetespodxyz' })
      .expect(200);
    expect(res.body.results).toEqual([]);
    expect(res.body.totalFound).toBe(0);
  });
});
