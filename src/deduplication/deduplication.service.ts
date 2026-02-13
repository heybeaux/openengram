import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MemoryMergedEvent, DedupClusterFoundEvent } from '../events/event-types';
import { PrismaService } from '../prisma/prisma.service';
import {
  SimilarityService,
  MemoryCluster,
  PairwiseSimilarity,
} from './similarity.service';
import {
  SafetyService,
  SafetyConfig,
  DEFAULT_SAFETY_CONFIG,
} from './safety.service';
import { MergeService, MergeResult } from './merge.service';
import { LineageService } from './lineage.service';
import { ReviewService } from './review.service';
import {
  MergeStrategy,
  BatchJobStatus,
  ScanResponseDto,
  StatsResponseDto,
  ConfigResponseDto,
  ManualMergeDto,
  MergeResponseDto,
  RollbackResponseDto,
  UpdateConfigDto,
  SimilarMemoryDto,
} from './dto/deduplication.dto';
import { randomUUID } from 'crypto';

/**
 * Deduplication configuration
 */
interface DedupConfig {
  autoMergeThreshold: number;
  reviewSuggestThreshold: number;
  defaultStrategy: MergeStrategy;
  batchEnabled: boolean;
  incrementalEnabled: boolean;
  incrementalAutoMerge: boolean;
}

/**
 * Batch job state
 */
interface BatchJob {
  id: string;
  status: BatchJobStatus;
  userId: string;
  memoriesProcessed: number;
  clustersFound: number;
  autoMerged: number;
  queuedForReview: number;
  skipped: number;
  errors: string[];
  startedAt: Date;
  completedAt?: Date;
  dryRun: boolean;
}

/**
 * Deduplication Service
 *
 * Main orchestrator for memory deduplication.
 * Coordinates incremental and batch deduplication.
 */
