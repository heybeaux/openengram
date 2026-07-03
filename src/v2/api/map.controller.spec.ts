/**
 * Tests for the v2 Map API (EC-28).
 *
 * End-to-end via supertest — boots a full Nest app, writes real cards via
 * the markdown writer, and hits `GET /v1/map`. Exercises the tree-building
 * logic against on-disk fixtures so regressions in the path-folding
 * heuristic surface immediately.
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

describe('MapController (supertest)', () => {
  let app: INestApplication;
  let workdir: string;
  let savedRoot: string | undefined;

  beforeEach(async () => {
    workdir = mkdtempSync(join(tmpdir(), 'engram-map-api-'));
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
    kind: Card['kind'] = 'module',
    summary = `${conceptPath} summary`,
  ): Card {
    return {
      conceptPath,
      kind,
      lod: { index: 'i', summary, standard: 'std', deep: 'd' },
      metadata: {},
    };
  }

  async function seedTree(): Promise<void> {
    await writeCard(workdir, makeCard('engram', 'repository', 'engram repo summary'));
    await writeCard(
      workdir,
      makeCard('engram/ingestion', 'subsystem', 'ingestion subsystem'),
    );
    await writeCard(
      workdir,
      makeCard('engram/ingestion/parsers', 'module', 'parsers module'),
    );
    await writeCard(
      workdir,
      makeCard(
        'engram/ingestion/parsers/typescript',
        'capability',
        'ts parser capability',
      ),
    );
    await writeCard(workdir, makeCard('other/standalone'));
  }

  it('returns an empty forest when no cards exist', async () => {
    const res = await request(app.getHttpServer()).get('/v1/map').expect(200);
    expect(res.body).toEqual({ root: null, depth: 2, nodes: [] });
  });

  it('returns top-level forest with default depth=2', async () => {
    await seedTree();
    const res = await request(app.getHttpServer()).get('/v1/map').expect(200);

    expect(res.body.root).toBeNull();
    expect(res.body.depth).toBe(2);
    const paths = res.body.nodes.map((n: any) => n.conceptPath);
    expect(paths).toEqual(['engram', 'other/standalone']);

    const engram = res.body.nodes.find((n: any) => n.conceptPath === 'engram');
    expect(engram.level).toBe('repository');
    expect(engram.summary).toBe('engram repo summary');
    expect(engram.children).toHaveLength(1);
    expect(engram.children[0].conceptPath).toBe('engram/ingestion');
    // depth=2 → grandchildren included, great-grandchildren are not.
    expect(engram.children[0].children).toHaveLength(1);
    expect(engram.children[0].children[0].conceptPath).toBe(
      'engram/ingestion/parsers',
    );
    expect(engram.children[0].children[0].children).toEqual([]);
  });

  it('honors ?root= to scope the tree', async () => {
    await seedTree();
    const res = await request(app.getHttpServer())
      .get('/v1/map?root=engram/ingestion&depth=2')
      .expect(200);

    expect(res.body.root).toBe('engram/ingestion');
    expect(res.body.nodes).toHaveLength(1);
    expect(res.body.nodes[0].conceptPath).toBe('engram/ingestion');
    expect(res.body.nodes[0].children[0].conceptPath).toBe(
      'engram/ingestion/parsers',
    );
    expect(res.body.nodes[0].children[0].children[0].conceptPath).toBe(
      'engram/ingestion/parsers/typescript',
    );
  });

  it('depth=0 returns just the root card with no children', async () => {
    await seedTree();
    const res = await request(app.getHttpServer())
      .get('/v1/map?root=engram&depth=0')
      .expect(200);
    expect(res.body.nodes).toHaveLength(1);
    expect(res.body.nodes[0].children).toEqual([]);
  });

  it('returns 404 when root has no descendants and no card itself', async () => {
    await seedTree();
    await request(app.getHttpServer())
      .get('/v1/map?root=does/not/exist')
      .expect(404);
  });

  it('returns 400 for invalid depth', async () => {
    await request(app.getHttpServer())
      .get('/v1/map?depth=abc')
      .expect(400);
    await request(app.getHttpServer())
      .get('/v1/map?depth=-1')
      .expect(400);
  });
});
