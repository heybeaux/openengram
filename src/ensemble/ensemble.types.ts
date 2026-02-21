/**
 * Ensemble Retrieval Types
 *
 * Multi-model embedding and RRF fusion types for improved memory retrieval.
 * Extended with nightly batch re-embedding support.
 */

/**
 * Supported embedding models
 */
export type ModelId =
  | 'bge-base'
  | 'nomic'
  | 'minilm'
  | 'gte-base'
  | 'openai-small'
  | 'openai-large'
  | 'cohere-v3'
  | 'kalm-v2';

/**
 * Model status in the registry
 */
export type ModelStatus = 'active' | 'shadow' | 'deprecated' | 'disabled';

/**
 * Re-embed job mode
 */
export type ReembedMode = 'incremental' | 'full';

/**
 * Re-embed job status
 */
export type ReembedJobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Query type for adaptive fusion
 */
export type QueryType =
  | 'factual'
  | 'conversational'
  | 'temporal'
  | 'entity'
  | 'procedural';

/**
 * Model configuration
 */
export interface ModelConfig {
  id: ModelId;
  dimensions: number;
  namespace: string; // Pinecone namespace for this model
  weight: number; // Fusion weight (default 1.0)
  maxTokens: number;
  queryPrefix?: string;
  documentPrefix?: string;
}

/**
 * Default model configurations
 */
export const MODEL_CONFIGS: Record<ModelId, ModelConfig> = {
  'bge-base': {
    id: 'bge-base',
    dimensions: 768,
    namespace: 'bge-base',
    weight: 1.0,
    maxTokens: 512,
  },
  nomic: {
    id: 'nomic',
    dimensions: 768,
    namespace: 'nomic',
    weight: 1.0,
    maxTokens: 8192,
    queryPrefix: 'search_query: ',
    documentPrefix: 'search_document: ',
  },
  minilm: {
    id: 'minilm',
    dimensions: 384,
    namespace: 'minilm',
    weight: 1.0,
    maxTokens: 256,
  },
  'gte-base': {
    id: 'gte-base',
    dimensions: 768,
    namespace: 'gte-base',
    weight: 1.0,
    maxTokens: 512,
  },
  'openai-small': {
    id: 'openai-small',
    dimensions: 1536,
    namespace: 'openai-small',
    weight: 1.0,
    maxTokens: 8191,
  },
  'openai-large': {
    id: 'openai-large',
    dimensions: 3072,
    namespace: 'openai-large',
    weight: 1.2,
    maxTokens: 8191,
  },
  'cohere-v3': {
    id: 'cohere-v3',
    dimensions: 1024,
    namespace: 'cohere-v3',
    weight: 1.0,
    maxTokens: 512,
    queryPrefix: '',
    documentPrefix: '',
  },
  'kalm-v2': {
    id: 'kalm-v2',
    dimensions: 896,
    namespace: 'kalm-v2',
    weight: 0, // disabled — latency regression (2026-02-21)
    maxTokens: 512,
  },
};

/**
 * All available models
 */
export const ALL_MODELS: ModelId[] = [
  'bge-base',
  'nomic',
  'minilm',
  'gte-base',
  'openai-small',
  'openai-large',
  'cohere-v3',
  'kalm-v2',
];

/**
 * Default active models (MVP)
 */
export const DEFAULT_ACTIVE_MODELS: ModelId[] = [
  'bge-base',
  'minilm',
  'nomic',
  'gte-base',
];

/**
 * Result from a single model query
 */
export interface ModelSearchResult {
  memoryId: string;
  model: ModelId;
  rank: number; // 1-indexed position in results
  score: number; // Raw similarity score (0-1)
}

/**
 * Fused result after RRF
 */
export interface FusedResult {
  memoryId: string;
  rrfScore: number;
  modelScores: Map<ModelId, { rank: number; score: number }>;
  appearsInModels: number; // Consensus count
}

/**
 * Embedding result from engram-embed
 */
export interface EmbeddingResult {
  model: ModelId;
  dimensions: number;
  embedding: number[];
  latencyMs: number;
}

/**
 * Multi-model embedding response
 */
export interface MultiEmbedResponse {
  embeddings: EmbeddingResult[];
  totalMs: number;
  errors?: EmbedError[];
}

/**
 * Embed error details
 */
export interface EmbedError {
  model: ModelId;
  error: string;
  recoverable: boolean;
}

/**
 * Ensemble query options
 */
export interface EnsembleQueryOptions {
  query: string;
  userId: string;
  limit?: number;
  k?: number; // RRF constant (default 60)
  weights?: Partial<Record<ModelId, number>>;
  models?: ModelId[]; // Specific models to query (default: all active)
}