@Injectable()
export class DeduplicationService {
  private config: DedupConfig;
  private safetyConfig: SafetyConfig;
  private jobs: Map<string, BatchJob> = new Map();
  private currentJob: string | null = null;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private similarity: SimilarityService,
    private safety: SafetyService,
    private merge: MergeService,
    private lineage: LineageService,
    private review: ReviewService,
    @Optional() private eventEmitter?: EventEmitter2,
  ) {
    this.config = {
      autoMergeThreshold: 0.95,
      reviewSuggestThreshold: 0.85,
      defaultStrategy: MergeStrategy.KEEP_DETAILED,
      batchEnabled: true,
      incrementalEnabled: true,
      incrementalAutoMerge: true,
    };
    this.safetyConfig = { ...DEFAULT_SAFETY_CONFIG };
  }

  /**
   * Check if deduplication is enabled
   */
  isEnabled(): boolean {
    const enabled = this.configService.get<string>('DEDUP_ENABLED');
    return enabled === 'true' || enabled === '1';
  }

  /**
   * Check for duplicates when a new memory is created (incremental)
   */
  async checkForDuplicates(
    memoryId: string,
    userId: string,
    content: string,
  ): Promise<{
    action: 'none' | 'auto_merged' | 'queued_for_review';
    details?: any;
  }> {
    if (!this.isEnabled() || !this.config.incrementalEnabled) {
      return { action: 'none' };
    }

    try {
      // Find similar memories
      const similar = await this.similarity.findSimilarForContent(
        content,
        userId,
        {
          topK: 5,
          minSimilarity: this.config.reviewSuggestThreshold,
          excludeIds: [memoryId],
        },
      );

      if (similar.length === 0) {
        return { action: 'none' };
      }

      const topMatch = similar[0];

      // Check if this pair was previously rejected
      const wasRejected = await this.review.wasRejected(
        memoryId,
        topMatch.memoryId,
      );
      if (wasRejected) {
        return { action: 'none' };
      }

      // Check safety
      const { canAutoMerge, reasons } = await this.safety.canAutoMergePair(
        memoryId,
        topMatch.memoryId,
      );

      if (!canAutoMerge || !this.config.incrementalAutoMerge) {
        // Queue for review
        await this.review.queuePairForReview(
          userId,
          memoryId,
          topMatch.memoryId,
          topMatch.similarity,
        );
        return {
          action: 'queued_for_review',
          details: { similarity: topMatch.similarity, reasons },
        };
      }

      // Auto-merge if above threshold
      if (topMatch.similarity >= this.config.autoMergeThreshold) {
        const result = await this.executeMerge(
          userId,
          [memoryId, topMatch.memoryId],
          this.config.defaultStrategy,
          'auto',
          topMatch.similarity,
        );

        return {
          action: 'auto_merged',
          details: {
            survivorId: result.survivorId,
            absorbedIds: result.absorbedIds,
            similarity: topMatch.similarity,
          },
        };
      }

      // Queue for review if above suggest threshold
      if (topMatch.similarity >= this.config.reviewSuggestThreshold) {
        await this.review.queuePairForReview(
          userId,
          memoryId,
          topMatch.memoryId,
          topMatch.similarity,
        );
        return {
          action: 'queued_for_review',
          details: { similarity: topMatch.similarity },
        };
      }

      return { action: 'none' };
    } catch (error) {
      console.error(`[DeduplicationService] Error checking duplicates:`, error);
      return { action: 'none' };
    }
  }

  /**
   * Run batch deduplication scan
   */
  async runBatchDedup(
    userId: string,
    options: {
      dryRun?: boolean;
      minSimilarity?: number;
      maxMemories?: number;
    } = {},
  ): Promise<ScanResponseDto> {
    if (!this.isEnabled()) {
      throw new Error('Deduplication is disabled');
    }

    // Prevent concurrent jobs
    if (this.currentJob) {
      const current = this.jobs.get(this.currentJob);
      if (current && current.status === BatchJobStatus.RUNNING) {
        throw new Error(`A batch job is already running: ${this.currentJob}`);
      }
    }

    const {
      dryRun = false,
      minSimilarity = this.config.reviewSuggestThreshold,
      maxMemories = 5000,
    } = options;

    // Create job
    const jobId = randomUUID();
    const job: BatchJob = {
      id: jobId,
      status: BatchJobStatus.RUNNING,
      userId,
      memoriesProcessed: 0,
      clustersFound: 0,
      autoMerged: 0,
      queuedForReview: 0,
      skipped: 0,
      errors: [],
      startedAt: new Date(),
      dryRun,
    };

    this.jobs.set(jobId, job);
    this.currentJob = jobId;

    try {
      console.log(
        `[DeduplicationService] Starting batch job ${jobId} for user ${userId}`,
      );

      // Compute pairwise similarities
      const pairs = await this.similarity.computePairwiseSimilarity(userId, {
        minSimilarity,
        maxMemories,
      });

      job.memoriesProcessed = maxMemories; // Approximation

      // Cluster similar memories
      const clusters = this.similarity.clusterSimilarMemories(
        pairs,
        minSimilarity,
      );
      job.clustersFound = clusters.length;

      console.log(`[DeduplicationService] Found ${clusters.length} clusters`);

      // Emit cluster found events
      for (const cluster of clusters) {
        try {
          this.eventEmitter?.emit(
            'dedup.cluster_found',
            new DedupClusterFoundEvent(cluster.id, cluster.memoryIds, cluster.avgSimilarity),
          );
        } catch {}
      }

      // Process each cluster
      for (const cluster of clusters) {
        try {
          await this.processCluster(userId, cluster, job, dryRun);
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          job.errors.push(`Cluster ${cluster.id}: ${errorMsg}`);
          console.error(
            `[DeduplicationService] Error processing cluster:`,
            error,
          );
        }
      }

      job.status = BatchJobStatus.COMPLETED;
      job.completedAt = new Date();

      console.log(
        `[DeduplicationService] Batch job ${jobId} completed: ` +
          `${job.autoMerged} auto-merged, ${job.queuedForReview} queued`,
      );

      // Record batch run in database
      await this.prisma.dedupBatchRun.create({
        data: {
          userId,
          status: 'completed',
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          memoriesProcessed: job.memoriesProcessed,
          clustersFound: job.clustersFound,
          autoMerged: job.autoMerged,
          queuedForReview: job.queuedForReview,
          skipped: job.skipped,
          errors: job.errors,
          configSnapshot: JSON.stringify({
            minSimilarity,
            maxMemories,
            dryRun,
          }),
        },
      });

      return {
        scanId: jobId,
        status: job.status,
        memoriesProcessed: job.memoriesProcessed,
        clustersFound: job.clustersFound,
        autoMerged: job.autoMerged,
        queuedForReview: job.queuedForReview,
        durationMs: job.completedAt.getTime() - job.startedAt.getTime(),
      };
    } catch (error) {
      job.status = BatchJobStatus.FAILED;
      job.completedAt = new Date();
      job.errors.push(error instanceof Error ? error.message : String(error));

      throw error;
    }
  }

  /**
   * Process a cluster of similar memories
   */
  private async processCluster(
    userId: string,
    cluster: MemoryCluster,
    job: BatchJob,
    dryRun: boolean,
  ): Promise<void> {
    // Check safety for all memories in cluster
    const safetyResults = await this.safety.checkMultipleSafety(
      cluster.memoryIds,
    );
    const hasProtected = safetyResults.some((r) => r.isProtected);
    const canAutoMerge =
      cluster.minSimilarity >= this.config.autoMergeThreshold &&
      safetyResults.every((r) => r.canAutoMerge);

    if (hasProtected) {
      // Skip protected clusters entirely
      job.skipped++;
      return;
    }

    if (dryRun) {
      // Just count what would happen
      if (canAutoMerge) {
        job.autoMerged++;
      } else {
        job.queuedForReview++;
      }
      return;
    }

    if (canAutoMerge) {
      // Auto-merge the cluster
      await this.executeMerge(
        userId,
        cluster.memoryIds,
        this.config.defaultStrategy,
        'batch',
        cluster.avgSimilarity,
      );
      job.autoMerged++;
    } else {
      // Queue for review
      await this.review.queueClusterForReview(userId, cluster);
      job.queuedForReview++;
    }
  }

  /**
   * Execute a merge operation
   */
  private async executeMerge(
    userId: string,
    memoryIds: string[],
    strategy: MergeStrategy,
    trigger: 'auto' | 'batch' | 'manual',
    similarity: number,
    approvedBy?: string,
  ): Promise<MergeResult> {
    const result = await this.merge.merge(memoryIds, strategy);
    await this.lineage.recordMerge(
      userId,
      result,
      trigger,
      similarity,
      approvedBy,
    );

    try {
      this.eventEmitter?.emit(
        'memory.merged',
        new MemoryMergedEvent(result.absorbedIds, result.survivorId, userId),
      );
    } catch {}

    return result;
  }

  /**
   * Manually trigger a merge
   */
  async manualMerge(
    dto: ManualMergeDto,
    userId: string,
    approvedBy?: string,
  ): Promise<MergeResponseDto> {
    if (!this.isEnabled()) {
      throw new Error('Deduplication is disabled');
    }

    const result = await this.merge.merge(dto.memoryIds, dto.strategy, {
      survivorId: dto.survivorId,
      customContent: dto.customContent,
    });

    const event = await this.lineage.recordMerge(
      userId,
      result,
      'manual',
      1.0,
      approvedBy,
    );

    return {
      success: true,
      mergeEventId: event.id,
      survivorId: result.survivorId,
      absorbedIds: result.absorbedIds,
      mergedContent: result.mergedContent,
    };
  }

  /**
   * Rollback a merge
   */
  async rollback(mergeEventId: string): Promise<RollbackResponseDto> {
    const result = await this.lineage.rollbackMerge(mergeEventId);
    return result;
  }

  /**
   * Get deduplication configuration
   */
  async getConfig(userId: string): Promise<ConfigResponseDto> {
    // Try to get user-specific config from database
    const dbConfig = await this.prisma.dedupConfig.findUnique({
      where: { userId },
    });

    if (dbConfig) {
      return {
        autoMergeThreshold: dbConfig.autoMergeThreshold,
        reviewSuggestThreshold: dbConfig.reviewSuggestThreshold,
        defaultStrategy: dbConfig.defaultStrategy as MergeStrategy,
        protectedTypes: dbConfig.protectedTypes,
        protectedKeywords: dbConfig.protectedKeywords,
        protectedImportanceThreshold: dbConfig.protectedImportanceThreshold,
        batchEnabled: dbConfig.batchEnabled,
        lastBatchRunAt: dbConfig.lastBatchRunAt ?? undefined,
      };
    }

    // Return defaults
    return {
      autoMergeThreshold: this.config.autoMergeThreshold,
      reviewSuggestThreshold: this.config.reviewSuggestThreshold,
      defaultStrategy: this.config.defaultStrategy,
      protectedTypes: this.safetyConfig.protectedTypes,
      protectedKeywords: this.safetyConfig.protectedKeywords,
      protectedImportanceThreshold:
        this.safetyConfig.protectedImportanceThreshold,
      batchEnabled: this.config.batchEnabled,
    };
  }

  /**
   * Update deduplication configuration
   */
  async updateConfig(
    userId: string,
    dto: UpdateConfigDto,
  ): Promise<ConfigResponseDto> {
    const existing = await this.prisma.dedupConfig.findUnique({
      where: { userId },
    });

    const data = {
      autoMergeThreshold:
        dto.autoMergeThreshold ??
        existing?.autoMergeThreshold ??
        this.config.autoMergeThreshold,
      reviewSuggestThreshold:
        dto.reviewSuggestThreshold ??
        existing?.reviewSuggestThreshold ??
        this.config.reviewSuggestThreshold,
      defaultStrategy:
        dto.defaultStrategy ??
        existing?.defaultStrategy ??
        this.config.defaultStrategy,
      protectedTypes:
        dto.protectedTypes ??
        existing?.protectedTypes ??
        this.safetyConfig.protectedTypes,
      protectedKeywords:
        dto.protectedKeywords ??
        existing?.protectedKeywords ??
        this.safetyConfig.protectedKeywords,
      protectedImportanceThreshold:
        dto.protectedImportanceThreshold ??
        existing?.protectedImportanceThreshold ??
        this.safetyConfig.protectedImportanceThreshold,
      batchEnabled:
        dto.batchEnabled ?? existing?.batchEnabled ?? this.config.batchEnabled,
    };

    const config = await this.prisma.dedupConfig.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });

    // Update in-memory config
    if (
      dto.protectedTypes ||
      dto.protectedKeywords ||
      dto.protectedImportanceThreshold
    ) {
      this.safety.updateConfig({
        protectedTypes: config.protectedTypes as any,
        protectedKeywords: config.protectedKeywords,
        protectedImportanceThreshold: config.protectedImportanceThreshold,
      });
    }

    return {
      autoMergeThreshold: config.autoMergeThreshold,
      reviewSuggestThreshold: config.reviewSuggestThreshold,
      defaultStrategy: config.defaultStrategy as MergeStrategy,
      protectedTypes: config.protectedTypes,
      protectedKeywords: config.protectedKeywords,
      protectedImportanceThreshold: config.protectedImportanceThreshold,
      batchEnabled: config.batchEnabled,
      lastBatchRunAt: config.lastBatchRunAt ?? undefined,
    };
  }

  /**
   * Get deduplication statistics
   */
  async getStats(userId: string): Promise<StatsResponseDto> {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalMemories,
      pendingReview,
      mergesThisWeek,
      rollbacksThisWeek,
      autoMergedToday,
      deletedMemories,
    ] = await Promise.all([
      this.prisma.memory.count({ where: { userId, deletedAt: null } }),
      this.prisma.mergeCandidate.count({
        where: { userId, status: 'PENDING' },
      }),
      this.prisma.memoryMergeEvent.count({
        where: { userId, createdAt: { gte: weekStart } },
      }),
      this.prisma.memoryMergeEvent.count({
        where: { userId, rolledBackAt: { gte: weekStart } },
      }),
      this.prisma.memoryMergeEvent.count({
        where: { userId, triggeredBy: 'auto', createdAt: { gte: todayStart } },
      }),
      this.prisma.memory.count({ where: { userId, deletedAt: { not: null } } }),
    ]);

    // Estimate clusters (simplified - count pending candidates)
    const clustersIdentified = pendingReview;

    // Compression ratio
    const originalCount = totalMemories + deletedMemories;
    const compressionRatio =
      originalCount > 0 ? deletedMemories / originalCount : 0;

    return {
      totalMemories,
      potentialDuplicates: pendingReview * 2, // Each candidate has 2+ memories
      clustersIdentified,
      autoMergedToday,
      pendingReview,
      compressionRatio,
      mergesThisWeek,
      rollbacksThisWeek,
    };
  }

  /**
   * Find similar memories (for manual inspection)
   */
  async findSimilar(
    memoryId: string,
    userId: string,
    options: { topK?: number; minSimilarity?: number } = {},
  ): Promise<SimilarMemoryDto[]> {
    return this.similarity.findSimilarMemories(memoryId, userId, options);
  }

  /**
   * Get batch job status
   */
  getJobStatus(jobId: string): BatchJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  /**
   * Get current job status
   */
  getCurrentJobStatus(): BatchJob | null {
    if (!this.currentJob) return null;
    return this.jobs.get(this.currentJob) ?? null;
  }
}
