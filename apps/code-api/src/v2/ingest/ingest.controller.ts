/**
 * Ingest HTTP surface (EC-39a).
 *
 * Three endpoints, all under `/v1/ingest`:
 *   - `POST /v1/ingest/github` — submit a GitHub URL. Returns the job
 *     immediately; the worker runs in the background.
 *   - `GET  /v1/ingest/:id` — poll one job by id.
 *   - `GET  /v1/ingest` — list recent jobs (newest-first, capped at 20).
 *
 * Spec resolved Q2 as "no auth, no rate-limit for v1 personal use" — both
 * are noted as follow-ups in the PR description.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import type { IngestJobDto } from './types';
import { IngestService, InvalidUrlError } from './ingest.service';

export interface IngestSubmitRequestDto {
  url: string;
  ref?: string;
}

export interface IngestSubmitResponseDto {
  job: IngestJobDto;
  coalesced: boolean;
}

export interface IngestListResponseDto {
  jobs: IngestJobDto[];
  count: number;
}

@Controller('v1/ingest')
export class IngestController {
  private readonly logger = new Logger(IngestController.name);

  constructor(private readonly ingest: IngestService) {}

  @Post('github')
  @HttpCode(HttpStatus.ACCEPTED)
  submitGitHub(
    @Body() body: IngestSubmitRequestDto,
  ): IngestSubmitResponseDto {
    if (!body || typeof body.url !== 'string' || body.url.trim() === '') {
      throw new HttpException(
        '`url` is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      const result = this.ingest.submit({ url: body.url, ref: body.ref });
      return { job: result.job, coalesced: result.coalesced };
    } catch (err) {
      if (err instanceof InvalidUrlError) {
        throw new HttpException(err.message, HttpStatus.BAD_REQUEST);
      }
      this.logger.error('Failed to submit ingest', err as Error);
      throw new HttpException(
        'Failed to submit ingest',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  list(@Query('limit') limitParam?: string): IngestListResponseDto {
    const limit = parseLimit(limitParam);
    const jobs = this.ingest.list(limit);
    return { jobs, count: jobs.length };
  }

  @Get(':id')
  get(@Param('id') id: string): IngestJobDto {
    const job = this.ingest.get(id);
    if (job === undefined) {
      throw new HttpException(
        `Ingest job not found: ${id}`,
        HttpStatus.NOT_FOUND,
      );
    }
    return job;
  }
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 20;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new HttpException(
      `Invalid limit "${raw}"; must be a positive integer`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return Math.min(n, 100);
}
