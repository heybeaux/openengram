/**
 * Ingestion Controller
 * HTTP endpoints for code ingestion
 */

import { Controller, Post, Param, Body, Logger, HttpCode, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IngestionStoreService } from './ingestion-store.service';
import { ingest, formatIngestStats } from './ingestion.service';
import { Language, ProjectConfig } from './types';

interface IngestRequestBody {
  clearExisting?: boolean;
  skipEmbeddings?: boolean;
  models?: ('bge-base' | 'nomic' | 'gte-base' | 'minilm')[];
}

interface IngestResponse {
  success: boolean;
  projectId: string;
  projectName: string;
  stats: {
    filesProcessed: number;
    filesSkipped: number;
    chunksCreated: number;
    chunksStored: number;
    chunksDeleted: number;
    duration: number;
    errors: number;
  };
  message: string;
}

@Controller('v1/projects')
export class IngestionController {
  private readonly logger = new Logger(IngestionController.name);

  constructor(
    private prisma: PrismaService,
    private storeService: IngestionStoreService
  ) {}

  @Post(':id/ingest')
  @HttpCode(HttpStatus.OK)
  async ingestProject(
    @Param('id') projectId: string,
    @Body() body: IngestRequestBody = {}
  ): Promise<IngestResponse> {
    this.logger.log(`Starting ingestion for project ${projectId}`);

    // 1. Look up project by ID
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    this.logger.log(`Found project: ${project.name} at ${project.rootPath}`);

    // 2. Get existing checksums for incremental ingestion (unless clearing)
    const existingChecksums = body.clearExisting
      ? new Map<string, string>()
      : await this.storeService.getExistingChecksums(projectId);

    // 3. Build project config
    const projectConfig: ProjectConfig = {
      rootPath: project.rootPath,
      projectId: project.id,
      languages: project.languages.map((l) => l as Language),
    };

    // 4. Clear existing chunks if requested (before batched ingestion)
    if (body.clearExisting) {
      await this.storeService.storeChunks(projectId, [], { clearExisting: true });
    }

    // 5. Run ingestion pipeline with batched storage
    let totalChunksStored = 0;
    const storeErrors: any[] = [];

    const result = await ingest({
      projectConfig,
      existingChecksums,
      skipEmbeddings: body.skipEmbeddings,
      models: body.models,
      onProgress: (phase, current, total) => {
        this.logger.debug(`[${phase}] ${current}/${total}`);
      },
      onBatch: async (chunks) => {
        const batchResult = await this.storeService.storeChunks(projectId, chunks);
        totalChunksStored += batchResult.chunksStored;
        storeErrors.push(...batchResult.errors);
      },
    });

    this.logger.log(formatIngestStats(result.stats));

    const storeResult = {
      chunksStored: totalChunksStored,
      chunksDeleted: 0,
      errors: storeErrors,
    };

    // 6. Update project timestamp
    await this.storeService.updateProjectTimestamp(projectId);

    this.logger.log(
      `Ingestion complete: ${storeResult.chunksStored} chunks stored, ${storeResult.errors.length} errors`
    );

    // 7. Return stats
    return {
      success: storeResult.errors.length === 0 && result.stats.errors.length === 0,
      projectId: project.id,
      projectName: project.name,
      stats: {
        filesProcessed: result.stats.filesProcessed,
        filesSkipped: result.stats.filesSkipped,
        chunksCreated: result.stats.chunksCreated,
        chunksStored: storeResult.chunksStored,
        chunksDeleted: storeResult.chunksDeleted,
        duration: result.stats.duration,
        errors: result.stats.errors.length + storeResult.errors.length,
      },
      message: formatIngestStats(result.stats),
    };
  }
}
