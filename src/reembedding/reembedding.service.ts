import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from '../memory/embedding.service';
import {
  ContextEnricherService,
  MemoryWithRelations,
} from './context-enricher.service';
import {
  TriggerReembeddingDto,
  ReembeddingJobDto,
  ReembeddingJobStatus,
  EnrichedMemoryPreviewDto,
} from './dto/reembedding.dto';
import { randomUUID } from 'crypto';

/**
 * Internal job state (in-memory for MVP)
 */
interface ReembeddingJob {
  id: string;
  status: ReembeddingJobStatus;
  totalMemories: number;
  processedCount: number;
  successCount: number;
  failureCount: number;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  options: TriggerReembeddingDto;
}

/**
 * Re-embedding Service
 *
 * MVP Implementation: Orchestrates batch re-embedding with context enrichment.
 *
 * Features:
 * - Feature flag controlled (REEMBEDDING_ENABLED)
 * - Batch processing with progress tracking
 * - Embedding versioning via metadata
 * - Dry run support for previewing changes
 */
@Injectable()
export class ReembeddingService {
  // In-memory job storage (MVP - would use DB/Redis in production)
  private jobs: Map<string, ReembeddingJob> = new Map();
  private currentJob: string | null = null;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private embedding: EmbeddingService,
    private enricher: ContextEnricherService,
  ) {}

  /**
   * Check if re-embedding is enabled via feature flag
   */
  isEnabled(): boolean {
    const enabled = this.config.get<string>('REEMBEDDING_ENABLED');
    return enabled === 'true' || enabled === '1';
  }

  /**
   * Trigger a re-embedding batch job
   *
   * @param dto - Options for the re-embedding run
   * @returns Job status
   */
  async triggerReembedding(
    dto: TriggerReembeddingDto,
  ): Promise<ReembeddingJobDto> {
    if (!this.isEnabled()) {
      throw new Error(
        'Re-embedding is disabled. Set REEMBEDDING_ENABLED=true to enable.',
      );
    }

    // Prevent concurrent jobs (MVP limitation)
    if (this.currentJob) {
      const current = this.jobs.get(this.currentJob);
      if (current && current.status === ReembeddingJobStatus.RUNNING) {
        throw new Error(
          `A re-embedding job is already running: ${this.currentJob}`,
        );
      }
    }

    // Create job
    const jobId = randomUUID();
    const job: ReembeddingJob = {
      id: jobId,
      status: ReembeddingJobStatus.PENDING,
      totalMemories: 0,
      processedCount: 0,
      successCount: 0,
      failureCount: 0,
      options: dto,
    };
    this.jobs.set(jobId, job);
    this.currentJob = jobId;

    // Start processing asynchronously
    this.runJob(jobId).catch((error) => {
      console.error(`[ReembeddingService] Job ${jobId} failed:`, error);
      const failedJob = this.jobs.get(jobId);
      if (failedJob) {
        failedJob.status = ReembeddingJobStatus.FAILED;
        failedJob.error = error.message;
        failedJob.completedAt = new Date();
      }
    });

    return this.toDto(job);
  }

  /**
   * Get status of a re-embedding job
   */
  getJobStatus(jobId: string): ReembeddingJobDto | null {
    const job = this.jobs.get(jobId);
    return job ? this.toDto(job) : null;
  }

  /**
   * Get the current job status (if any)
   */
  getCurrentJobStatus(): ReembeddingJobDto | null {
    if (!this.currentJob) return null;
    return this.getJobStatus(this.currentJob);
  }

  /**
   * List all jobs (most recent first)
   */
  listJobs(limit: number = 10): ReembeddingJobDto[] {
    return Array.from(this.jobs.values())
      .sort((a, b) => {
        const aTime = a.startedAt?.getTime() ?? 0;
        const bTime = b.startedAt?.getTime() ?? 0;
        return bTime - aTime;
      })
      .slice(0, limit)
      .map((job) => this.toDto(job));
  }

  /**
   * Preview enrichment for a single memory (for debugging/testing)
   */
  async previewEnrichment(
    memoryId: string,
  ): Promise<EnrichedMemoryPreviewDto | null> {
    const memory = await this.enricher.getMemoryForEnrichment(memoryId);
    if (!memory) return null;

    const enrichment = await this.enricher.enrich(memory);
    const currentVersion = await this.getEmbeddingVersion(memoryId);

    return {
      memoryId: memory.id,
      originalContent: enrichment.originalContent,
      enrichedContent: enrichment.enrichedContent,
      temporalContext: enrichment.metadata.temporalContext,
      entityContext: enrichment.metadata.entityContext,
      importanceContext: enrichment.metadata.importanceContext,
      currentVersion,
      newVersion: currentVersion + 1,
    };
  }

  /**
   * Re-embed a single memory
   *
   * @param memoryId - Memory to re-embed
   * @param dryRun - If true, don't actually update the embedding
   * @returns Preview of the enrichment
   */
  async reembedMemory(
    memoryId: string,
    dryRun: boolean = false,
  ): Promise<EnrichedMemoryPreviewDto | null> {
    const memory = await this.enricher.getMemoryForEnrichment(memoryId);
    if (!memory) {
      throw new Error(`Memory not found: ${memoryId}`);
    }

    const enrichment = await this.enricher.enrich(memory);
    const currentVersion = await this.getEmbeddingVersion(memoryId);
    const newVersion = currentVersion + 1;

    if (!dryRun) {
      // Generate new embedding from enriched content
      const embedding = await this.embedding.generate(
        enrichment.enrichedContent,
      );

      // Store with updated metadata
      await this.embedding.store(memoryId, embedding, {
        userId: memory.userId,
        layer: memory.layer,
        importance: memory.effectiveScore ?? memory.importanceScore,
        createdAt: memory.createdAt,
      });

      // Update embedding version in database
      await this.updateEmbeddingVersion(memoryId, newVersion, enrichment);

      console.log(
        `[ReembeddingService] Re-embedded memory ${memoryId} (v${newVersion})`,
      );
    }

    return {
      memoryId: memory.id,
      originalContent: enrichment.originalContent,
      enrichedContent: enrichment.enrichedContent,
      temporalContext: enrichment.metadata.temporalContext,
      entityContext: enrichment.metadata.entityContext,
      importanceContext: enrichment.metadata.importanceContext,
      currentVersion,
      newVersion,
    };
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  /**
   * Run the batch re-embedding job
   */
  private async runJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = ReembeddingJobStatus.RUNNING;
    job.startedAt = new Date();

    console.log(`[ReembeddingService] Starting job ${jobId}`, job.options);

    try {
      // Fetch memories to process
      const memories = await this.enricher.getMemoriesForEnrichment({
        userId: job.options.userId,
        staleDays: job.options.staleDays,
        limit: job.options.limit ?? 1000,
      });

      job.totalMemories = memories.length;
      console.log(
        `[ReembeddingService] Found ${memories.length} memories to process`,
      );

      // Process in batches of 10
      const batchSize = 10;
      for (let i = 0; i < memories.length; i += batchSize) {
        const batch = memories.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async (memory) => {
            try {
              await this.processMemory(memory, job.options.dryRun ?? false);
              job.successCount++;
            } catch (error) {
              console.error(
                `[ReembeddingService] Failed to process memory ${memory.id}:`,
                error,
              );
              job.failureCount++;
            }
            job.processedCount++;
          }),
        );

        // Log progress every 100 memories
        if (
          job.processedCount % 100 === 0 ||
          job.processedCount === job.totalMemories
        ) {
          console.log(
            `[ReembeddingService] Progress: ${job.processedCount}/${job.totalMemories} ` +
              `(${job.successCount} success, ${job.failureCount} failed)`,
          );
        }
      }

      job.status = ReembeddingJobStatus.COMPLETED;
      job.completedAt = new Date();

      console.log(
        `[ReembeddingService] Job ${jobId} completed: ` +
          `${job.successCount} success, ${job.failureCount} failed`,
      );
    } catch (error) {
      job.status = ReembeddingJobStatus.FAILED;
      job.error = error instanceof Error ? error.message : String(error);
      job.completedAt = new Date();
      throw error;
    }
  }

  /**
   * Process a single memory for re-embedding
   */
  private async processMemory(
    memory: MemoryWithRelations,
    dryRun: boolean,
  ): Promise<void> {
    const enrichment = await this.enricher.enrich(memory);
    const currentVersion = await this.getEmbeddingVersion(memory.id);
    const newVersion = currentVersion + 1;

    if (dryRun) {
      // Just log what would happen
      console.debug(
        `[ReembeddingService] [DRY RUN] Would re-embed ${memory.id} to v${newVersion}`,
      );
      return;
    }

    // Generate new embedding from enriched content
    const embedding = await this.embedding.generate(enrichment.enrichedContent);

    // Store with updated metadata
    await this.embedding.store(memory.id, embedding, {
      userId: memory.userId,
      layer: memory.layer,
      importance: memory.effectiveScore ?? memory.importanceScore,
      createdAt: memory.createdAt,
    });

    // Update embedding version in database
    await this.updateEmbeddingVersion(memory.id, newVersion, enrichment);
  }

  /**
   * Get current embedding version for a memory
   * MVP: Stored in extraction.rawJson.embeddingVersion
   */
  private async getEmbeddingVersion(memoryId: string): Promise<number> {
    const extraction = await this.prisma.memoryExtraction.findUnique({
      where: { memoryId },
      select: { rawJson: true },
    });

    if (!extraction?.rawJson) return 0;

    const rawJson = extraction.rawJson as any;
    return rawJson.embeddingVersion ?? 0;
  }

  /**
   * Update embedding version and enrichment metadata
   */
  private async updateEmbeddingVersion(
    memoryId: string,
    version: number,
    enrichment: { metadata: { enrichmentVersion: string; enrichedAt: Date } },
  ): Promise<void> {
    const extraction = await this.prisma.memoryExtraction.findUnique({
      where: { memoryId },
      select: { rawJson: true },
    });

    const existingJson = (extraction?.rawJson as any) ?? {};

    await this.prisma.memoryExtraction.update({
      where: { memoryId },
      data: {
        rawJson: {
          ...existingJson,
          embeddingVersion: version,
          enrichmentVersion: enrichment.metadata.enrichmentVersion,
          lastReembeddedAt: enrichment.metadata.enrichedAt.toISOString(),
        },
      },
    });
  }

  /**
   * Convert internal job to DTO
   */
  private toDto(job: ReembeddingJob): ReembeddingJobDto {
    return {
      jobId: job.id,
      status: job.status,
      totalMemories: job.totalMemories,
      processedCount: job.processedCount,
      successCount: job.successCount,
      failureCount: job.failureCount,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
    };
  }
}
