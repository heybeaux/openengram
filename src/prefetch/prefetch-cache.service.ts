/**
 * Prefetch Cache Service
 *
 * LRU cache for pre-fetched memories with topic indexing.
 * Uses in-memory Maps for fast synchronous access with Redis
 * write-through for persistence across restarts.
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
  CachedMemory,
  CacheLookupResult,
  CacheStats,
  CacheConfig,
} from './prefetch.types';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

const CACHE_PREFIX = 'prefetch:cache:';
const TOPIC_INDEX_PREFIX = 'prefetch:topic:';

/**
 * Default cache configuration
 */
export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  maxSize: 500,
  ttlMs: 10 * 60 * 1000, // 10 minutes
  topicSlots: 50, // Reserved slots per topic
  enableMetrics: true,
};

@Injectable()
export class PrefetchCacheService implements OnModuleInit {
  private readonly logger = new Logger(PrefetchCacheService.name);

  // In-memory hot cache for synchronous O(1) access
  private cache: Map<string, CachedMemory> = new Map();
  private topicIndex: Map<TopicId, Set<string>> = new Map();
  private accessOrder: string[] = [];
  private config: CacheConfig;

  // Metrics
  private totalHits = 0;
  private totalMisses = 0;
  private totalPrefetched = 0;
  private totalPrefetchedUsed = 0;

