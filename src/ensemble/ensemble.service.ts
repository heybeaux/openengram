/**
 * Ensemble Service
 * 
 * Manages multi-model embedding and retrieval with RRF fusion.
 * Uses pgvector for storage (replaced Pinecone).
 * 
 * Key features:
 * - Multiple models: bge-base (768-dim), nomic (768-dim), minilm (384-dim)
 * - Parallel vector queries across models stored in memory_embeddings table
 * - Reciprocal Rank Fusion for result combination
 * - Feature-flagged for gradual rollout
 * - Support for batch embedding (for nightly re-embed)
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PgVectorEnsembleProvider, EnsembleEmbeddingRecord } from './pgvector-ensemble.provider';
import {
  ModelId,
  ModelConfig,
  MODEL_CONFIGS,
  ALL_MODELS,
  ModelSearchResult,
  FusedResult,
  EmbeddingResult,
  MultiEmbedResponse,
  EnsembleQueryOptions,
  EnsembleQueryResult,
  EnsembleUpsertOptions,
  EnsembleConfig,
  EmbedError,
  ModelInfo,
  CoverageStats,
  MemoryEmbeddingStatus,
  ABTestResult,
} from './ensemble.types';

@Injectable()
export class EnsembleService implements OnModuleInit {
  private readonly logger = new Logger(EnsembleService.name);
  private config: EnsembleConfig;

  constructor(
    private configService: ConfigService,
    private pgvectorProvider: PgVectorEnsembleProvider,
    private prisma: PrismaService,
  ) {
    // Load configuration
    // Models can be configured via ENSEMBLE_MODELS env var (comma-separated)
    const modelsEnv = this.configService.get<string>('ENSEMBLE_MODELS', 'bge-base,minilm,nomic');
    const models = modelsEnv.split(',').map(m => m.trim()) as ModelId[];
    
    this.config = {
      enabled: this.configService.get<boolean>('ENSEMBLE_ENABLED', false),
      models,
      weights: { 'bge-base': 1.0, nomic: 0.8, 'gte-base': 0.7, 'minilm': 1.0 },
      rrfK: 60,
      localEmbedUrl: this.configService.get<string>('LOCAL_EMBED_URL', 'http://127.0.0.1:8080'),
      consensusBoostEnabled: this.configService.get<boolean>('ENSEMBLE_CONSENSUS_BOOST', true),
      consensusBoostFactor: this.configService.get<number>('ENSEMBLE_CONSENSUS_FACTOR', 0.1),
    };
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.log('Ensemble retrieval is disabled');
      return;
    }

    // pgvector is always available if database is configured
    this.logger.log(`Ensemble initialized with pgvector storage, models: ${this.config.models.join(', ')}`);
  }

  /**
   * Check if ensemble is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get current configuration
   */
  getConfig(): EnsembleConfig {
    return { ...this.config };
  }

  /**
   * Generate embeddings for text using all configured models
   */
  async embedAll(text: string): Promise<MultiEmbedResponse> {
    const start = Date.now();
    const embeddings: EmbeddingResult[] = [];

    // Call local embed server with model="*" for all models
    try {
      const response = await fetch(`${this.config.localEmbedUrl}/v1/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: text,
          model: '*', // Request all models
        }),
      });

      if (!response.ok) {
        throw new Error(`Embed server returned ${response.status}: ${await response.text()}`);
      }

      const data = await response.json();

      // Parse multi-model response
      if (data.embeddings) {
        for (const modelEmbed of data.embeddings) {
          const modelId = modelEmbed.model as ModelId;
          if (modelEmbed.data?.[0]?.embedding) {
            embeddings.push({
              model: modelId,
              dimensions: modelEmbed.dimensions,
              embedding: modelEmbed.data[0].embedding,
              latencyMs: data.timing?.per_model?.[modelId] ?? 0,
            });
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to get embeddings from local server', error);
      throw error;
    }

    return {
      embeddings,
      totalMs: Date.now() - start,
    };
  }

  /**
   * Generate embedding for a specific model
   */
  async embed(text: string, model: ModelId): Promise<EmbeddingResult> {
    const start = Date.now();

    const response = await fetch(`${this.config.localEmbedUrl}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: text,
        model,
      }),
    });

    if (!response.ok) {
      throw new Error(`Embed server returned ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const embedding = data.data?.[0]?.embedding;

    if (!embedding) {
      throw new Error('No embedding in response');
    }

    return {
      model,
      dimensions: MODEL_CONFIGS[model].dimensions,
      embedding,
      latencyMs: Date.now() - start,
    };
  }

  /**
   * Upsert memory embeddings to pgvector memory_embeddings table
   */
  async upsert(options: EnsembleUpsertOptions): Promise<void> {
    if (!this.config.enabled) {
      this.logger.debug('Ensemble disabled, skipping upsert');
      return;
    }

    // Generate embeddings from all models
    const { embeddings } = await this.embedAll(options.content);

    // Prepare records for batch upsert
    const records: EnsembleEmbeddingRecord[] = embeddings.map((embResult) => ({
      memoryId: options.memoryId,
      modelId: embResult.model,
      embedding: embResult.embedding,
      dimensions: embResult.dimensions,
    }));

    // Upsert to pgvector
    await this.pgvectorProvider.upsertEmbeddings(records);

    this.logger.debug(`Upserted ${embeddings.length} embeddings for memory ${options.memoryId}`);
  }

  /**
   * Upsert pre-computed embeddings directly (used by nightly re-embed)
   */
  async upsertEmbeddings(records: EnsembleEmbeddingRecord[]): Promise<void> {
    if (!this.config.enabled) {
      return;
    }
    await this.pgvectorProvider.upsertEmbeddings(records);
  }

  /**
   * Embed specific memories with specific models (fetches content, embeds, stores)
   */
  async embedBatchForMemories(memoryIds: string[], models: ModelId[]): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    // Fetch memories
    const memories = await this.prisma.memory.findMany({
      where: { id: { in: memoryIds } },
      select: { id: true, raw: true, userId: true },
    });

    if (memories.length === 0) return;

    // Generate embeddings - embedBatch returns embeddings grouped by model, then by text index
    const texts = memories.map(m => m.raw);
    const batchResult = await this.embedBatch(texts, models);

    // Group embeddings by model to track text index
    const embeddingsByModel = new Map<ModelId, number[][]>();
    for (const embedding of batchResult.embeddings) {
      if (!embeddingsByModel.has(embedding.model)) {
        embeddingsByModel.set(embedding.model, []);
      }
      embeddingsByModel.get(embedding.model)!.push(embedding.embedding);
    }

    // Convert to records for storage
    const records: EnsembleEmbeddingRecord[] = [];
    for (const [modelId, modelEmbeddings] of embeddingsByModel) {
      for (let i = 0; i < memories.length && i < modelEmbeddings.length; i++) {
        const memory = memories[i];
        const embedding = modelEmbeddings[i];
        if (embedding) {
          records.push({
            memoryId: memory.id,
            modelId,
            embedding,
            dimensions: embedding.length,
          });
        }
      }
    }

    // Store embeddings
    if (records.length > 0) {
      await this.pgvectorProvider.upsertEmbeddings(records);
    }
  }

  /**
   * Query all model namespaces and fuse results with RRF
   */
  async query(options: EnsembleQueryOptions): Promise<EnsembleQueryResult> {
    const start = Date.now();

    if (!this.config.enabled) {
      throw new Error('Ensemble is not enabled');
    }

    const models = options.models ?? this.config.models;
    const limit = options.limit ?? 10;
    const topKPerModel = Math.ceil(limit * 2.5); // Fetch more for fusion
    const k = options.k ?? this.config.rrfK;

    // Generate query embeddings for all models
    const { embeddings } = await this.embedAll(options.query);
    const embeddingMap = new Map(embeddings.map(e => [e.model, e.embedding]));

    // Query each model using pgvector
    const modelResults = await this.pgvectorProvider.queryWithModelEmbeddings(
      embeddingMap,
      options.userId,
      topKPerModel
    );

    // Apply RRF fusion
    const weights = { ...this.config.weights, ...options.weights };
    const fusedResults = this.reciprocalRankFusion(modelResults, k, weights);

    return {
      results: fusedResults.slice(0, limit),
      metadata: {
        queryTimeMs: Date.now() - start,
        modelsQueried: Array.from(modelResults.keys()),
        candidatesEvaluated: fusedResults.length,
        fusionAlgorithm: 'rrf',
      },
    };
  }

  /**
   * Reciprocal Rank Fusion (RRF)
   * 
   * Combines results from multiple models using the formula:
   * RRF_score(d) = Σ weight_m * (1 / (k + rank_m(d)))
   * 
   * @param modelResults Map of model -> ranked results
   * @param k RRF constant (default 60)
   * @param weights Per-model weights
   */
  reciprocalRankFusion(
    modelResults: Map<ModelId, ModelSearchResult[]>,
    k: number = 60,
    weights: Record<ModelId, number> = { 'bge-base': 1.0, nomic: 0.8, 'gte-base': 0.7, 'minilm': 1.0 },
  ): FusedResult[] {
    const fusedScores = new Map<string, FusedResult>();

    for (const [model, results] of modelResults) {
      const weight = weights[model] ?? 1.0;

      for (const result of results) {
        let existing = fusedScores.get(result.memoryId);

        if (!existing) {
          existing = {
            memoryId: result.memoryId,
            rrfScore: 0,
            modelScores: new Map(),
            appearsInModels: 0,
          };
          fusedScores.set(result.memoryId, existing);
        }

        // RRF contribution: weight * (1 / (k + rank))
        const rrfContribution = weight * (1 / (k + result.rank));
        existing.rrfScore += rrfContribution;
        existing.modelScores.set(model, { rank: result.rank, score: result.score });
        existing.appearsInModels++;
      }
    }

    // Apply consensus boost if enabled
    if (this.config.consensusBoostEnabled) {
      const maxModels = modelResults.size;
      for (const result of fusedScores.values()) {
        if (result.appearsInModels > 1) {
          // Boost score based on how many models agree
          const consensusRatio = result.appearsInModels / maxModels;
          result.rrfScore *= (1 + this.config.consensusBoostFactor * consensusRatio);
        }
      }
    }

    // Sort by RRF score descending
    return Array.from(fusedScores.values()).sort((a, b) => b.rrfScore - a.rrfScore);
  }

  /**
   * Delete embeddings for a memory from all models
   */
  async delete(memoryId: string): Promise<void> {
    if (!this.config.enabled) return;
    await this.pgvectorProvider.deleteByMemory(memoryId);
  }

  /**
   * Generate embeddings for a batch of texts with specific models
   * Used by nightly re-embed service
   */
  async embedBatch(
    texts: string[],
    models: ModelId[]
  ): Promise<MultiEmbedResponse> {
    const start = Date.now();
    const embeddings: EmbeddingResult[] = [];
    const errors: EmbedError[] = [];

    try {
      const response = await fetch(`${this.config.localEmbedUrl}/v1/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: texts,
          model: models.length === 1 ? models[0] : '*',
        }),
      });

      if (!response.ok) {
        throw new Error(`Embed server returned ${response.status}: ${await response.text()}`);
      }

      const data = await response.json();

      // Handle multi-model response
      if (data.embeddings) {
        for (const modelEmbed of data.embeddings) {
          const modelId = modelEmbed.model as ModelId;
          if (models.includes(modelId) && modelEmbed.data) {
            // For batch embeddings, we get an array of embeddings
            for (let i = 0; i < modelEmbed.data.length; i++) {
              if (modelEmbed.data[i]?.embedding) {
                embeddings.push({
                  model: modelId,
                  dimensions: modelEmbed.dimensions,
                  embedding: modelEmbed.data[i].embedding,
                  latencyMs: data.timing?.per_model?.[modelId] ?? 0,
                });
              }
            }
          }
        }
      } else if (data.data) {
        // Single model response format
        for (let i = 0; i < data.data.length; i++) {
          if (data.data[i]?.embedding) {
            embeddings.push({
              model: models[0],
              dimensions: data.data[i].embedding.length,
              embedding: data.data[i].embedding,
              latencyMs: Date.now() - start,
            });
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to get batch embeddings', error);
      for (const model of models) {
        errors.push({
          model,
          error: error instanceof Error ? error.message : String(error),
          recoverable: true,
        });
      }
    }

    return {
      embeddings,
      totalMs: Date.now() - start,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Compare ensemble vs single-model retrieval (for debugging/benchmarking)
   */
  async compare(
    query: string,
    userId: string,
    limit: number = 10,
  ): Promise<{
    ensemble: EnsembleQueryResult;
    singleModel: Map<ModelId, ModelSearchResult[]>;
  }> {
    // Get ensemble results
    const ensemble = await this.query({ query, userId, limit });

    // Get individual model results
    const { embeddings } = await this.embedAll(query);
    const embeddingMap = new Map(embeddings.map(e => [e.model, e.embedding]));

    const singleModel = await this.pgvectorProvider.queryWithModelEmbeddings(
      embeddingMap,
      userId,
      limit
    );

    return { ensemble, singleModel };
  }

  /**
   * Get embedding counts by model (useful for monitoring)
   */
  async getEmbeddingStats(): Promise<Record<ModelId, number>> {
    return this.pgvectorProvider.getEmbeddingCountByModel();
  }

  /**
   * Get existing embedding for drift detection
   */
  async getExistingEmbedding(memoryId: string, modelId: ModelId): Promise<number[] | null> {
    return this.pgvectorProvider.getExistingEmbedding(memoryId, modelId);
  }

  /**
   * Get memories missing embeddings for specified models
   */
  async getMemoriesMissingEmbeddings(
    userId: string,
    models?: ModelId[],
    limit?: number
  ): Promise<string[]> {
    const targetModels = models ?? this.config.models;
    return this.pgvectorProvider.getMemoriesMissingEmbeddings(userId, targetModels, limit);
  }

  /**
   * Get all registered models with their status, dimensions, weights, and quality scores
   */
  async getModels(): Promise<ModelInfo[]> {
    // Get counts per model
    const counts = await this.pgvectorProvider.getEmbeddingCountByModel();
    
    // Get model configs from database if available, otherwise use defaults
    const modelConfigs = await this.pgvectorProvider.getModelConfigs();
    
    const models: ModelInfo[] = [];
    
    for (const modelId of ALL_MODELS) {
      const config = MODEL_CONFIGS[modelId];
      const dbConfig = modelConfigs.find(m => m.modelId === modelId);
      
      models.push({
        modelId,
        status: dbConfig?.status ?? (this.config.models.includes(modelId) ? 'active' : 'disabled'),
        dimensions: config.dimensions,
        weight: dbConfig?.weight ?? this.config.weights[modelId] ?? 1.0,
        embeddingCount: counts[modelId] ?? 0,
        qualityMetrics: dbConfig?.qualityMetrics ?? null,
        addedAt: dbConfig?.addedAt ?? null,
        promotedAt: dbConfig?.promotedAt ?? null,
      });
    }
    
    return models;
  }

  /**
   * Get embedding coverage statistics
   */
  async getCoverage(): Promise<CoverageStats> {
    return this.pgvectorProvider.getCoverageStats(this.config.models);
  }

  /**
   * Get embeddings status for a specific memory
   */
  async getMemoryEmbeddings(memoryId: string): Promise<MemoryEmbeddingStatus[]> {
    return this.pgvectorProvider.getMemoryEmbeddingStatus(memoryId);
  }

  /**
   * Get A/B test results
   */
  async getABTestResults(testId?: string, limit?: number): Promise<ABTestResult[]> {
    return this.pgvectorProvider.getABTestResults(testId, limit);
  }
}
