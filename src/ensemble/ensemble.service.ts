/**
 * Ensemble Service
 * 
 * Manages multi-model embedding and retrieval with RRF fusion.
 * 
 * Key features:
 * - Dual embedding: bge-base (768-dim) + minilm (384-dim)
 * - Parallel vector queries across model namespaces
 * - Reciprocal Rank Fusion for result combination
 * - Feature-flagged for gradual rollout
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pinecone, Index } from '@pinecone-database/pinecone';
import {
  ModelId,
  ModelConfig,
  MODEL_CONFIGS,
  ModelSearchResult,
  FusedResult,
  EmbeddingResult,
  MultiEmbedResponse,
  EnsembleQueryOptions,
  EnsembleQueryResult,
  EnsembleUpsertOptions,
  EnsembleConfig,
} from './ensemble.types';

@Injectable()
export class EnsembleService implements OnModuleInit {
  private readonly logger = new Logger(EnsembleService.name);
  private config: EnsembleConfig;
  private pinecone: Pinecone | null = null;
  private indexes: Map<number, Index> = new Map(); // dimension -> index

  constructor(private configService: ConfigService) {
    // Load configuration
    this.config = {
      enabled: this.configService.get<boolean>('ENSEMBLE_ENABLED', false),
      models: ['bge-base', 'minilm'] as ModelId[],
      weights: { 'bge-base': 1.0, 'minilm': 1.0 },
      rrfK: 60,
      localEmbedUrl: this.configService.get<string>('LOCAL_EMBED_URL', 'http://127.0.0.1:8080'),
    };
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.log('Ensemble retrieval is disabled');
      return;
    }

    const apiKey = this.configService.get<string>('PINECONE_API_KEY');
    if (!apiKey) {
      this.logger.warn('Pinecone API key not configured, ensemble disabled');
      this.config.enabled = false;
      return;
    }

    this.pinecone = new Pinecone({ apiKey });

    // Get index references (we use namespaces within indexes grouped by dimension)
    const index768 = this.configService.get<string>('PINECONE_INDEX_768', 'engram-768');
    const index384 = this.configService.get<string>('PINECONE_INDEX_384', 'engram-384');

    try {
      this.indexes.set(768, this.pinecone.index(index768));
      this.indexes.set(384, this.pinecone.index(index384));
      this.logger.log(`Ensemble initialized with indexes: ${index768}, ${index384}`);
    } catch (error) {
      this.logger.error('Failed to initialize Pinecone indexes for ensemble', error);
      this.config.enabled = false;
    }
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
   * Upsert memory embeddings to all model namespaces
   */
  async upsert(options: EnsembleUpsertOptions): Promise<void> {
    if (!this.config.enabled || !this.pinecone) {
      this.logger.debug('Ensemble disabled, skipping upsert');
      return;
    }

    // Generate embeddings from all models
    const { embeddings } = await this.embedAll(options.content);

    // Upsert to appropriate namespaces
    for (const embResult of embeddings) {
      const modelConfig = MODEL_CONFIGS[embResult.model];
      const index = this.indexes.get(modelConfig.dimensions);

      if (!index) {
        this.logger.warn(`No index for dimension ${modelConfig.dimensions}`);
        continue;
      }

      const namespace = index.namespace(modelConfig.namespace);
      await namespace.upsert({
        records: [
          {
            id: options.memoryId,
            values: embResult.embedding,
            metadata: {
              userId: options.userId,
              model: embResult.model,
              ...options.metadata,
            },
          },
        ],
      });
    }

    this.logger.debug(`Upserted ${embeddings.length} embeddings for memory ${options.memoryId}`);
  }

  /**
   * Query all model namespaces and fuse results with RRF
   */
  async query(options: EnsembleQueryOptions): Promise<EnsembleQueryResult> {
    const start = Date.now();

    if (!this.config.enabled || !this.pinecone) {
      throw new Error('Ensemble is not enabled');
    }

    const models = options.models ?? this.config.models;
    const limit = options.limit ?? 10;
    const topKPerModel = Math.ceil(limit * 2.5); // Fetch more for fusion
    const k = options.k ?? this.config.rrfK;

    // Generate query embeddings
    const { embeddings } = await this.embedAll(options.query);
    const embeddingMap = new Map(embeddings.map(e => [e.model, e]));

    // Query each model namespace in parallel
    const modelResults = new Map<ModelId, ModelSearchResult[]>();

    await Promise.all(
      models.map(async (modelId) => {
        const embedding = embeddingMap.get(modelId);
        if (!embedding) {
          this.logger.warn(`No embedding for model ${modelId}`);
          return;
        }

        const modelConfig = MODEL_CONFIGS[modelId];
        const index = this.indexes.get(modelConfig.dimensions);
        if (!index) return;

        const namespace = index.namespace(modelConfig.namespace);

        try {
          const results = await namespace.query({
            vector: embedding.embedding,
            topK: topKPerModel,
            filter: { userId: { $eq: options.userId } },
            includeMetadata: true,
          });

          const ranked: ModelSearchResult[] = (results.matches ?? []).map((match, idx) => ({
            memoryId: match.id,
            model: modelId,
            rank: idx + 1,
            score: match.score ?? 0,
          }));

          modelResults.set(modelId, ranked);
        } catch (error) {
          this.logger.error(`Query failed for model ${modelId}`, error);
        }
      })
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
    weights: Record<ModelId, number> = { 'bge-base': 1.0, 'minilm': 1.0 },
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

    // Sort by RRF score descending
    return Array.from(fusedScores.values()).sort((a, b) => b.rrfScore - a.rrfScore);
  }

  /**
   * Delete embeddings for a memory from all namespaces
   */
  async delete(memoryId: string): Promise<void> {
    if (!this.config.enabled || !this.pinecone) return;

    for (const model of this.config.models) {
      const modelConfig = MODEL_CONFIGS[model];
      const index = this.indexes.get(modelConfig.dimensions);
      if (!index) continue;

      const namespace = index.namespace(modelConfig.namespace);
      try {
        await namespace.deleteOne({ id: memoryId });
      } catch (error) {
        this.logger.error(`Failed to delete ${memoryId} from ${model}`, error);
      }
    }
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

    // Individual model results are already computed, extract them
    const singleModel = new Map<ModelId, ModelSearchResult[]>();

    // Re-query each model to get raw results
    const { embeddings } = await this.embedAll(query);
    const embeddingMap = new Map(embeddings.map(e => [e.model, e]));

    for (const modelId of this.config.models) {
      const embedding = embeddingMap.get(modelId);
      if (!embedding) continue;

      const modelConfig = MODEL_CONFIGS[modelId];
      const index = this.indexes.get(modelConfig.dimensions);
      if (!index) continue;

      const namespace = index.namespace(modelConfig.namespace);
      const results = await namespace.query({
        vector: embedding.embedding,
        topK: limit,
        filter: { userId: { $eq: userId } },
        includeMetadata: true,
      });

      singleModel.set(
        modelId,
        (results.matches ?? []).map((match, idx) => ({
          memoryId: match.id,
          model: modelId,
          rank: idx + 1,
          score: match.score ?? 0,
        }))
      );
    }

    return { ensemble, singleModel };
  }
}
