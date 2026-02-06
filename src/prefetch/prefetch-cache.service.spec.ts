import { Test, TestingModule } from '@nestjs/testing';
import { PrefetchCacheService, DEFAULT_CACHE_CONFIG } from './prefetch-cache.service';
import { CachedMemory, TopicId } from './prefetch.types';

describe('PrefetchCacheService', () => {
  let service: PrefetchCacheService;

  const createMockMemory = (
    id: string,
    topics: TopicId[] = ['family'],
    score: number = 0.8,
  ): CachedMemory => ({
    id,
    content: `Test memory ${id}`,
    embedding: [0.1, 0.2, 0.3],
    score,
    layer: 'IDENTITY',
    cachedAt: Date.now(),
    accessCount: 0,
    lastAccessedAt: Date.now(),
    topics,
    prefetchedFor: topics[0],
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrefetchCacheService],
    }).compile();

    service = module.get<PrefetchCacheService>(PrefetchCacheService);
  });

  afterEach(() => {
    service.clear();
  });

  describe('configuration', () => {
    it('should have default configuration', () => {
      const config = service.getConfig();
      expect(config).toEqual(DEFAULT_CACHE_CONFIG);
    });

    it('should allow configuration updates', () => {
      service.configure({ maxSize: 100 });
      const config = service.getConfig();
      expect(config.maxSize).toBe(100);
    });

    it('should resize cache when maxSize reduced', () => {
      // Fill cache
      for (let i = 0; i < 10; i++) {
        service.set(createMockMemory(`mem-${i}`));
      }
      expect(service.getStats().size).toBe(10);

      // Reduce size
      service.configure({ maxSize: 5 });
      expect(service.getStats().size).toBeLessThanOrEqual(5);
    });
  });

  describe('set and get', () => {
    it('should store and retrieve a memory', () => {
      const memory = createMockMemory('test-1');
      service.set(memory);
      
      const retrieved = service.get('test-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('test-1');
    });

    it('should return null for non-existent memory', () => {
      const result = service.get('non-existent');
      expect(result).toBeNull();
    });

    it('should increment access count on get', () => {
      const memory = createMockMemory('test-1');
      service.set(memory);
      
      service.get('test-1');
      service.get('test-1');
      
      const retrieved = service.get('test-1');
      expect(retrieved?.accessCount).toBe(3);
    });

    it('should update lastAccessedAt on get', async () => {
      const memory = createMockMemory('test-1');
      service.set(memory);
      
      const before = service.get('test-1')?.lastAccessedAt ?? 0;
      
      // Small delay
      await new Promise(resolve => setTimeout(resolve, 5));
      
      const after = service.get('test-1')?.lastAccessedAt ?? 0;
      expect(after).toBeGreaterThanOrEqual(before);
    });

    it('should check if memory exists with has()', () => {
      service.set(createMockMemory('test-1'));
      
      expect(service.has('test-1')).toBe(true);
      expect(service.has('non-existent')).toBe(false);
    });

    it('should merge topics when setting existing memory', () => {
      service.set(createMockMemory('test-1', ['family']));
      service.set(createMockMemory('test-1', ['work']));
      
      const retrieved = service.get('test-1');
      expect(retrieved?.topics).toContain('family');
      expect(retrieved?.topics).toContain('work');
    });

    it('should preserve access count when updating', () => {
      const memory = createMockMemory('test-1');
      service.set(memory);
      service.get('test-1');
      service.get('test-1');
      
      const updatedMemory = createMockMemory('test-1');
      service.set(updatedMemory);
      
      const retrieved = service.get('test-1');
      expect(retrieved?.accessCount).toBe(3);
    });
  });

  describe('getMany', () => {
    it('should retrieve multiple memories', () => {
      service.set(createMockMemory('mem-1'));
      service.set(createMockMemory('mem-2'));
      service.set(createMockMemory('mem-3'));
      
      const result = service.getMany(['mem-1', 'mem-2', 'mem-3']);
      
      expect(result.memories.length).toBe(3);
      expect(result.hitCount).toBe(3);
      expect(result.missCount).toBe(0);
    });

    it('should report misses for non-existent memories', () => {
      service.set(createMockMemory('mem-1'));
      
      const result = service.getMany(['mem-1', 'non-existent', 'also-missing']);
      
      expect(result.memories.length).toBe(1);
      expect(result.hitCount).toBe(1);
      expect(result.missCount).toBe(2);
    });

    it('should report lookup time', () => {
      const result = service.getMany(['mem-1', 'mem-2']);
      expect(result.lookupTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('TTL expiration', () => {
    it('should return null for expired memories', () => {
      service.configure({ ttlMs: 100 });
      
      const memory = createMockMemory('test-1');
      memory.cachedAt = Date.now() - 200; // Expired
      service.set(memory);
      // Force the cachedAt to be in the past
      const cached = service['cache'].get('test-1');
      if (cached) cached.cachedAt = Date.now() - 200;
      
      const result = service.get('test-1');
      expect(result).toBeNull();
    });

    it('should clean up expired entries', () => {
      service.configure({ ttlMs: 100 });
      
      // Add expired memory
      const memory = createMockMemory('test-1');
      service.set(memory);
      const cached = service['cache'].get('test-1');
      if (cached) cached.cachedAt = Date.now() - 200;
      
      const evicted = service.cleanupExpired();
      expect(evicted).toBe(1);
    });
  });

  describe('topic indexing', () => {
    it('should index memories by topic', () => {
      service.set(createMockMemory('mem-1', ['family']));
      service.set(createMockMemory('mem-2', ['family']));
      service.set(createMockMemory('mem-3', ['work']));
      
      const familyMemories = service.getByTopic('family');
      expect(familyMemories.length).toBe(2);
    });

    it('should return empty array for unknown topic', () => {
      const result = service.getByTopic('nonexistent' as TopicId);
      expect(result).toEqual([]);
    });

    it('should sort memories by score', () => {
      service.set(createMockMemory('mem-1', ['family'], 0.5));
      service.set(createMockMemory('mem-2', ['family'], 0.9));
      service.set(createMockMemory('mem-3', ['family'], 0.7));
      
      const memories = service.getByTopic('family');
      expect(memories[0].score).toBe(0.9);
      expect(memories[1].score).toBe(0.7);
      expect(memories[2].score).toBe(0.5);
    });

    it('should get memory IDs by topic', () => {
      service.set(createMockMemory('mem-1', ['family']));
      service.set(createMockMemory('mem-2', ['family']));
      
      const ids = service.getIdsByTopic('family');
      expect(ids).toContain('mem-1');
      expect(ids).toContain('mem-2');
    });
  });

  describe('prefetchForTopic', () => {
    it('should prefetch multiple memories', () => {
      const memories = [
        { id: 'mem-1', content: 'test 1', embedding: [], score: 0.8, layer: 'IDENTITY' },
        { id: 'mem-2', content: 'test 2', embedding: [], score: 0.7, layer: 'IDENTITY' },
      ];
      
      const count = service.prefetchForTopic(memories, 'family');
      
      expect(count).toBe(2);
      expect(service.has('mem-1')).toBe(true);
      expect(service.has('mem-2')).toBe(true);
    });

    it('should skip already cached memories', () => {
      service.set(createMockMemory('mem-1', ['family']));
      
      const memories = [
        { id: 'mem-1', content: 'test 1', embedding: [], score: 0.8, layer: 'IDENTITY' },
        { id: 'mem-2', content: 'test 2', embedding: [], score: 0.7, layer: 'IDENTITY' },
      ];
      
      const count = service.prefetchForTopic(memories, 'family');
      
      expect(count).toBe(1); // Only mem-2 was new
    });

    it('should mark prefetched memories with prefetchedFor', () => {
      const memories = [
        { id: 'mem-1', content: 'test 1', embedding: [], score: 0.8, layer: 'IDENTITY' },
      ];
      
      service.prefetchForTopic(memories, 'family');
      
      const cached = service.get('mem-1');
      expect(cached?.prefetchedFor).toBe('family');
    });
  });

  describe('eviction', () => {
    it('should evict specific memory', () => {
      service.set(createMockMemory('test-1'));
      expect(service.has('test-1')).toBe(true);
      
      const result = service.evict('test-1');
      
      expect(result).toBe(true);
      expect(service.has('test-1')).toBe(false);
    });

    it('should return false when evicting non-existent memory', () => {
      const result = service.evict('non-existent');
      expect(result).toBe(false);
    });

    it('should evict all memories for a topic', () => {
      service.set(createMockMemory('mem-1', ['family']));
      service.set(createMockMemory('mem-2', ['family']));
      service.set(createMockMemory('mem-3', ['work']));
      
      const evicted = service.evictTopic('family');
      
      expect(evicted).toBe(2);
      expect(service.has('mem-1')).toBe(false);
      expect(service.has('mem-2')).toBe(false);
      expect(service.has('mem-3')).toBe(true);
    });

    it('should not evict memories with multiple topics', () => {
      service.set(createMockMemory('mem-1', ['family', 'work']));
      
      service.evictTopic('family');
      
      // Memory should still exist but without family topic
      expect(service.has('mem-1')).toBe(true);
      const cached = service.get('mem-1');
      expect(cached?.topics).not.toContain('family');
      expect(cached?.topics).toContain('work');
    });

    it('should evict LRU when at capacity', () => {
      service.configure({ maxSize: 3, topicSlots: 0 });
      
      service.set(createMockMemory('mem-1'));
      service.set(createMockMemory('mem-2'));
      service.set(createMockMemory('mem-3'));
      
      // Access mem-2 and mem-3 to make mem-1 LRU
      service.get('mem-2');
      service.get('mem-3');
      
      // Add new memory, should evict mem-1
      service.set(createMockMemory('mem-4'));
      
      expect(service.has('mem-1')).toBe(false);
      expect(service.has('mem-2')).toBe(true);
      expect(service.has('mem-3')).toBe(true);
      expect(service.has('mem-4')).toBe(true);
    });
  });

  describe('getCachedIds', () => {
    it('should return all cached memory IDs', () => {
      service.set(createMockMemory('mem-1'));
      service.set(createMockMemory('mem-2'));
      service.set(createMockMemory('mem-3'));
      
      const ids = service.getCachedIds();
      
      expect(ids.size).toBe(3);
      expect(ids.has('mem-1')).toBe(true);
      expect(ids.has('mem-2')).toBe(true);
      expect(ids.has('mem-3')).toBe(true);
    });
  });

  describe('clear', () => {
    it('should clear all entries', () => {
      service.set(createMockMemory('mem-1'));
      service.set(createMockMemory('mem-2'));
      
      service.clear();
      
      expect(service.getStats().size).toBe(0);
      expect(service.has('mem-1')).toBe(false);
      expect(service.has('mem-2')).toBe(false);
    });

    it('should reset metrics when clearing', () => {
      service.set(createMockMemory('mem-1'));
      service.get('mem-1');
      
      service.clear();
      
      const stats = service.getStats();
      expect(stats.totalAccessCount).toBe(0);
    });
  });

  describe('statistics', () => {
    it('should track cache size', () => {
      expect(service.getStats().size).toBe(0);
      
      service.set(createMockMemory('mem-1'));
      service.set(createMockMemory('mem-2'));
      
      expect(service.getStats().size).toBe(2);
    });

    it('should track topic count', () => {
      service.set(createMockMemory('mem-1', ['family']));
      service.set(createMockMemory('mem-2', ['work']));
      
      expect(service.getStats().topicCount).toBe(2);
    });

    it('should track hit rate', () => {
      service.set(createMockMemory('mem-1'));
      
      service.get('mem-1'); // Hit
      service.get('non-existent'); // Miss
      
      const stats = service.getStats();
      expect(stats.hitRate).toBe(0.5);
      expect(stats.missRate).toBe(0.5);
    });

    it('should track prefetch precision', () => {
      // Prefetch two memories
      service.prefetchForTopic(
        [
          { id: 'mem-1', content: 'test', embedding: [], score: 0.8, layer: 'IDENTITY' },
          { id: 'mem-2', content: 'test', embedding: [], score: 0.7, layer: 'IDENTITY' },
        ],
        'family',
      );
      
      // Access one of them
      service.get('mem-1');
      
      const stats = service.getStats();
      expect(stats.prefetchedCount).toBe(2);
      expect(stats.prefetchedUsed).toBe(1);
      expect(stats.prefetchPrecision).toBe(0.5);
    });

    it('should reset metrics independently', () => {
      service.set(createMockMemory('mem-1'));
      service.get('mem-1');
      
      service.resetMetrics();
      
      const stats = service.getStats();
      expect(stats.totalAccessCount).toBe(0);
      expect(stats.size).toBe(1); // Size not reset
    });
  });

  describe('edge cases', () => {
    it('should handle zero maxSize gracefully', () => {
      service.configure({ maxSize: 0 });
      
      // Should not throw, just won't cache anything
      service.set(createMockMemory('test-1'));
      expect(service.getStats().size).toBe(0);
    });

    it('should handle empty topic array', () => {
      const memory = createMockMemory('test-1', []);
      service.set(memory);
      
      expect(service.has('test-1')).toBe(true);
    });
  });
});
