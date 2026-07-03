/**
 * v2 Pass-Runs API (EC-47).
 *
 * Read-only HTTP surface over the `pass_runs` observability ledger that
 * EC-47 wires up around every synthesis pass. Two endpoints:
 *
 *   - `GET /v1/pass-runs` — paginated list of recent runs. Supports
 *     `?limit`, `?offset`, `?status`, `?passName`, and `?repoId` filters.
 *     Limit defaults to 50 and is clamped to 500 to keep responses bounded.
 *   - `GET /v1/pass-runs/stats` — per-pass aggregates over a trailing
 *     window (default 7d). Returns one row per `passName` with `runs`,
 *     `successRate`, `avgDurationMs`, `avgTokenCost`, `p50Ms`, `p95Ms`,
 *     and `lastRunAt`. Accepts `?repoId` to scope and `?windowDays` to
 *     widen the window.
 *
 * Why this lives under `v1/` despite EC-47 calling it the "v2 endpoint" —
 * the existing controllers (cards, map, repos, subsystems, search) all
 * mount under `v1/`. Keeping `v1/pass-runs` matches the public API
 * convention; the "v2" in EC-47 refers to the internal `src/v2/`
 * synthesis stack, not the HTTP version.
 *
 * Spec: Linear EC-47.
 */

import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Query,
} from '@nestjs/common';

import type { PassRunStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  getRecentRuns,
  getRunStats,
  type PassRunStats,
} from '../passes/pass-run.repository';

/** One row in the `GET /v1/pass-runs` response. */
export interface PassRunListItemDto {
  id: string;
  repoId: string;
  passName: string;
  status: PassRunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  tokenCost: number | null;
  model: string | null;
  errorMessage: string | null;
}

export interface PassRunListResponseDto {
  runs: PassRunListItemDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface PassRunStatsResponseDto {
  windowDays: number;
  stats: PassRunStats[];
}

const VALID_STATUSES: ReadonlyArray<PassRunStatus> = [
  'PENDING',
  'RUNNING',
  'SUCCESS',
  'FAILED',
];

@Controller('v1/pass-runs')
export class PassRunsController {
  private readonly logger = new Logger(PassRunsController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('status') status?: string,
    @Query('passName') passName?: string,
    @Query('repoId') repoId?: string,
  ): Promise<PassRunListResponseDto> {
    const parsedLimit = parseIntOrUndefined(limit, 'limit');
    const parsedOffset = parseIntOrUndefined(offset, 'offset');
    const parsedStatus = parseStatus(status);

    try {
      const result = await getRecentRuns(this.prisma, {
        limit: parsedLimit,
        offset: parsedOffset,
        status: parsedStatus,
        passName: passName || undefined,
        repoId: repoId || undefined,
      });
      return {
        runs: result.rows.map(toListItem),
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      };
    } catch (err) {
      this.logger.error(`GET /v1/pass-runs failed: ${(err as Error).message}`);
      throw new HttpException(
        'Failed to list pass runs',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('stats')
  async stats(
    @Query('repoId') repoId?: string,
    @Query('windowDays') windowDays?: string,
  ): Promise<PassRunStatsResponseDto> {
    const parsedWindow = parseIntOrUndefined(windowDays, 'windowDays');
    try {
      const stats = await getRunStats(this.prisma, repoId || undefined, {
        windowDays: parsedWindow,
      });
      return {
        windowDays: parsedWindow ?? 7,
        stats,
      };
    } catch (err) {
      this.logger.error(
        `GET /v1/pass-runs/stats failed: ${(err as Error).message}`,
      );
      throw new HttpException(
        'Failed to compute pass-run stats',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

function parseIntOrUndefined(
  raw: string | undefined,
  field: string,
): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || Math.floor(n) !== n) {
    throw new BadRequestException(`${field} must be an integer`);
  }
  return n;
}

function parseStatus(raw: string | undefined): PassRunStatus | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (!VALID_STATUSES.includes(raw as PassRunStatus)) {
    throw new BadRequestException(
      `status must be one of ${VALID_STATUSES.join(', ')}`,
    );
  }
  return raw as PassRunStatus;
}

function toListItem(row: {
  id: string;
  repoId: string;
  passName: string;
  status: PassRunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  tokenCost: number | null;
  model: string | null;
  errorMessage: string | null;
}): PassRunListItemDto {
  return {
    id: row.id,
    repoId: row.repoId,
    passName: row.passName,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    durationMs: row.durationMs,
    tokenCost: row.tokenCost,
    model: row.model,
    errorMessage: row.errorMessage,
  };
}
