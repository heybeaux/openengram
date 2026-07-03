/**
 * Prefetch Module Exports
 *
 * Predictive pre-fetching for the Engram memory system
 */

// Types
export * from './prefetch.types';

// Topic Taxonomy
export {
  KEYWORD_RULES,
  TOPIC_DEFINITIONS,
  getTopicDefinition,
  getChildTopics,
  getRelatedTopics,
  getRootTopics,
  getKeywordRulesForTopic,
  getAllTopicIds,
} from './topic-taxonomy';

// Services
export {
  TopicDetectionService,
  DEFAULT_DETECTION_CONFIG,
} from './topic-detection.service';
export {
  PrefetchCacheService,
  DEFAULT_CACHE_CONFIG,
} from './prefetch-cache.service';
export { PrefetchMetricsService } from './prefetch-metrics.service';
export { PrefetchService, DEFAULT_PREFETCH_CONFIG } from './prefetch.service';

// Module
export { PrefetchModule } from './prefetch.module';
