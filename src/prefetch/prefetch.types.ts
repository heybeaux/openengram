/**
 * Predictive Pre-fetch Type Definitions
 * 
 * Defines types for topic detection, caching, and metrics
 */

// ============================================================================
// Topic Types
// ============================================================================

/**
 * Topic identifiers - hierarchical topic taxonomy
 */
export type TopicId = 
  // Personal
  | 'family' | 'family/immediate' | 'family/extended' | 'family/pets'
  | 'health' | 'health/physical' | 'health/mental' | 'health/medical'
  | 'preferences' | 'preferences/likes' | 'preferences/dislikes'
  | 'identity' | 'identity/values' | 'identity/background'
  // Professional
  | 'work' | 'work/role' | 'work/colleagues' | 'work/org'
  | 'projects' | 'projects/active' | 'projects/completed'
  | 'technical' | 'technical/skills' | 'technical/tools'
  // Temporal
  | 'schedule' | 'schedule/today' | 'schedule/week' | 'schedule/upcoming'
  | 'history' | 'history/recent' | 'history/archive'
  | 'events' | 'events/meetings' | 'events/deadlines'
  // Meta
  | 'agent' | 'agent/self' | 'agent/learnings'
  | 'conversation'
  // Custom user-defined topics
  | `custom/${string}`;

/**
 * Score for a detected topic
 */
export interface TopicScore {
  topic: TopicId;
  confidence: number;
  source: 'keyword' | 'entity' | 'embedding' | 'merged';
}

/**
 * Result of topic detection
 */
export interface TopicDetectionResult {
  topics: TopicScore[];
  processingTimeMs: number;
  layerBreakdown: {
    keyword: Map<TopicId, number>;
    embedding: Map<TopicId, number>;
  };
}

/**
 * Keyword matching rule for a topic
 */
export interface KeywordRule {
  topic: TopicId;
  patterns: RegExp[];
  weight: number;
  requiresContext?: boolean;
}

/**
 * Topic prototype for embedding-based classification
 */
export interface TopicPrototype {
  topic: TopicId;
  embedding: number[];
  threshold: number;
}

/**
 * Full topic definition with configuration
 */
export interface TopicDefinition {
  id: TopicId;
  parentId?: TopicId;
  name: string;
  description: string;
  keywords: string[];
  prototypeQuery: string;
  prefetchPriority: number;
  defaultMemoryLimit: number;
  decayRate: number;
  relatedTopics: TopicId[];
}

// ============================================================================
// Cache Types
// ============================================================================

/**
 * Memory stored in the warm cache
 */
export interface CachedMemory {
  id: string;
  content: string;
  embedding: number[];
  score: number;
  layer: string;
  cachedAt: number;
  accessCount: number;
  lastAccessedAt: number;
  topics: TopicId[];
  prefetchedFor?: TopicId;
}

/**
 * Result of a cache lookup
 */
export interface CacheLookupResult {
  memories: CachedMemory[];
  hitCount: number;
  missCount: number;
  lookupTimeMs: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  size: number;
  maxSize: number;
  topicCount: number;
  totalAccessCount: number;
  prefetchedCount: number;
  prefetchedUsed: number;
  prefetchPrecision: number;
  hitRate: number;
  missRate: number;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  maxSize: number;
  ttlMs: number;
  topicSlots: number;
  enableMetrics: boolean;
}

// ============================================================================
// Pre-fetch Types
// ============================================================================

/**
 * Request for memory selection for a topic
 */
export interface MemorySelectionRequest {
  topic: TopicScore;
  userId: string;
  limit: number;
  excludeIds: Set<string>;
}

/**
 * Selected memory with scoring info
 */
export interface SelectedMemory {
  id: string;
  score: number;
  source: 'semantic' | 'recency' | 'usage';
}

/**
 * Result of memory selection
 */
export interface MemorySelectionResult {
  memories: SelectedMemory[];
  processingTimeMs: number;
  strategy: 'semantic' | 'hybrid';
}

/**
 * Result of a prefetch operation
 */
export interface PrefetchResult {
  prefetchedCount: number;
  topics: TopicId[];
  timeMs: number;
  cacheHits: number;
  cacheMisses: number;
}

/**
 * Configuration for topic detection
 */
export interface TopicDetectionConfig {
  layerWeights: {
    keyword: number;
    embedding: number;
  };
  minConfidence: number;
  maxTopics: number;
  contextWindowSize: number;
  enableEmbeddingClassification: boolean;
}

/**
 * Configuration for the entire prefetch system
 */
export interface PrefetchConfig {
  cache: CacheConfig;
  detection: TopicDetectionConfig;
  enabled: boolean;
  backgroundPrefetch: boolean;
  maxPrefetchBatchSize: number;
  prefetchDelayMs: number;
}

// ============================================================================
// Metrics Types
// ============================================================================

/**
 * Feedback about a prefetch outcome
 */
export interface PrefetchFeedback {
  prefetchId: string;
  userId: string;
  topic: TopicId;
  memoryId: string;
  prefetchedAt: number;
  wasAccessed: boolean;
  accessedAt?: number;
  accessLatencyMs?: number;
  topicConfidence: number;
  memoryScore: number;
}

/**
 * Precision/recall metrics
 */
export interface PrecisionRecallMetrics {
  precision: number;
  recall: number;
  f1Score: number;
  byTopic: Record<string, {
    precision: number;
    recall: number;
    f1Score: number;
    sampleSize: number;
  }>;
}

/**
 * Overall prefetch metrics
 */
export interface PrefetchMetrics {
  cacheHitRate: number;
  prefetchHitRate: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  prefetchPrecision: number;
  prefetchRecall: number;
  topicDetectionLatencyMs: number;
  totalPrefetches: number;
  totalAccesses: number;
  memoryPressureLevel: 'normal' | 'warning' | 'critical';
}

// ============================================================================
// Integration Types
// ============================================================================

/**
 * Enhanced context result with prefetch info
 */
export interface EnhancedContextResult {
  memories: CachedMemory[];
  fromCache: boolean;
  cacheHits: number;
  cacheMisses: number;
  prefetchTriggered: boolean;
  topics: TopicScore[];
  latencyMs: number;
}

/**
 * Conversation context for topic detection
 */
export interface ConversationContext {
  recentTopics: TopicScore[];
  recentMessages: string[];
  sessionId?: string;
  userId: string;
}

/**
 * Topic shift detection result
 */
export interface TopicShift {
  departedTopics: TopicId[];
  arrivedTopics: TopicId[];
  confidence: number;
}
