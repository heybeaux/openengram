/**
 * v2 API DTOs (EC-28).
 *
 * Request/response shapes for the Phase 2 endpoints. Pure types — no
 * class-validator decorators yet because the controllers currently parse
 * everything by hand. Adding `class-validator` is a follow-up if/when we
 * want declarative validation across all endpoints.
 */

import type { LoDContent, CardKind } from '../../writers/markdown/types';

/** Slash-delimited concept identity (e.g. `engram/ingestion/parsers/typescript`). */
export type ConceptPath = string;

/** Mirrors the four LoD tiers exposed by a card. */
export type LodLevel = keyof LoDContent;

/** Response shape for `GET /v1/cards/:path`. */
export interface CardResponseDto {
  conceptPath: ConceptPath;
  kind: CardKind;
  lod: LodLevel;
  content: string;
  metadata: Record<string, unknown>;
}

/** Response shape for `GET /v1/cards`. */
export interface CardListResponseDto {
  cards: Array<{ conceptPath: ConceptPath }>;
  count: number;
}

/** One node in the `/v1/map` tree response. */
export interface MapNodeDto {
  conceptPath: ConceptPath;
  level: CardKind;
  summary: string;
  children: MapNodeDto[];
}

/** Response shape for `GET /v1/map`. */
export interface MapResponseDto {
  root: ConceptPath | null;
  depth: number;
  nodes: MapNodeDto[];
}

/** Request body for `POST /v1/search/concept`. */
export interface SearchConceptRequestDto {
  query: string;
  /** Optional CardKind filter — only return cards at this level. */
  level?: CardKind;
  /** Which LoD body to score against. Defaults to `summary`. */
  lod?: LodLevel;
  /** Max results returned. Defaults to 10, capped at 50. */
  limit?: number;
  /**
   * Scope to a specific ingested repo (EC-39b). When omitted, searches the
   * legacy single-repo artifacts root.
   */
  repoId?: string;
}

/** One repo listed by `GET /v1/repos` (EC-39b). */
export interface RepoSummaryDto {
  repoId: string;
  /** Number of cards present on disk for this repo. */
  cardCount: number;
}

/** Response shape for `GET /v1/repos`. */
export interface ReposListResponseDto {
  repos: RepoSummaryDto[];
  count: number;
}

/** One ranked hit from concept search. */
export interface SearchConceptHitDto {
  conceptPath: ConceptPath;
  level: CardKind;
  lod: LodLevel;
  score: number;
  /** Snippet of the matching LoD body (≤ 200 chars). */
  snippet: string;
}

/** Response shape for `POST /v1/search/concept`. */
export interface SearchConceptResponseDto {
  query: string;
  results: SearchConceptHitDto[];
  totalFound: number;
  searchTimeMs: number;
}

/** One subsystem in the list response. */
export interface SubsystemDto {
  slug: string;
  name: string;
  memberCount: number;
  /** Optional one-line description if present in the artifact frontmatter. */
  description?: string;
}

/** Response shape for `GET /v1/subsystems`. */
export interface SubsystemListResponseDto {
  subsystems: SubsystemDto[];
  count: number;
}
