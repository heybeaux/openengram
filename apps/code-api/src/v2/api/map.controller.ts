/**
 * v2 Map API (EC-28 Phase 2).
 *
 * `GET /v1/map?root=<conceptPath>&depth=2` returns a nested tree of cards
 * under `<conceptPath>`, where each node carries its hierarchical level,
 * concept path, and `summary` LoD body. Omitting `root` returns the full
 * forest of top-level cards (concept paths with no `/` separator) up to
 * `depth` levels deep.
 *
 * The tree is derived from on-disk concept paths: a card at
 * `engram/ingestion/parsers/typescript` is treated as a descendant of
 * `engram/ingestion/parsers`. This matches the conceptPath convention used
 * by the synthesis writer and avoids needing a separate adjacency table.
 *
 * `depth` counts hops below the root: `depth=0` returns just the root
 * card(s); `depth=1` adds direct children; `depth=2` adds grandchildren.
 *
 * OpenAPI tag: `map`.
 */

import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Query,
} from '@nestjs/common';

import type { Card } from '../writers/markdown/types';
import type { MapNodeDto, MapResponseDto } from './dto';
import { CardsFsService, isValidRepoId } from './services/cards-fs.service';

const DEFAULT_DEPTH = 2;
const MAX_DEPTH = 10;

@Controller('v1/map')
export class MapController {
  private readonly logger = new Logger(MapController.name);

  constructor(private readonly cardsFs: CardsFsService) {}

  @Get()
  async get(
    @Query('root') rootParam?: string,
    @Query('depth') depthParam?: string,
    @Query('repo') repoParam?: string,
  ): Promise<MapResponseDto> {
    const depth = parseDepth(depthParam);
    const root = normalizeRoot(rootParam);
    const repoId = validateRepoIdQuery(repoParam);

    let cards: Card[];
    try {
      cards = await this.cardsFs.readAll(repoId);
    } catch (err) {
      this.logger.error('Failed to read cards for map', err as Error);
      throw new HttpException(
        'Failed to build map',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const byPath = new Map<string, Card>();
    for (const c of cards) byPath.set(c.conceptPath, c);

    // If a root is specified but no card exists at that exact path, we
    // still return any descendants. This is intentional — Phase 2 lets
    // callers query subtrees rooted at conceptual paths that haven't been
    // synthesized yet (e.g. a directory with no module card).
    const rootCard = root ? byPath.get(root) ?? null : null;

    const allPaths = Array.from(byPath.keys());
    const childIndex = buildChildIndex(allPaths, root);

    const rootSeeds = root === null ? topLevelPaths(allPaths) : [root];
    const nodes: MapNodeDto[] = [];
    for (const seed of rootSeeds) {
      const node = buildNode(seed, byPath, childIndex, 0, depth);
      if (node !== null) nodes.push(node);
    }

    // Sort siblings by conceptPath for deterministic output.
    nodes.sort(byConceptPath);
    sortRecursive(nodes);

    // If the caller asked for a specific root that doesn't exist as a card
    // AND has no descendants, surface that as 404 — the alternative is a
    // confusing empty 200 that masks a typo in the conceptPath.
    if (root !== null && rootCard === null && nodes.length === 0) {
      throw new HttpException(
        `No cards found under root "${root}"`,
        HttpStatus.NOT_FOUND,
      );
    }

    return { root, depth, nodes };
  }
}

function parseDepth(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_DEPTH;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > MAX_DEPTH) {
    throw new HttpException(
      `Invalid depth "${raw}"; must be an integer in [0, ${MAX_DEPTH}]`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return n;
}

function normalizeRoot(raw: string | undefined): string | null {
  if (raw === undefined || raw === '') return null;
  const trimmed = raw.replace(/^\/+/, '').replace(/\/+$/, '');
  if (trimmed === '') return null;
  if (trimmed.includes('..')) {
    throw new HttpException(
      `Invalid root "${raw}"`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return trimmed;
}

function validateRepoIdQuery(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (!isValidRepoId(raw)) {
    throw new HttpException(
      `Invalid repo "${raw}"; must match /^[A-Za-z0-9._-]+$/`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return raw;
}

/**
 * Build an adjacency list keyed by parent conceptPath. A path
 * `a/b/c/d` is a child of `a/b/c` when both exist in the card set, or a
 * descendant of any ancestor when its immediate parent has no card. We
 * always attach to the *nearest existing* ancestor so the tree stays
 * dense even when intermediate cards are missing.
 */
function buildChildIndex(
  allPaths: string[],
  root: string | null,
): Map<string, string[]> {
  const pathSet = new Set(allPaths);
  const index = new Map<string, string[]>();
  for (const p of allPaths) {
    if (root !== null && p !== root && !p.startsWith(root + '/')) continue;
    const parent = nearestExistingParent(p, pathSet, root);
    if (parent === null || parent === p) continue;
    const bucket = index.get(parent);
    if (bucket) bucket.push(p);
    else index.set(parent, [p]);
  }
  return index;
}

function nearestExistingParent(
  path: string,
  pathSet: Set<string>,
  root: string | null,
): string | null {
  const segments = path.split('/');
  for (let i = segments.length - 1; i > 0; i--) {
    const candidate = segments.slice(0, i).join('/');
    if (root !== null && candidate !== root && !candidate.startsWith(root + '/')) {
      // We've climbed above the requested root — stop.
      return null;
    }
    if (pathSet.has(candidate)) return candidate;
    if (candidate === root) return root;
  }
  return null;
}

/**
 * The "seeds" for a no-root request are conceptPaths whose nearest
 * existing ancestor is themselves — i.e. nothing in the card set sits
 * above them. Practically: every path that's not listed as a child in the
 * child index.
 */
function topLevelPaths(allPaths: string[]): string[] {
  const pathSet = new Set(allPaths);
  const out: string[] = [];
  for (const p of allPaths) {
    const parent = nearestExistingParent(p, pathSet, null);
    if (parent === null) out.push(p);
  }
  return out;
}

function buildNode(
  path: string,
  byPath: Map<string, Card>,
  childIndex: Map<string, string[]>,
  currentDepth: number,
  maxDepth: number,
): MapNodeDto | null {
  const card = byPath.get(path);
  // If a path appears as a parent in the child index but has no card of
  // its own (e.g. an intermediate directory), synthesize a placeholder
  // node so the tree stays navigable.
  const level = card?.kind ?? 'module';
  const summary = card?.lod.summary ?? '';

  const children: MapNodeDto[] = [];
  if (currentDepth < maxDepth) {
    const childPaths = childIndex.get(path) ?? [];
    for (const c of childPaths) {
      const childNode = buildNode(
        c,
        byPath,
        childIndex,
        currentDepth + 1,
        maxDepth,
      );
      if (childNode !== null) children.push(childNode);
    }
  }

  if (!card && children.length === 0) return null;

  return {
    conceptPath: path,
    level,
    summary,
    children,
  };
}

function byConceptPath(a: MapNodeDto, b: MapNodeDto): number {
  return a.conceptPath.localeCompare(b.conceptPath);
}

function sortRecursive(nodes: MapNodeDto[]): void {
  for (const n of nodes) {
    n.children.sort(byConceptPath);
    sortRecursive(n.children);
  }
}