/**
 * Ensemble query result
 */
export interface EnsembleQueryResult {
  results: FusedResult[];
  metadata: {
    queryTimeMs: number;
    modelsQueried: ModelId[];
    candidatesEvaluated: number;
    fusionAlgorithm: string;
  };
}

/**
 * Ensemble upsert options
 */
export interface EnsembleUpsertOptions {
  memoryId: string;
  content: string;
  userId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Ensemble configuration
 */
export interface EnsembleConfig {
  enabled: boolean;
  models: ModelId[];
  weights: Partial<Record<ModelId, number>>;
  rrfK: number; // RRF constant
  localEmbedUrl: string;
  consensusBoostEnabled: boolean;
  consensusBoostFactor: number;
}

/**
 * Scoring weights for final ranking
 */
export interface ScoringWeights {
  semantic: number;
  recency: number;
  importance: number;
  access: number;
  consensus: number;
}

/**
 * Default scoring weights
 */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  semantic: 0.5,
  recency: 0.15,
  importance: 0.2,
  access: 0.05,
  consensus: 0.1,
};

// ============================================================================
// Nightly Re-embedding Types
// ============================================================================

/**
 * Re-embed job configuration
 */
export interface ReembedJobConfig {
  mode: ReembedMode;
  models: ModelId[];
  batchSize: number;
  checkpointInterval: number;
  dryRun?: boolean;
  driftCheck?: boolean;
}

/**
 * Re-embed job progress
 */
export interface ReembedProgress {
  totalMemories: number;
  processedMemories: number;
  currentBatch: number;
  totalBatches: number;
  currentModel: ModelId | null;
}

/**
 * Checkpoint for resumable re-embedding
 */
export interface ReembedCheckpoint {
  jobId: string;
  createdAt: Date;
  lastProcessedId: string;
  progress: ReembedProgress;
  completedModels: ModelId[];
  metrics: Partial<ReembedMetrics>;
}

/**
 * Re-embed job metrics
 */
export interface ReembedMetrics {
  totalDurationMs: number;
  avgBatchDurationMs: number;
  memoriesProcessed: number;
  memoriesSkipped: number;
  memoriesFailed: number;
  perModel: Record<ModelId, ModelMetrics>;
  drift: DriftSummary;
}

/**
 * Per-model metrics
 */
export interface ModelMetrics {
  memoriesProcessed: number;
  totalDurationMs: number;
  avgLatencyMs: number;
  errors: number;
  latencyMs: number[];
}

/**
 * Drift analysis for a single memory/model pair
 */
export interface DriftAnalysis {
  memoryId: string;
  model: ModelId;
  cosineDrift: number;
  oldEmbeddingVersion: string;
  newEmbeddingVersion: string;
  flagged: boolean;
}

/**
 * Summary of drift across a batch
 */
export interface DriftSummary {
  measured: boolean;
  avgCosineDrift: number;
  maxCosineDrift: number;
  memoriesWithHighDrift: number;
  driftThreshold: number;
  byModel: Record<ModelId, { avg: number; max: number; flagged: number }>;
}

/**
 * Re-embed job state
 */
export interface ReembedJobState {
  jobId: string;
  startedAt: Date;
  status: ReembedJobStatus;
  progress: ReembedProgress;
  checkpoint: ReembedCheckpoint | null;
  metrics: ReembedMetrics;
  estimatedCompletion: Date | null;
}

/**
 * Re-embed job result
 */
export interface ReembedJobResult {
  jobId: string;
  status: ReembedJobStatus;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  memoriesProcessed: number;
  memoriesFailed: number;
  avgDrift: number;
  error?: string;
}

// ============================================================================
// Model Registry Types
// ============================================================================

/**
 * Model configuration in registry
 */
export interface ModelRegistryEntry {
  modelId: ModelId;
  status: ModelStatus;
  addedAt: Date;
  promotedAt?: Date;
  deprecatedAt?: Date;
  weight: number;
  queryTypeWeights?: Record<QueryType, number>;
  qualityMetrics: ModelQualityMetrics;
  promotionThresholds: PromotionThresholds;
}

/**
 * Quality metrics for promotion decisions
 */
export interface ModelQualityMetrics {
  sampleQueries: number;
  avgRankContribution: number;
  uniqueHits: number;
  correlationWithGoldStandard: number;
}

/**
 * Thresholds for model promotion
 */
export interface PromotionThresholds {
  minSampleQueries: number;
  minRankContribution: number;
  minCorrelation: number;
}

/**
 * Default promotion thresholds
 */
