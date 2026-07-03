/**
 * Tests for the v2 Cards API (EC-15 + EC-28).
 *
 * Spins up a real NestJS testing module per spec and points the controller
 * at a per-test tmpdir via `ENGRAM_ARTIFACTS_ROOT`. We use the real markdown
 * writer to lay down fixtures so the round-trip is exercised end-to-end —
 * if the writer format drifts, this suite catches it.
 */

import { HttpException, HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeCard } from '../writers/markdown/writer';
import type { Card } from '../writers/markdown/types';
import { CardsController } from './cards.controller';
import { CardsFsService } from './services/cards-fs.service';

describe('CardsController', () => {
  let workdir: string;
  let controller: CardsController;
  let savedRoot: string | undefined;

  beforeEach(async () => {
    workdir = mkdtempSync(join(tmpdir(), 'engram-cards-api-'));
    savedRoot = process.env.ENGRAM_ARTIFACTS_ROOT;
    process.env.ENGRAM_ARTIFACTS_ROOT = workdir;

    const moduleRef = await Test.createTestingModule({
      controllers: [CardsController],
      providers: [CardsFsService],
    }).compile();
    controller = moduleRef.get(CardsController);
  });

  afterEach(() => {
    if (savedRoot === undefined) {
      delete process.env.ENGRAM_ARTIFACTS_ROOT;
    } else {
      process.env.ENGRAM_ARTIFACTS_ROOT = savedRoot;
    }
    rmSync(workdir, { recursive: true, force: true });
  });

  function fixtureCard(overrides: Partial<Card> = {}): Card {
    return {
      conceptPath: 'engram/ingestion/parsers/typescript',
      kind: 'module',
      lod: {
        index: 'TS parser one-liner.',
        summary: 'Tree-sitter based TypeScript parser, summary tier.',
        standard: 'Standard tier description with more context.',
        deep: 'Deep tier with the full implementation story.',
      },
      metadata: {
        generated_at: '2026-05-24T20:00:00Z',
        model: 'claude-sonnet-4-6',
      },
      ...overrides,
    };
  }

  describe('GET /v1/cards', () => {
    it('returns an empty list when no cards exist', async () => {
      const result = await controller.list();
      expect(result).toEqual({ cards: [], count: 0 });
    });

    it('lists every card under <root>/cards/ sorted by conceptPath', async () => {
      await writeCard(workdir, fixtureCard({ conceptPath: 'zeta/last' }));
      await writeCard(workdir, fixtureCard({ conceptPath: 'alpha/first' }));
      await writeCard(workdir, fixtureCard({ conceptPath: 'middle/mid' }));

      const result = await controller.list();

      expect(result.count).toBe(3);
      expect(result.cards.map((c) => c.conceptPath)).toEqual([
        'alpha/first',
        'middle/mid',
        'zeta/last',
      ]);
    });
  });

  describe('GET /v1/cards/:path', () => {
    beforeEach(async () => {
      await writeCard(workdir, fixtureCard());
    });

    it('returns the summary LoD by default', async () => {
      const res = await controller.get('engram/ingestion/parsers/typescript');
      expect(res.conceptPath).toBe('engram/ingestion/parsers/typescript');
      expect(res.kind).toBe('module');
      expect(res.lod).toBe('summary');
      expect(res.content).toBe(
        'Tree-sitter based TypeScript parser, summary tier.',
      );
      expect(res.metadata).toMatchObject({ model: 'claude-sonnet-4-6' });
    });

    it('honors ?lod=index|summary|standard|deep', async () => {
      const conceptPath = 'engram/ingestion/parsers/typescript';
      const indexRes = await controller.get(conceptPath, 'index');
      expect(indexRes.content).toBe('TS parser one-liner.');

      const deepRes = await controller.get(conceptPath, 'deep');
      expect(deepRes.lod).toBe('deep');
      expect(deepRes.content).toBe(
        'Deep tier with the full implementation story.',
      );
    });

    it('accepts a path captured as an array of segments', async () => {
      const res = await controller.get([
        'engram',
        'ingestion',
        'parsers',
        'typescript',
      ]);
      expect(res.conceptPath).toBe('engram/ingestion/parsers/typescript');
    });

    it('strips a trailing .md so INDEX.md links round-trip', async () => {
      const res = await controller.get(
        'engram/ingestion/parsers/typescript.md',
      );
      expect(res.conceptPath).toBe('engram/ingestion/parsers/typescript');
    });

    it('throws 404 when the card file is missing', async () => {
      await expect(controller.get('does/not/exist')).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('throws 404 when the requested LoD body is empty (not generated)', async () => {
      // EC-28: synthesizer may skip a LoD tier for trivial concepts. Empty
      // body → 404 so callers fall back to a richer level instead of
      // silently rendering nothing.
      await writeCard(
        workdir,
        fixtureCard({
          conceptPath: 'engram/sparse/card',
          lod: { index: 'i', summary: 's', standard: 'std', deep: '' },
        }),
      );
      await expect(
        controller.get('engram/sparse/card', 'deep'),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    });

    it('returns cards at every level (kind)', async () => {
      const levels = ['repository', 'subsystem', 'module', 'capability'] as const;
      for (const kind of levels) {
        await writeCard(
          workdir,
          fixtureCard({ conceptPath: `level/${kind}`, kind }),
        );
      }
      for (const kind of levels) {
        const res = await controller.get(`level/${kind}`);
        expect(res.kind).toBe(kind);
      }
    });

    it('throws 400 for an empty concept path', async () => {
      await expect(controller.get('')).rejects.toBeInstanceOf(HttpException);
      await expect(controller.get('')).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
    });

    it('throws 400 for an invalid lod value', async () => {
      await expect(
        controller.get('engram/ingestion/parsers/typescript', 'novel'),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });
  });
});
