/**
 * Prefetch Module
 *
 * Provides predictive pre-fetching capabilities for the Engram memory system.
 * Includes topic detection, warm caching, and metrics tracking.
 */

import { Module, forwardRef } from '@nestjs/common';
import { TopicDetectionService } from './topic-detection.service';
import { PrefetchCacheService } from './prefetch-cache.service';
import { PrefetchMetricsService } from './prefetch-metrics.service';
import { PrefetchService } from './prefetch.service';
import { MemoryModule } from '../memory/memory.module';

@Module({
  imports: [forwardRef(() => MemoryModule)],
  providers: [
    TopicDetectionService,
    PrefetchCacheService,
    PrefetchMetricsService,
    PrefetchService,
  ],
  exports: [
    TopicDetectionService,
    PrefetchCacheService,
    PrefetchMetricsService,
    PrefetchService,
  ],
})
export class PrefetchModule {}
