/**
 * Tests for the v2 Subsystems API (EC-28).
 *
 * Drops a couple of EC-25-style subsystem artifacts into a tmpdir and
 * asserts the controller surfaces them through `GET /v1/subsystems`.
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

import { CardsModule } from './cards.module';

describe('SubsystemsController (supertest)', () => {
  let app: INestApplication;
  let workdir: string;
  let savedRoot: string | undefined;

  beforeEach(async () => {
    workdir = mkdtempSync(join(tmpdir(), 'engram-subsystems-api-'));
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

  function seedSubsystem(
    slug: string,
    name: string,
    members: number,
    description?: string,
  ): void {
    const dir = join(workdir, 'subsystems');
    mkdirSync(dir, { recursive: true });
    const fm = [
      '---',
      `subsystem: ${name}`,
      `slug: ${slug}`,
      'pass: subsystem',
      'cluster_id: 0',
      `members: ${members}`,
      'name_fallback: false',
      'truncated: false',
      'tokenCost: 123',
      ...(description ? [`description: ${description}`] : []),
      '---',
      '',
      `# ${name}`,
      '',
      'Body content goes here.',
    ].join('\n');
    writeFileSync(join(dir, `${slug}.md`), fm);
  }

  it('returns an empty list when no subsystems exist', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/subsystems')
      .expect(200);
    expect(res.body).toEqual({ subsystems: [], count: 0 });
  });

  it('lists subsystems with name + memberCount', async () => {
    seedSubsystem('auth', 'Auth', 4, 'Handles authentication flows');
    seedSubsystem('ingestion', 'Ingestion Pipeline', 12);

    const res = await request(app.getHttpServer())
      .get('/v1/subsystems')
      .expect(200);

    expect(res.body.count).toBe(2);
    expect(res.body.subsystems).toEqual([
      {
        slug: 'auth',
        name: 'Auth',
        memberCount: 4,
        description: 'Handles authentication flows',
      },
      {
        slug: 'ingestion',
        name: 'Ingestion Pipeline',
        memberCount: 12,
      },
    ]);
  });
});
