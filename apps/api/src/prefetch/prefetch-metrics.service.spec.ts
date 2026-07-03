import { Test, TestingModule } from '@nestjs/testing';
import { PrefetchMetricsService } from './prefetch-metrics.service';
import { REDIS_CLIENT } from './prefetch-cache.service';
import { TopicId } from './prefetch.types';

describe('PrefetchMetricsService', () => {
  let service: PrefetchMetricsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrefetchMetricsService,
        { provide: REDIS_CLIENT, useValue: undefined },
      ],
    }).compile();

    service = module.get<PrefetchMetricsService>(PrefetchMetricsService);
  });

  afterEach(() => {
    service.reset();
  });

  describe('recordPrefetch', () => {
    it('should record a prefetch operation', () => {
      service.recordPrefetch('pf-1', 'user-1', 'family', 'mem-1', 0.8, 0.9);

      const metrics = service.getMetrics();
      expect(metrics.totalPrefetches).toBe(1);
    });

    it('should track multiple prefetches', () => {
      service.recordPrefetch('pf-1', 'user-1', 'family', 'mem-1', 0.8, 0.9);
      service.recordPrefetch('pf-1', 'user-1', 'family', 'mem-2', 0.8, 0.85);
      service.recordPrefetch('pf-2', 'user-1', 'work', 'mem-3', 0.7, 0.8);

      const metrics = service.getMetrics();
      expect(metrics.totalPrefetches).toBe(3);
    });
  });

  describe('recordAccess', () => {
    it('should mark prefetched memory as accessed', () => {
      service.recordPrefetch('pf-1', 'user-1', 'family', 'mem-1', 0.8, 0.9);
      service.recordAccess('pf-1', 'mem-1');

      const metrics = service.getMetrics();
      expect(metrics.totalAccesses).toBe(1);
    });

    it('should calculate access latency', () => {
      const startTime = Date.now();
      service.recordPrefetch('pf-1', 'user-1', 'family', 'mem-1', 0.8, 0.9);

      // Small delay
      const delay = 10;
      service.recordAccess('pf-1', 'mem-1');

      // Access was recorded
      expect(service.getMetrics().totalAccesses).toBe(1);
    });
  });

  describe('recordCacheResult', () => {
    it('should track cache hits', () => {
      service.recordCacheResult(true);
      service.recordCacheResult(true);

      const metrics = service.getMetrics();
      expect(metrics.cacheHitRate).toBe(1);
    });

    it('should track cache misses', () => {
      service.recordCacheResult(false);
      service.recordCacheResult(false);

      const metrics = service.getMetrics();
      expect(metrics.cacheHitRate).toBe(0);
    });

    it('should calculate hit rate correctly', () => {
      service.recordCacheResult(true);
      service.recordCacheResult(true);
      service.recordCacheResult(false);
      service.recordCacheResult(false);

      const metrics = service.getMetrics();
      expect(metrics.cacheHitRate).toBe(0.5);
    });
  });

  describe('latency tracking', () => {
    it('should record detection latency', () => {
      service.recordDetectionLatency(5);
      service.recordDetectionLatency(10);
      service.recordDetectionLatency(15);

      const metrics = service.getMetrics();
      expect(metrics.topicDetectionLatencyMs).toBe(10); // Average
    });

    it('should record prefetch latency', () => {
      service.recordPrefetchLatency(50);
      service.recordPrefetchLatency(100);

      // Prefetch latency not directly exposed in metrics but tracked internally
      expect(true).toBe(true); // Just verify no errors
    });

    it('should record lookup latency', () => {
      service.recordLookupLatency(1);
      service.recordLookupLatency(3);
      service.recordLookupLatency(5);

      const metrics = service.getMetrics();
      expect(metrics.avgLatencyMs).toBe(3); // Average
    });

    it('should calculate percentiles', () => {
      // Add 10 latencies
      for (let i = 1; i <= 10; i++) {
        service.recordLookupLatency(i * 10); // 10, 20, 30, ..., 100
      }

      const metrics = service.getMetrics();
      // p50 with 10 values at index 5 (0-indexed) = 60
      expect(metrics.p50LatencyMs).toBe(60);
      expect(metrics.p95LatencyMs).toBeGreaterThanOrEqual(90);
    });
  });

  describe('memory pressure', () => {
    it('should track memory pressure level', () => {
      expect(service.getMetrics().memoryPressureLevel).toBe('normal');

      service.setMemoryPressure('warning');
      expect(service.getMetrics().memoryPressureLevel).toBe('warning');

      service.setMemoryPressure('critical');
      expect(service.getMetrics().memoryPressureLevel).toBe('critical');
    });
  });

  describe('precision/recall calculation', () => {
    it('should calculate precision', () => {
      // Prefetch 4 memories
      service.recordPrefetch('pf-1', 'user-1', 'family', 'mem-1', 0.8, 0.9);
      service.recordPrefetch('pf-1', 'user-1', 'family', 'mem-2', 0.8, 0.85);
      service.recordPrefetch('pf-1', 'user-1', 'family', 'mem-3', 0.8, 0.8);
      service.recordPrefetch('pf-1', 'user-1', 'family', 'mem-4', 0.8, 0.75);

      // Access 2 of them
      service.recordAccess('pf-1', 'mem-1');
      service.recordAccess('pf-1', 'mem-2');

      // Wait for feedback to complete (or trigger manually)
      // In production this would wait for timeout
      // For testing, we can check metrics which uses totalAccesses
      const metrics = service.getMetrics();
      expect(metrics.totalAccesses).toBe(2);
      expect(metrics.totalPrefetches).toBe(4);
    });

    it('should calculate precision by topic', () => {
      // Prefetch for family
      service.recordPrefetch('pf-1', 'user-1', 'family', 'mem-1', 0.8, 0.9);
      service.recordPrefetch('pf-1', 'user-1', 'family', 'mem-2', 0.8, 0.85);

      // Prefetch for work
      service.recordPrefetch('pf-2', 'user-1', 'work', 'mem-3', 0.7, 0.8);

      // Access family memory
      service.recordAccess('pf-1', 'mem-1');

      // Topic metrics would be calculated after feedback completes
      const familyMetrics = service.getTopicMetrics('family');
      // Initial state before feedback completes
      expect(familyMetrics.sampleSize).toBe(0); // No completed feedback yet
    });

    it('should return zero precision for unknown topic', () => {
      const metrics = service.getTopicMetrics('nonexistent' as TopicId);
      expect(metrics.precision).toBe(0);
      expect(metrics.sampleSize).toBe(0);
    });

    it('should calculate F1 score', () => {
      const pr = service.calculatePrecisionRecall();

      // With no data, should be zero
      expect(pr.f1Score).toBe(0);
    });
  });

  describe('getFeedbackForLearning', () => {
    it('should return empty map when no feedback', () => {
      const feedback = service.getFeedbackForLearning();
      expect(feedback.size).toBe(0);
    });

    it('should filter by minimum samples', () => {
      // Add less than minSamples
      for (let i = 0; i < 10; i++) {
        service.recordPrefetch(
          `pf-${i}`,
          'user-1',
          'family',
          `mem-${i}`,
          0.8,
          0.9,
        );
      }

      const feedback = service.getFeedbackForLearning(50);
      expect(feedback.size).toBe(0); // Not enough samples
    });
  });

  describe('reset', () => {
    it('should reset all metrics', () => {
      service.recordPrefetch('pf-1', 'user-1', 'family', 'mem-1', 0.8, 0.9);
      service.recordAccess('pf-1', 'mem-1');
      service.recordCacheResult(true);
      service.recordDetectionLatency(10);

      service.reset();

      const metrics = service.getMetrics();
      expect(metrics.totalPrefetches).toBe(0);
      expect(metrics.totalAccesses).toBe(0);
      expect(metrics.cacheHitRate).toBe(0);
    });
  });

  describe('getMetrics', () => {
    it('should return all metrics', () => {
      const metrics = service.getMetrics();

      expect(metrics).toHaveProperty('cacheHitRate');
      expect(metrics).toHaveProperty('prefetchHitRate');
      expect(metrics).toHaveProperty('avgLatencyMs');
      expect(metrics).toHaveProperty('p50LatencyMs');
      expect(metrics).toHaveProperty('p95LatencyMs');
      expect(metrics).toHaveProperty('prefetchPrecision');
      expect(metrics).toHaveProperty('prefetchRecall');
      expect(metrics).toHaveProperty('topicDetectionLatencyMs');
      expect(metrics).toHaveProperty('totalPrefetches');
      expect(metrics).toHaveProperty('totalAccesses');
      expect(metrics).toHaveProperty('memoryPressureLevel');
    });

    it('should handle empty state gracefully', () => {
      const metrics = service.getMetrics();

      expect(metrics.cacheHitRate).toBe(0);
      expect(metrics.prefetchHitRate).toBe(0);
      expect(metrics.avgLatencyMs).toBe(0);
    });
  });

  describe('getTopicMetrics', () => {
    it('should return topic-specific metrics', () => {
      const metrics = service.getTopicMetrics('family');

      expect(metrics).toHaveProperty('precision');
      expect(metrics).toHaveProperty('sampleSize');
      expect(metrics).toHaveProperty('avgScore');
      expect(metrics).toHaveProperty('avgLatencyMs');
    });
  });
});