export const DEFAULT_PROMOTION_THRESHOLDS: PromotionThresholds = {
  minSampleQueries: 1000,
  minRankContribution: 0.15,
  minCorrelation: 0.8,
};

// ============================================================================
// Event-Triggered Re-embedding Types
// ============================================================================

/**
 * Event types that can trigger re-embedding
 */
export type ReembedEventType =
  | 'lesson_created'
  | 'user_correction'
  | 'entity_change'
  | 'importance_upgrade'
  | 'model_added'
  | 'manual';

/**
 * Priority levels for re-embed events
 */
export type ReembedEventPriority = 'high' | 'normal' | 'low';

/**
 * Scope for event-triggered re-embedding
 */
export interface ReembedEventScope {
  memoryIds?: string[];
  searchQuery?: string;
  userId?: string;
  entityIds?: string[];
  memoryTypes?: string[];
}

/**
 * Event that triggers re-embedding
 */
export interface ReembedEvent {
  eventId: string;
  type: ReembedEventType;
  priority: ReembedEventPriority;
  createdAt: Date;
  processedAt?: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  scope: ReembedEventScope;
  triggeredBy: string;
  reason: string;
  error?: string;
}

// ============================================================================
// Embedding Version Types
// ============================================================================

/**
 * Embedding version metadata
 */
export interface EmbeddingVersionInfo {
  versionId: string;
  createdAt: Date;
  createdBy: 'nightly' | 'manual' | 'model-upgrade' | 'event';
  status: 'creating' | 'active' | 'deprecated' | 'deleted';
  memoriesEmbedded: number;
  previousVersion: string | null;
  modelVersions: ModelVersionInfo[];
}

/**
 * Model version within an embedding version
 */
export interface ModelVersionInfo {
  modelId: ModelId;
  modelVersion: string;
  checksum: string;
}

// ============================================================================
// Health & Monitoring Types
// ============================================================================

/**
 * Health status for ensemble service
 */
export interface EnsembleHealth {
  overall: 'healthy' | 'degraded' | 'critical';
  models: Record<ModelId, ModelHealth>;
  pinecone: PineconeHealth;
  lastCheck: Date;
}

/**
 * Health status for individual model
 */
export interface ModelHealth {
  status: 'up' | 'slow' | 'down';
  latencyMs: number;
  errorRate: number;
  lastSuccess: Date | null;
}

/**
 * Health status for Pinecone
 */
export interface PineconeHealth {
  status: 'up' | 'degraded' | 'down';
  indexes: Record<string, IndexHealth>;
}

/**
 * Health status for Pinecone index
 */
export interface IndexHealth {
  status: 'up' | 'down';
  vectorCount: number;
  lastQueryMs: number;
}

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Model info for /ensemble/models endpoint
 */
export interface ModelInfo {
  modelId: ModelId;
  status: ModelStatus;
  dimensions: number;
  weight: number;
  embeddingCount: number;
  qualityMetrics: ModelQualityMetrics | null;
  addedAt: Date | null;
  promotedAt: Date | null;
}

/**
 * Coverage stats for /ensemble/coverage endpoint
 */
export interface CoverageStats {
  totalMemories: number;
  memoriesWithAnyEmbedding: number;
  memoriesWithAllModels: number;
  coveragePercent: number;
  perModel: Record<ModelId, ModelCoverageStats>;
}

/**
 * Per-model coverage statistics
 */
export interface ModelCoverageStats {
  embeddingCount: number;
  coveragePercent: number;
  missingCount: number;
}

/**
 * Memory embedding status for /ensemble/memories/:id/embeddings endpoint
 */
export interface MemoryEmbeddingStatus {
  modelId: ModelId;
  hasEmbedding: boolean;
  dimensions: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/**
 * A/B test result for /ensemble/ab-results endpoint
 */
export interface ABTestResult {
  id: string;
  testId: string;
  config: string;
  queryId: string;
  metrics: Record<string, unknown>;
  timestamp: Date;
}

// ============================================================================
// Fallback Types
// ============================================================================

/**
 * Fallback configuration
 */
export interface FallbackConfig {
  minModelsRequired: number;
  anchorModel: ModelId | null;
  allowPartialResults: boolean;
  modelTimeoutMs: number;
  cacheEnabled: boolean;
  cacheTtlMs: number;
}

/**
 * Default fallback configuration
 */
export const DEFAULT_FALLBACK_CONFIG: FallbackConfig = {
  minModelsRequired: 1,
  anchorModel: 'bge-base',
  allowPartialResults: true,
  modelTimeoutMs: 3000,
  cacheEnabled: true,
  cacheTtlMs: 60000,
};