  constructor(
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {
    this.config = { ...DEFAULT_CACHE_CONFIG };
  }

  async onModuleInit(): Promise<void> {
    if (!this.redis) return;
    try {
      await this.hydrateFromRedis();
    } catch (err) {
      this.logger.warn('Failed to hydrate prefetch cache from Redis', err);
    }
  }

  /**
   * Configure the cache
   */
  configure(config: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...config };

    // Resize if needed
    while (this.cache.size > this.config.maxSize) {
      if (!this.evictLRU()) break;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): CacheConfig {
    return { ...this.config };
  }

  /**
   * Get a single memory from cache
   */
  get(memoryId: string): CachedMemory | null {
    const entry = this.cache.get(memoryId);
    if (!entry) {
      if (this.config.enableMetrics) this.totalMisses++;
      return null;
    }

    // Check TTL
    if (Date.now() - entry.cachedAt > this.config.ttlMs) {
      this.evict(memoryId);
      if (this.config.enableMetrics) this.totalMisses++;
      return null;
    }

    // Update access stats
    entry.accessCount++;
    entry.lastAccessedAt = Date.now();
    this.promoteToHead(memoryId);

    // Track if prefetched memory was used
    if (this.config.enableMetrics) {
      this.totalHits++;
      if (entry.prefetchedFor && entry.accessCount === 1) {
        this.totalPrefetchedUsed++;
      }
    }

    return entry;
  }

  /**
   * Get multiple memories from cache
   */
  getMany(memoryIds: string[]): CacheLookupResult {
    const startTime = Date.now();
    const memories: CachedMemory[] = [];
    let hitCount = 0;
    let missCount = 0;

    for (const id of memoryIds) {
      const entry = this.get(id);
      if (entry) {
        memories.push(entry);
        hitCount++;
      } else {
        missCount++;
      }
    }

    return {
      memories,
      hitCount,
      missCount,
      lookupTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Check if a memory is in the cache
   */
  has(memoryId: string): boolean {
    const entry = this.cache.get(memoryId);
    if (!entry) return false;

    // Check TTL
    if (Date.now() - entry.cachedAt > this.config.ttlMs) {
      this.evict(memoryId);
      return false;
    }

    return true;
  }

  /**
   * Set a memory in the cache
   */
  set(memory: CachedMemory): void {
    // Don't cache if maxSize is 0
    if (this.config.maxSize <= 0) return;

    // Evict if at capacity
    while (this.cache.size >= this.config.maxSize) {
      if (!this.evictLRU()) break;
    }

    // Update or create entry
    const existing = this.cache.get(memory.id);
    if (existing) {
      // Merge topics
      const allTopics = new Set([...existing.topics, ...memory.topics]);
      memory.topics = Array.from(allTopics);
      memory.accessCount = existing.accessCount;
    }

    memory.cachedAt = Date.now();
    memory.lastAccessedAt = Date.now();
    this.cache.set(memory.id, memory);

    // Update access order
    if (!existing) {
      this.accessOrder.push(memory.id);
    }

    // Update topic index
    for (const topic of memory.topics) {
      if (!this.topicIndex.has(topic)) {
        this.topicIndex.set(topic, new Set());
      }
      this.topicIndex.get(topic)!.add(memory.id);
    }

    // Track prefetch metrics
    if (this.config.enableMetrics && memory.prefetchedFor) {
      this.totalPrefetched++;
    }

    // Write-through to Redis
    this.persistToRedis(memory);
  }

  /**
   * Prefetch multiple memories for a topic
   */
  prefetchForTopic(
    memories: Array<{
      id: string;
      content: string;
      embedding: number[];
      score: number;
      layer: string;
    }>,
    topic: TopicId,
  ): number {
    let prefetchedCount = 0;

    for (const mem of memories) {
      if (this.has(mem.id)) continue;

      const cached: CachedMemory = {
        ...mem,
        cachedAt: Date.now(),
        accessCount: 0,
        lastAccessedAt: Date.now(),
        topics: [topic],
        prefetchedFor: topic,
      };

      this.set(cached);
      prefetchedCount++;
    }

    return prefetchedCount;
  }

  /**
   * Get all memories for a topic
   */
  getByTopic(topic: TopicId): CachedMemory[] {
    const memoryIds = this.topicIndex.get(topic);
    if (!memoryIds) return [];

    const memories: CachedMemory[] = [];
    for (const id of memoryIds) {
      const entry = this.get(id);
      if (entry) {
        memories.push(entry);
      }
    }

    return memories.sort((a, b) => b.score - a.score);
  }

  /**
   * Get memory IDs for a topic without fetching full memories
   */
  getIdsByTopic(topic: TopicId): string[] {
    const memoryIds = this.topicIndex.get(topic);
    return memoryIds ? Array.from(memoryIds) : [];
  }

  /**
   * Evict all memories for a topic
   */
  evictTopic(topic: TopicId): number {
    const memoryIds = this.topicIndex.get(topic);
    if (!memoryIds) return 0;

    let evictedCount = 0;
    for (const id of memoryIds) {
      const entry = this.cache.get(id);
      if (entry && entry.topics.length === 1) {
        // Only in this topic, safe to evict
        this.evict(id);
        evictedCount++;
      } else if (entry) {
        // In multiple topics, just remove from this topic's index
        entry.topics = entry.topics.filter((t) => t !== topic);
      }
    }

    this.topicIndex.delete(topic);
    this.deleteRedisTopicIndex(topic);
    return evictedCount;
  }

  /**
   * Evict a specific memory
   */
  evict(memoryId: string): boolean {
    const entry = this.cache.get(memoryId);
    if (!entry) return false;

    // Remove from topic indexes
    for (const topic of entry.topics) {
      this.topicIndex.get(topic)?.delete(memoryId);
    }

    // Remove from cache
    this.cache.delete(memoryId);
    this.accessOrder = this.accessOrder.filter((id) => id !== memoryId);

    // Remove from Redis
    this.deleteFromRedis(memoryId, entry.topics);

    return true;
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.cache.clear();
    this.topicIndex.clear();
    this.accessOrder = [];
    this.resetMetrics();
    this.clearRedis();
  }

  /**
   * Get all cached memory IDs
   */
  getCachedIds(): Set<string> {
    return new Set(this.cache.keys());
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const prefetchedCount = this.totalPrefetched;
    const prefetchedUsed = this.totalPrefetchedUsed;
    const totalAccesses = this.totalHits + this.totalMisses;

    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      topicCount: this.topicIndex.size,
      totalAccessCount: totalAccesses,
      prefetchedCount,
      prefetchedUsed,
      prefetchPrecision:
        prefetchedCount > 0 ? prefetchedUsed / prefetchedCount : 0,
      hitRate: totalAccesses > 0 ? this.totalHits / totalAccesses : 0,
      missRate: totalAccesses > 0 ? this.totalMisses / totalAccesses : 0,
    };
  }

  /**
   * Reset metrics counters
   */
  resetMetrics(): void {
    this.totalHits = 0;
    this.totalMisses = 0;
    this.totalPrefetched = 0;
    this.totalPrefetchedUsed = 0;
  }

  /**
   * Run TTL cleanup - evict expired entries
   */
  cleanupExpired(): number {
    const now = Date.now();
    let evictedCount = 0;

    for (const [id, entry] of this.cache) {
      if (now - entry.cachedAt > this.config.ttlMs) {
        this.evict(id);
        evictedCount++;
      }
    }

    return evictedCount;
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  /**
   * Evict the least recently used entry
   */
  private evictLRU(): boolean {
    // Find LRU entry that isn't protected by topic slots
    for (const id of this.accessOrder) {
      const entry = this.cache.get(id);
      if (!entry) continue;

      // Don't evict if it's a protected topic slot
      const isTopicProtected = entry.topics.some((topic) => {
        const topicMemories = this.topicIndex.get(topic);
        return topicMemories && topicMemories.size <= this.config.topicSlots;
      });

      if (!isTopicProtected) {
        this.evict(id);
        return true;
      }
    }

    // If all protected, evict oldest anyway
    if (this.accessOrder.length > 0) {
      this.evict(this.accessOrder[0]);
      return true;
    }

    return false;
  }

  /**
   * Move an entry to the head of the access order (most recently used)
   */
  private promoteToHead(memoryId: string): void {
    this.accessOrder = this.accessOrder.filter((id) => id !== memoryId);
    this.accessOrder.push(memoryId);
  }

  // =========================================================================
  // Redis Persistence (fire-and-forget write-through)
  // =========================================================================

  private persistToRedis(memory: CachedMemory): void {
    if (!this.redis) return;
    const ttlSec = Math.ceil(this.config.ttlMs / 1000);
    const key = CACHE_PREFIX + memory.id;
    this.redis
      .set(key, JSON.stringify(memory), 'EX', ttlSec)
      .catch((err) => this.logger.warn('Redis persist failed', err));

    // Update topic index sets in Redis
    for (const topic of memory.topics) {
      const topicKey = TOPIC_INDEX_PREFIX + topic;
      this.redis
        .sadd(topicKey, memory.id)
        .then(() => this.redis!.expire(topicKey, ttlSec * 2))
        .catch((err) => this.logger.warn('Redis topic index failed', err));
    }
  }

  private deleteFromRedis(memoryId: string, topics: TopicId[]): void {
    if (!this.redis) return;
    this.redis
      .del(CACHE_PREFIX + memoryId)
      .catch((err) => this.logger.warn('Redis delete failed', err));
    for (const topic of topics) {
      this.redis
        .srem(TOPIC_INDEX_PREFIX + topic, memoryId)
        .catch((err) => this.logger.warn('Redis srem failed', err));
    }
  }

  private deleteRedisTopicIndex(topic: TopicId): void {
    if (!this.redis) return;
    this.redis
      .del(TOPIC_INDEX_PREFIX + topic)
      .catch((err) => this.logger.warn('Redis topic delete failed', err));
  }

  private clearRedis(): void {
    if (!this.redis) return;
    // Scan and delete all prefetch keys
    const stream = this.redis.scanStream({ match: 'prefetch:*', count: 100 });
    stream.on('data', (keys: string[]) => {
      if (keys.length > 0) {
        this.redis!.del(...keys).catch(() => {});
      }
    });
  }

  private async hydrateFromRedis(): Promise<void> {
    if (!this.redis) return;
    const keys: string[] = [];
    const stream = this.redis.scanStream({
      match: CACHE_PREFIX + '*',
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
    for (const [err, val] of results) {
      if (err || !val) continue;
      try {
        const memory: CachedMemory = JSON.parse(val as string);
        // Check if still within TTL
        if (Date.now() - memory.cachedAt > this.config.ttlMs) continue;
        // Insert into in-memory structures without re-persisting
        this.cache.set(memory.id, memory);
        this.accessOrder.push(memory.id);
        for (const topic of memory.topics) {
          if (!this.topicIndex.has(topic)) {
            this.topicIndex.set(topic, new Set());
          }
          this.topicIndex.get(topic)!.add(memory.id);
        }
        hydrated++;
      } catch {
        // skip malformed entries
      }
    }

    this.logger.log(`Hydrated ${hydrated} prefetch cache entries from Redis`);
  }
}
