import {
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AnticipatoryConfig } from '../anticipatory.config';
import { REDIS_CLIENT } from '../../prefetch/prefetch-cache.service';
import Redis from 'ioredis';

interface BufferedEvent {
  userId: string;
  recallId: string;
  strategy: string;
  memoryId: string | null;
  salience: number;
  wasUseful: boolean | null;
  latencyMs: number;
}

const WEIGHT_CACHE_PREFIX = 'anticipatory:weights:';

/**
 * Feedback Service — Buffered Event Writing + Weight Learning
 *
 * Anticipatory events are buffered in memory and flushed to the DB
 * in batches to avoid write contention on the hot recall path.
 *
 * Also manages per-user per-strategy weights that adapt based on
 * feedback data. Weight cache is persisted to Redis so learned
 * weights survive restarts.
 */
@Injectable()
export class FeedbackService implements OnModuleDestroy {
  private readonly logger = new Logger(FeedbackService.name);
  private buffer: BufferedEvent[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;

  /** In-memory weight cache per user, backed by Redis for persistence. */
  private weightCache = new Map<string, Record<string, number>>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {
    this.flushInterval = setInterval(() => {
      void this.flush().catch((err) => this.logger.error('Flush failed:', err));
    }, AnticipatoryConfig.eventFlushIntervalMs);

    // Hydrate weight cache from Redis on construction
    this.hydrateWeightCache().catch((err) =>
      this.logger.warn('Failed to hydrate weight cache from Redis', err),
    );
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
    // Check in-memory cache
    const cached = this.weightCache.get(userId);
    if (cached) return cached;

    // Check Redis cache
    if (this.redis) {
      try {
        const redisData = await this.redis.get(WEIGHT_CACHE_PREFIX + userId);
        if (redisData) {
          const parsed = JSON.parse(redisData) as Record<string, number>;
          this.weightCache.set(userId, parsed);
          return parsed;
        }
      } catch {
        // fall through to DB
      }
    }

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
      this.persistWeightToRedis(userId, result);
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

        // Invalidate cache (both in-memory and Redis)
        this.weightCache.delete(userId);
        this.deleteWeightFromRedis(userId);
      }
    } catch (err) {
      this.logger.warn(`Failed to update weights: ${(err as Error).message}`);
    }
  }

  // =========================================================================
  // Redis Persistence (fire-and-forget for weight cache)
  // =========================================================================

  private persistWeightToRedis(
    userId: string,
    weights: Record<string, number>,
  ): void {
    if (!this.redis) return;
    // TTL of 24h — weights will be refreshed from DB if expired
    this.redis
      .set(WEIGHT_CACHE_PREFIX + userId, JSON.stringify(weights), 'EX', 86400)
      .catch((err) =>
        this.logger.warn('Redis persist weight cache failed', err),
      );
  }

  private deleteWeightFromRedis(userId: string): void {
    if (!this.redis) return;
    this.redis
      .del(WEIGHT_CACHE_PREFIX + userId)
      .catch((err) =>
        this.logger.warn('Redis delete weight cache failed', err),
      );
  }

  private async hydrateWeightCache(): Promise<void> {
    if (!this.redis) return;

    const keys: string[] = [];
    const stream = this.redis.scanStream({
      match: WEIGHT_CACHE_PREFIX + '*',
      count: 100,
    });

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (batch: string[]) => keys.push(...batch));
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    if (keys.length === 0) return;

    const pipeline = this.redis.pipeline();
    for (const key of keys) pipeline.get(key);
    const results = await pipeline.exec();
    if (!results) return;

    let hydrated = 0;
    for (let i = 0; i < results.length; i++) {
      const [err, val] = results[i];
      if (err || !val) continue;
      try {
        const userId = keys[i].slice(WEIGHT_CACHE_PREFIX.length);
        const weights = JSON.parse(val as string) as Record<string, number>;
        this.weightCache.set(userId, weights);
        hydrated++;
      } catch {
        // skip malformed
      }
    }

    if (hydrated > 0) {
      this.logger.log(`Hydrated ${hydrated} weight cache entries from Redis`);
    }
  }
}
