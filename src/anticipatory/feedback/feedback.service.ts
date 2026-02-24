import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AnticipatoryConfig } from '../anticipatory.config';

interface BufferedEvent {
  userId: string;
  recallId: string;
  strategy: string;
  memoryId: string | null;
  salience: number;
  wasUseful: boolean | null;
  latencyMs: number;
}

/**
 * Feedback Service — Buffered Event Writing + Weight Learning
 *
 * Anticipatory events are buffered in memory and flushed to the DB
 * in batches to avoid write contention on the hot recall path.
 *
 * Also manages per-user per-strategy weights that adapt based on
 * feedback data.
 */
@Injectable()
export class FeedbackService implements OnModuleDestroy {
  private readonly logger = new Logger(FeedbackService.name);
  private buffer: BufferedEvent[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;

  /** In-memory weight cache per user. ⚠️ Pure cache — OK to lose on restart. (HEY-346 triage) */
  private weightCache = new Map<string, Record<string, number>>();

  constructor(private readonly prisma: PrismaService) {
    this.flushInterval = setInterval(() => {
      void this.flush().catch((err) => this.logger.error('Flush failed:', err));
    }, AnticipatoryConfig.eventFlushIntervalMs);
  }

  onModuleDestroy(): void {
    if (this.flushInterval) clearInterval(this.flushInterval);
    // Final flush on shutdown
    this.flush().catch(() => {});
  }

  /**
   * Buffer an anticipatory event. Non-blocking.
   */
  recordEvent(event: BufferedEvent): void {
    this.buffer.push(event);
  }

  /**
   * Record explicit feedback (was this anticipatory result useful?).
   */
  async recordFeedback(
    memoryId: string,
    recallId: string | undefined,
    wasUseful: boolean,
    userId: string,
  ): Promise<void> {
    // Update most recent event for this memory
    try {
      const event = await this.prisma.anticipatoryEvent.findFirst({
        where: { memoryId, userId },
        orderBy: { createdAt: 'desc' },
      });

      if (event) {
        await this.prisma.anticipatoryEvent.update({
          where: { id: event.id },
          data: { wasUseful },
        });

        // Update weights
        await this.updateWeights(userId, event.strategy, wasUseful);
      }
    } catch (err) {
      this.logger.warn(`Failed to record feedback: ${(err as Error).message}`);
    }
  }

  /**
   * Get learned weights for a user. Returns defaults if insufficient data.
   */
  async getWeights(userId: string): Promise<Record<string, number>> {
    // Check cache
    const cached = this.weightCache.get(userId);
    if (cached) return cached;

    try {
      const weights = await this.prisma.anticipatoryWeight.findMany({
        where: { userId },
      });

      if (weights.length === 0)
        return {
          ...AnticipatoryConfig.defaultWeights,
        };

      const result: Record<string, number> = {
        ...AnticipatoryConfig.defaultWeights,
      };
      for (const w of weights) {
        if (w.total >= AnticipatoryConfig.minSamplesForLearning) {
          result[w.strategy] = w.weight;
        }
      }

      this.weightCache.set(userId, result);
      return result;
    } catch {
      return { ...AnticipatoryConfig.defaultWeights };
    }
  }

  /**
   * Flush buffered events to the database.
   */
  async flush(): Promise<number> {
    if (this.buffer.length === 0) return 0;

    const batch = [...this.buffer];
    this.buffer = [];

    try {
      await this.prisma.anticipatoryEvent.createMany({
        data: batch.map((e) => ({
          userId: e.userId,
          recallId: e.recallId,
          strategy: e.strategy,
          memoryId: e.memoryId,
          salience: e.salience,
          wasUseful: e.wasUseful,
          latencyMs: e.latencyMs,
        })),
      });

      this.logger.debug(`Flushed ${batch.length} anticipatory events`);
      return batch.length;
    } catch (err) {
      this.logger.error(
        `Failed to flush ${batch.length} events: ${(err as Error).message}`,
      );
      // Re-buffer on failure (with a cap to prevent memory leaks)
      if (this.buffer.length < 1000) {
        this.buffer.push(...batch);
      }
      return 0;
    }
  }

  /**
   * Update per-user per-strategy weight based on feedback.
   * Simple success rate: weight = successful / total.
   */
  private async updateWeights(
    userId: string,
    strategy: string,
    wasUseful: boolean,
  ): Promise<void> {
    try {
      await this.prisma.anticipatoryWeight.upsert({
        where: {
          userId_strategy: { userId, strategy },
        },
        update: {
          successful: { increment: wasUseful ? 1 : 0 },
          total: { increment: 1 },
          weight: undefined, // Computed below
        },
        create: {
          userId,
          strategy,
          successful: wasUseful ? 1 : 0,
          total: 1,
          weight: AnticipatoryConfig.defaultWeights[strategy] ?? 0.5,
        },
      });

      // Recompute weight from totals
      const record = await this.prisma.anticipatoryWeight.findUnique({
        where: { userId_strategy: { userId, strategy } },
      });

      if (record && record.total >= AnticipatoryConfig.minSamplesForLearning) {
        const newWeight = record.successful / record.total;
        await this.prisma.anticipatoryWeight.update({
          where: { id: record.id },
          data: { weight: newWeight },
        });

        // Invalidate cache
        this.weightCache.delete(userId);
      }
    } catch (err) {
      this.logger.warn(`Failed to update weights: ${(err as Error).message}`);
    }
  }
}
