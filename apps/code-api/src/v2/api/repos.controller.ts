/**
 * v2 Repos API (EC-39b).
 *
 * `GET /v1/repos` lists every ingested repository that has artifacts on
 * disk under the multi-repo root (`~/.engram-code/artifacts/`). The
 * dashboard uses this for the "recent ingests" panel so it can scope all
 * other v1 read endpoints via `?repo=<id>`.
 *
 * OpenAPI tag: `repos`.
 */

import { Controller, Get, HttpException, HttpStatus, Logger } from '@nestjs/common';

import type { ReposListResponseDto, RepoSummaryDto } from './dto';
import { CardsFsService } from './services/cards-fs.service';

@Controller('v1/repos')
export class ReposController {
  private readonly logger = new Logger(ReposController.name);

  constructor(private readonly cardsFs: CardsFsService) {}

  @Get()
  async list(): Promise<ReposListResponseDto> {
    let repoIds: string[];
    try {
      repoIds = await this.cardsFs.listRepoIds();
    } catch (err) {
      this.logger.error('Failed to list repos', err as Error);
      throw new HttpException(
        'Failed to list repos',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const repos: RepoSummaryDto[] = [];
    for (const repoId of repoIds) {
      let cardCount = 0;
      try {
        const paths = await this.cardsFs.listConceptPaths(repoId);
        cardCount = paths.length;
      } catch (err) {
        this.logger.warn(
          `Failed to count cards for ${repoId}: ${(err as Error).message}`,
        );
      }
      repos.push({ repoId, cardCount });
    }

    return { repos, count: repos.length };
  }
}
