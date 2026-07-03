/**
 * v2 Concept Search API (EC-28 Phase 2).
 *
 * `POST /v1/search/concept` performs ranked text search over LoD card
 * bodies. The spec calls for semantic search over the `cards` table; this
 * implementation uses a deterministic TF/IDF-ish ranker against the on-disk
 * card artifacts so the endpoint is functional today without depending on
 * an embedding backfill. The DTO is forward-compatible: when card
 * embeddings land, the scorer swaps for cosine similarity without changing
 * the request/response shape.
 *
 * OpenAPI tag: `search`.
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';

import type { Card, CardKind, LoDContent } from '../writers/markdown/types';
import type {
  SearchConceptHitDto,
  SearchConceptRequestDto,
  SearchConceptResponseDto,
} from './dto';
import { CardsFsService, isValidRepoId } from './services/cards-fs.service';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const SNIPPET_LEN = 200;

const VALID_LODS: readonly (keyof LoDContent)[] = [
  'index',
  'summary',
  'standard',
  'deep',
];

const VALID_LEVELS: readonly CardKind[] = [
  'repository',
  'subsystem',
  'module',
  'capability',
];

@Controller('v1/search')
export class SearchConceptController {
  private readonly logger = new Logger(SearchConceptController.name);

  constructor(private readonly cardsFs: CardsFsService) {}

  @Post('concept')
  @HttpCode(HttpStatus.OK)
  async search(
    @Body() body: SearchConceptRequestDto,
  ): Promise<SearchConceptResponseDto> {
    const startTime = Date.now();
    const query = (body?.query ?? '').trim();
    if (query === '') {
      throw new HttpException(
        '`query` is required and must be non-empty',
        HttpStatus.BAD_REQUEST,
      );
    }

    const lod = validateLod(body?.lod) ?? 'summary';
    const level = validateLevel(body?.level);
    const limit = validateLimit(body?.limit);
    const repoId = validateRepoIdBody(body?.repoId);

    let cards: Card[];
    try {
      cards = await this.cardsFs.readAll(repoId);
    } catch (err) {
      this.logger.error('Failed to read cards for search', err as Error);
      throw new HttpException(
        'Failed to read cards',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const filtered = level
      ? cards.filter((c) => c.kind === level)
      : cards;

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) {
      return {
        query,
        results: [],
        totalFound: 0,
        searchTimeMs: Date.now() - startTime,
      };
    }

    const scored = scoreCards(filtered, queryTokens, lod);
    const ranked = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const results: SearchConceptHitDto[] = ranked.map((s) => ({
      conceptPath: s.card.conceptPath,
      level: s.card.kind,
      lod,
      score: roundScore(s.score),
      snippet: snippet(s.card.lod[lod] ?? '', queryTokens),
    }));

    return {
      query,
      results,
      totalFound: results.length,
      searchTimeMs: Date.now() - startTime,
    };
  }
}

function validateLod(raw: unknown): keyof LoDContent | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !(VALID_LODS as readonly string[]).includes(raw)) {
    throw new HttpException(
      `Invalid lod "${String(raw)}"; must be one of ${VALID_LODS.join('|')}`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return raw as keyof LoDContent;
}

function validateLevel(raw: unknown): CardKind | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || !(VALID_LEVELS as readonly string[]).includes(raw)) {
    throw new HttpException(
      `Invalid level "${String(raw)}"; must be one of ${VALID_LEVELS.join('|')}`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return raw as CardKind;
}

function validateLimit(raw: unknown): number {
  if (raw === undefined || raw === null) return DEFAULT_LIMIT;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new HttpException(
      `Invalid limit "${String(raw)}"; must be a positive integer`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return Math.min(n, MAX_LIMIT);
}

function validateRepoIdBody(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || !isValidRepoId(raw)) {
    throw new HttpException(
      `Invalid repoId "${String(raw)}"; must match /^[A-Za-z0-9._-]+$/`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return raw;
}

interface Scored {
  card: Card;
  score: number;
}

/**
 * Deterministic TF/IDF ranker over the chosen LoD body. Card paths are
 * folded into the document so a query like "typescript parser" still
 * scores a path-only match. Stop-words are not stripped — they're rare
 * in card bodies and the IDF weighting handles them naturally.
 */
function scoreCards(
  cards: Card[],
  queryTokens: string[],
  lod: keyof LoDContent,
): Scored[] {
  const docs = cards.map((card) => {
    const body = card.lod[lod] ?? '';
    const pathText = card.conceptPath.replace(/[/_-]/g, ' ');
    return {
      card,
      tokens: tokenize(`${pathText} ${body}`),
    };
  });

  const docFreq = new Map<string, number>();
  for (const d of docs) {
    const seen = new Set<string>();
    for (const t of d.tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
    }
  }
  const N = docs.length || 1;

  return docs.map(({ card, tokens }) => {
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    let score = 0;
    for (const q of queryTokens) {
      const f = tf.get(q);
      if (!f) continue;
      const df = docFreq.get(q) ?? 0;
      const idf = Math.log(1 + N / (1 + df));
      score += (1 + Math.log(f)) * idf;
    }

    // Boost when the query token appears in the conceptPath itself — that
    // signals strong intent ("show me everything about parsers").
    const pathTokens = new Set(tokenize(card.conceptPath.replace(/[/_-]/g, ' ')));
    for (const q of queryTokens) {
      if (pathTokens.has(q)) score += 1.5;
    }

    return { card, score };
  });
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

function snippet(body: string, queryTokens: string[]): string {
  if (body.trim() === '') return '';
  const lower = body.toLowerCase();
  let hit = -1;
  for (const q of queryTokens) {
    const idx = lower.indexOf(q);
    if (idx !== -1 && (hit === -1 || idx < hit)) hit = idx;
  }
  const start = hit === -1 ? 0 : Math.max(0, hit - 40);
  const slice = body.slice(start, start + SNIPPET_LEN);
  return start > 0 ? `…${slice}` : slice;
}

function roundScore(n: number): number {
  return Math.round(n * 1000) / 1000;
}
