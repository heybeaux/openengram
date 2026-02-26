/**
 * Prefetch Metrics Service
 *
 * Tracks precision, recall, and other metrics for prefetch effectiveness.
 * Provides insights for learning and optimization.
 *
 * Uses Redis for persistence of pendingFeedback and latencyBuckets
 * so calibration data survives restarts.
 */

import {
  Injectable,
  Optional,
  Inject,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import {
  TopicId,
  PrefetchFeedback,
  PrecisionRecallMetrics,
  PrefetchMetrics,
} from './prefetch.types';
import { REDIS_CLIENT } from './prefetch-cache.service';
import Redis from 'ioredis';

interface FeedbackEntry {
  feedback: PrefetchFeedback;
  completed: boolean;
}

interface LatencyBucket {
  latencies: number[];
  maxSize: number;
}

const REDIS_PREFIX = 'prefetch:metrics:';
const PENDING_KEY = REDIS_PREFIX + 'pending';
const COMPLETED_KEY = REDIS_PREFIX + 'completed';
const LATENCY_PREFIX = REDIS_PREFIX + 'latency:';
const COUNTERS_KEY = REDIS_PREFIX + 'counters';

@Injectable()
export class PrefetchMetricsService implements OnModuleInit {
  private readonly logger = new Logger(PrefetchMetricsService.name);

  // Feedback tracking
  private pendingFeedback: Map<string, FeedbackEntry> = new Map();
  private completedFeedback: PrefetchFeedback[] = [];
  private maxFeedbackHistory = 1000;

  // Latency tracking
  private latencyBuckets: Map<string, LatencyBucket> = new Map();

  // Counters
  private totalPrefetches = 0;
  private totalAccesses = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private topicDetectionLatencies: number[] = [];

  // Memory pressure
  private memoryPressureLevel: 'normal' | 'warning' | 'critical' = 'normal';

  constructor(
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {
    // Initialize latency buckets
    this.latencyBuckets.set('prefetch', { latencies: [], maxSize: 100 });
    this.latencyBuckets.set('lookup', { latencies: [], maxSize: 100 });
    this.latencyBuckets.set('detection', { latencies: [], maxSize: 100 });
  }

  async onModuleInit(): Promise<void> {
    if (!this.redis) return;
    try {
      await this.hydrateFromRedis();
    } catch (err) {
      this.logger.warn('Failed to hydrate prefetch metrics from Redis', err);
    }
  }

  /**
   * Record a prefetch operation
   */
  recordPrefetch(
    prefetchId: string,
    userId: string,
    topic: TopicId,
    memoryId: string,
    topicConfidence: number,
    memoryScore: number,
  ): void {
    const key = `${prefetchId}:${memoryId}`;

    const feedback: PrefetchFeedback = {
      prefetchId,
      userId,
      topic,
      memoryId,
      prefetchedAt: Date.now(),
      wasAccessed: false,
      topicConfidence,
      memoryScore,
    };

    this.pendingFeedback.set(key, {
      feedback,
      completed: false,
    });

    this.totalPrefetches++;

    // Persist to Redis
    this.persistPending(key, { feedback, completed: false });
    this.persistCounters();

    // Auto-complete after timeout (5 minutes)
    setTimeout(
      () => {
        this.completeFeedback(prefetchId, memoryId);
      },
      5 * 60 * 1000,
    );
  }

  /**
   * Record that a prefetched memory was accessed
   */
  recordAccess(prefetchId: string, memoryId: string): void {
    const key = `${prefetchId}:${memoryId}`;
    const entry = this.pendingFeedback.get(key);

    if (entry && !entry.completed) {
      entry.feedback.wasAccessed = true;
      entry.feedback.accessedAt = Date.now();
      entry.feedback.accessLatencyMs =
        entry.feedback.accessedAt - entry.feedback.prefetchedAt;

      // Update in Redis
      this.persistPending(key, entry);
    }

    this.totalAccesses++;
    this.persistCounters();
  }

  /**
   * Record cache hit/miss
   */
  recordCacheResult(hit: boolean): void {
    if (hit) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
    }
    this.persistCounters();
  }

  /**
   * Record topic detection latency
   */
  recordDetectionLatency(latencyMs: number): void {
    this.addLatency('detection', latencyMs);
  }

  /**
   * Record prefetch latency
   */
  recordPrefetchLatency(latencyMs: number): void {
    this.addLatency('prefetch', latencyMs);
  }

  /**
   * Record lookup latency
   */
  recordLookupLatency(latencyMs: number): void {
    this.addLatency('lookup', latencyMs);
  }

  /**
   * Set memory pressure level
   */
  setMemoryPressure(level: 'normal' | 'warning' | 'critical'): void {
    this.memoryPressureLevel = level;
  }

  /**
   * Calculate precision/recall metrics
   */
  calculatePrecisionRecall(
    userId?: string,
    windowMs: number = 24 * 60 * 60 * 1000,
  ): PrecisionRecallMetrics {
    const since = Date.now() - windowMs;

    // Filter feedback by time and optionally user
    const relevantFeedback = this.completedFeedback.filter((f) => {
      if (f.prefetchedAt < since) return false;
      if (userId && f.userId !== userId) return false;
      return true;
    });

    if (relevantFeedback.length === 0) {
      return {
        precision: 0,
        recall: 0,
        f1Score: 0,
        byTopic: {},
      };
    }

    // Calculate overall precision
    const prefetchedCount = relevantFeedback.length;
    const usedCount = relevantFeedback.filter((f) => f.wasAccessed).length;
    const precision = prefetchedCount > 0 ? usedCount / prefetchedCount : 0;

    // For recall, we need to know total accessed memories
    // We use totalAccesses as a proxy
    const recall = this.totalAccesses > 0 ? usedCount / this.totalAccesses : 0;

    // F1 score
    const f1Score =
      precision + recall > 0
        ? (2 * (precision * recall)) / (precision + recall)
        : 0;

    // Calculate by topic
    const byTopic: PrecisionRecallMetrics['byTopic'] = {};
    const topicGroups = new Map<TopicId, PrefetchFeedback[]>();

    for (const feedback of relevantFeedback) {
      if (!topicGroups.has(feedback.topic)) {
        topicGroups.set(feedback.topic, []);
      }
      topicGroups.get(feedback.topic)!.push(feedback);
    }

    for (const [topic, feedbacks] of topicGroups) {
      const topicPrefetched = feedbacks.length;
      const topicUsed = feedbacks.filter((f) => f.wasAccessed).length;
      const topicPrecision =
        topicPrefetched > 0 ? topicUsed / topicPrefetched : 0;
      // We don't have per-topic recall without more data
      const topicRecall = topicPrecision; // Use precision as proxy
      const topicF1 =
        topicPrecision + topicRecall > 0
          ? (2 * (topicPrecision * topicRecall)) /
            (topicPrecision + topicRecall)
          : 0;

      byTopic[topic] = {
        precision: topicPrecision,
        recall: topicRecall,
        f1Score: topicF1,
        sampleSize: topicPrefetched,
      };
    }

    return { precision, recall, f1Score, byTopic };
  }

  /**
   * Get overall prefetch metrics
   */
  getMetrics(): PrefetchMetrics {
    const totalCacheOps = this.cacheHits + this.cacheMisses;
    const pr = this.calculatePrecisionRecall();

    return {
      cacheHitRate: totalCacheOps > 0 ? this.cacheHits / totalCacheOps : 0,
      prefetchHitRate:
        this.totalPrefetches > 0
          ? this.completedFeedback.filter((f) => f.wasAccessed).length /
            this.totalPrefetches
          : 0,
      avgLatencyMs: this.calculateAvgLatency('lookup'),
      p50LatencyMs: this.calculatePercentile('lookup', 50),
      p95LatencyMs: this.calculatePercentile('lookup', 95),
      prefetchPrecision: pr.precision,
      prefetchRecall: pr.recall,
      topicDetectionLatencyMs: this.calculateAvgLatency('detection'),
      totalPrefetches: this.totalPrefetches,
      totalAccesses: this.totalAccesses,
      memoryPressureLevel: this.memoryPressureLevel,
    };
  }

  /**
   * Get topic-specific metrics
   */
  getTopicMetrics(topic: TopicId): {
    precision: number;
    sampleSize: number;
    avgScore: number;
    avgLatencyMs: number;
  } {
    const topicFeedback = this.completedFeedback.filter(
      (f) => f.topic === topic,
    );

    if (topicFeedback.length === 0) {
      return {
        precision: 0,
        sampleSize: 0,
        avgScore: 0,
        avgLatencyMs: 0,
      };
    }

    const usedCount = topicFeedback.filter((f) => f.wasAccessed).length;
    const avgScore =
      topicFeedback.reduce((sum, f) => sum + f.memoryScore, 0) /
      topicFeedback.length;
    const latencies = topicFeedback
      .filter((f) => f.accessLatencyMs !== undefined)
      .map((f) => f.accessLatencyMs!);
    const avgLatencyMs =
      latencies.length > 0
        ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length
        : 0;

    return {
      precision: usedCount / topicFeedback.length,
      sampleSize: topicFeedback.length,
      avgScore,
      avgLatencyMs,
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.pendingFeedback.clear();
    this.completedFeedback = [];
    this.totalPrefetches = 0;
    this.totalAccesses = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;

    for (const bucket of this.latencyBuckets.values()) {
      bucket.latencies = [];
    }

    this.clearRedis();
  }

  /**
   * Get feedback for learning
   */
  getFeedbackForLearning(
    minSamples: number = 50,
    days: number = 7,
  ): Map<TopicId, PrefetchFeedback[]> {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const byTopic = new Map<TopicId, PrefetchFeedback[]>();

    for (const feedback of this.completedFeedback) {
      if (feedback.prefetchedAt < since) continue;

      if (!byTopic.has(feedback.topic)) {
        byTopic.set(feedback.topic, []);
      }
      byTopic.get(feedback.topic)!.push(feedback);
    }

    // Filter to topics with enough samples
    for (const [topic, feedbacks] of byTopic) {
      if (feedbacks.length < minSamples) {
        byTopic.delete(topic);
      }
    }

    return byTopic;
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  /**
   * Complete feedback entry
   */
  private completeFeedback(prefetchId: string, memoryId: string): void {
    const key = `${prefetchId}:${memoryId}`;
    const entry = this.pendingFeedback.get(key);

    if (!entry || entry.completed) return;

    entry.completed = true;
    this.pendingFeedback.delete(key);

    // Store completed feedback
    this.completedFeedback.push(entry.feedback);

    // Trim history
    while (this.completedFeedback.length > this.maxFeedbackHistory) {
      this.completedFeedback.shift();
    }

    // Persist to Redis
    this.removePending(key);
    this.persistCompleted();
  }

  /**
   * Add latency to bucket
   */
  private addLatency(bucket: string, latencyMs: number): void {
    const b = this.latencyBuckets.get(bucket);
    if (!b) return;

    b.latencies.push(latencyMs);

    // Trim to max size
    while (b.latencies.length > b.maxSize) {
      b.latencies.shift();
    }

    // Persist to Redis
    this.persistLatencyBucket(bucket, b);
  }

  /**
   * Calculate average latency for a bucket
   */
  private calculateAvgLatency(bucket: string): number {
    const b = this.latencyBuckets.get(bucket);
    if (!b || b.latencies.length === 0) return 0;

    return b.latencies.reduce((sum, l) => sum + l, 0) / b.latencies.length;
  }

  /**
   * Calculate percentile latency
   */
  private calculatePercentile(bucket: string, percentile: number): number {
    const b = this.latencyBuckets.get(bucket);
    if (!b || b.latencies.length === 0) return 0;

    const sorted = [...b.latencies].sort((a, b) => a - b);
    const index = Math.floor((percentile / 100) * sorted.length);
    return sorted[Math.min(index, sorted.length - 1)];
  }

  // =========================================================================
  // Redis Persistence (fire-and-forget write-through)
  // =========================================================================

  private persistPending(key: string, entry: FeedbackEntry): void {
    if (!this.redis) return;
    this.redis
      .hset(PENDING_KEY, key, JSON.stringify(entry))
      .catch((err) => this.logger.warn('Redis persist pending failed', err));
  }

  private removePending(key: string): void {
    if (!this.redis) return;
    this.redis
      .hdel(PENDING_KEY, key)
      .catch((err) => this.logger.warn('Redis remove pending failed', err));
  }

  private persistCompleted(): void {
    if (!this.redis) return;
    this.redis
      .set(COMPLETED_KEY, JSON.stringify(this.completedFeedback))
      .catch((err) => this.logger.warn('Redis persist completed failed', err));
  }

  private persistLatencyBucket(bucket: string, b: LatencyBucket): void {
    if (!this.redis) return;
    this.redis
      .set(LATENCY_PREFIX + bucket, JSON.stringify(b))
      .catch((err) => this.logger.warn('Redis persist latency failed', err));
  }

  private persistCounters(): void {
    if (!this.redis) return;
    this.redis
      .set(
        COUNTERS_KEY,
        JSON.stringify({
          totalPrefetches: this.totalPrefetches,
          totalAccesses: this.totalAccesses,
          cacheHits: this.cacheHits,
          cacheMisses: this.cacheMisses,
        }),
      )
      .catch((err) => this.logger.warn('Redis persist counters failed', err));
  }

  private clearRedis(): void {
    if (!this.redis) return;
    this.redis.del(PENDING_KEY, COMPLETED_KEY, COUNTERS_KEY).catch(() => {});
    for (const bucket of this.latencyBuckets.keys()) {
      this.redis.del(LATENCY_PREFIX + bucket).catch(() => {});
    }
  }

  private async hydrateFromRedis(): Promise<void> {
    if (!this.redis) return;

    // Hydrate pending feedback
    const pendingData = await this.redis.hgetall(PENDING_KEY);
    for (const [key, val] of Object.entries(pendingData)) {
      try {
        const entry: FeedbackEntry = JSON.parse(val);
        this.pendingFeedback.set(key, entry);
      } catch {
        // skip malformed
      }
    }

    // Hydrate completed feedback
    const completedData = await this.redis.get(COMPLETED_KEY);
    if (completedData) {
      try {
        this.completedFeedback = JSON.parse(completedData);
      } catch {
        // skip malformed
      }
    }

    // Hydrate latency buckets
    for (const bucket of ['prefetch', 'lookup', 'detection']) {
      const data = await this.redis.get(LATENCY_PREFIX + bucket);
      if (data) {
        try {
          const parsed: LatencyBucket = JSON.parse(data);
          this.latencyBuckets.set(bucket, parsed);
        } catch {
          // skip malformed
        }
      }
    }

    // Hydrate counters
    const countersData = await this.redis.get(COUNTERS_KEY);
    if (countersData) {
      try {
        const counters = JSON.parse(countersData);
        this.totalPrefetches = counters.totalPrefetches ?? 0;
        this.totalAccesses = counters.totalAccesses ?? 0;
        this.cacheHits = counters.cacheHits ?? 0;
        this.cacheMisses = counters.cacheMisses ?? 0;
      } catch {
        // skip malformed
      }
    }

    const totalHydrated =
      this.pendingFeedback.size + this.completedFeedback.length;
    if (totalHydrated > 0) {
      this.logger.log(
        `Hydrated ${this.pendingFeedback.size} pending + ${this.completedFeedback.length} completed metrics from Redis`,
      );
    }
  }
}
