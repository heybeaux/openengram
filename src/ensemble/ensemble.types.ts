/**
 * Ensemble Retrieval Types
 * 
 * Multi-model embedding and RRF fusion types for improved memory retrieval.
 */

/**
 * Supported embedding models
 */
export type ModelId = 'bge-base' | 'minilm';

/**
 * Model configuration
 */
export interface ModelConfig {
  id: ModelId;
  dimensions: number;
  namespace: string;  // Pinecone namespace for this model
  weight: number;     // Fusion weight (default 1.0)
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
  },
  'minilm': {
    id: 'minilm',
    dimensions: 384,
    namespace: 'minilm',
    weight: 1.0,
  },
};

/**
 * Result from a single model query
 */
export interface ModelSearchResult {
  memoryId: string;
  model: ModelId;
  rank: number;       // 1-indexed position in results
  score: number;      // Raw similarity score (0-1)
}

/**
 * Fused result after RRF
 */
export interface FusedResult {
  memoryId: string;
  rrfScore: number;
  modelScores: Map<ModelId, { rank: number; score: number }>;
  appearsInModels: number;  // Consensus count
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
}

/**
 * Ensemble query options
 */
export interface EnsembleQueryOptions {
  query: string;
  userId: string;
  limit?: number;
  k?: number;          // RRF constant (default 60)
  weights?: Partial<Record<ModelId, number>>;
  models?: ModelId[];  // Specific models to query (default: all)
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
  metadata?: Record<string, any>;
}

/**
 * Ensemble configuration
 */
export interface EnsembleConfig {
  enabled: boolean;
  models: ModelId[];
  weights: Record<ModelId, number>;
  rrfK: number;  // RRF constant
  localEmbedUrl: string;
}
