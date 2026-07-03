/**
 * v2 Subsystems API (EC-28 Phase 2).
 *
 * `GET /v1/subsystems` lists the subsystems discovered for the active
 * repository. Output is derived from the on-disk `<root>/subsystems/*.md`
 * artifacts produced by EC-25; the frontmatter carries the slug, display
 * name, member count, and optional description.
 *
 * Phase 3 will swap this for a Prisma-backed query against the
 * `subsystems` table; the DTO stays stable.
 *
 * OpenAPI tag: `subsystems`.
 */

import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Query,
} from '@nestjs/common';

import type {
  SubsystemDto,
  SubsystemListResponseDto,
} from './dto';
import { CardsFsService, isValidRepoId } from './services/cards-fs.service';

@Controller('v1/subsystems')
export class SubsystemsController {
  private readonly logger = new Logger(SubsystemsController.name);

  constructor(private readonly cardsFs: CardsFsService) {}

  @Get()
  async list(
    @Query('repo') repoParam?: string,
  ): Promise<SubsystemListResponseDto> {
    const repoId = validateRepoIdQuery(repoParam);
    let files: Array<{ slug: string; raw: string }>;
    try {
      files = await this.cardsFs.listSubsystemFiles(repoId);
    } catch (err) {
      this.logger.error('Failed to list subsystems', err as Error);
      throw new HttpException(
        'Failed to list subsystems',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const subsystems: SubsystemDto[] = files.map((f) =>
      parseSubsystemArtifact(f.slug, f.raw),
    );

    return {
      subsystems,
      count: subsystems.length,
    };
  }
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
 * Pull `subsystem`, `slug`, `members`, and optional `description` out of
 * the subsystem artifact's frontmatter. We hand-roll the parse instead of
 * pulling `yaml` because the writer emits a fixed, scalar-only shape.
 */
function parseSubsystemArtifact(slugFromFile: string, raw: string): SubsystemDto {
  const fm = extractFrontmatter(raw);
  return {
    slug: fm.slug ?? slugFromFile,
    name: fm.subsystem ?? humanize(slugFromFile),
    memberCount: parseInteger(fm.members) ?? 0,
    description: fm.description?.trim() || undefined,
  };
}

function extractFrontmatter(raw: string): Record<string, string> {
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return {};
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) return {};
  const block = normalized.slice(4, end + 1);
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    if (line === '') continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2];
  }
  return out;
}

function parseInteger(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

function humanize(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((s) => (s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)))
    .join(' ');
}
