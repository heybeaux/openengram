import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmbeddingProvider } from './embedding-provider.interface';
import { OpenAIEmbeddingProvider, CohereEmbeddingProvider } from './providers';
import {
  ModelId,
  EmbeddingResult,
  MultiEmbedResponse,
  EmbedError,
} from '../ensemble/ensemble.types';

export interface CloudModel {
  modelId: ModelId;
  provider: EmbeddingProvider;
}

/**
 * Cloud Ensemble Service
 *
 * Manages cloud-based embedding providers (OpenAI, Cohere) for the
 * ensemble system. Drop-in replacement for the local engram-embed
 * server when running in the cloud.
 *
 * Activated when EMBEDDING_PROVIDER=cloud-ensemble or when
 * OPENAI_API_KEY is set and local embed server is unreachable.
 */
@Injectable()
export class CloudEnsembleService implements OnModuleInit {
  private readonly logger = new Logger(CloudEnsembleService.name);
  private models: CloudModel[] = [];
  private initialized = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const provider = this.configService.get<string>(
      'EMBEDDING_PROVIDER',
      'local',
    );
    if (provider !== 'cloud-ensemble') return;

    await this.initialize();
  }

  /**
   * Initialize cloud providers based on available API keys
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const openaiKey = this.configService.get<string>('OPENAI_API_KEY', '');
    const cohereKey = this.configService.get<string>('COHERE_API_KEY', '');

    if (!openaiKey) {
      this.logger.warn(
        'Cloud ensemble requires OPENAI_API_KEY — no cloud models available',
      );
      return;
    }

    // Register OpenAI models
    this.models.push({
      modelId: 'openai-small',
      provider: new OpenAIEmbeddingProvider({
        apiKey: openaiKey,
        model: 'text-embedding-3-small',
        dimensions: 1536,
        name: 'openai-small',
      }),
    });

    this.models.push({
      modelId: 'openai-large',
      provider: new OpenAIEmbeddingProvider({
        apiKey: openaiKey,
        model: 'text-embedding-3-large',
        dimensions: 3072,
        name: 'openai-large',
      }),
    });

    // Register Cohere if API key is available
    if (cohereKey) {
      this.models.push({
        modelId: 'cohere-v3',
        provider: new CohereEmbeddingProvider(cohereKey),
      });
    }

    this.initialized = true;

    const modelNames = this.models.map((m) => m.modelId).join(', ');
    this.logger.log(
      `Cloud ensemble initialized with ${this.models.length} models: ${modelNames}`,
    );
  }

  /**
   * Check if cloud ensemble is available
   */
  isAvailable(): boolean {
    return this.initialized && this.models.length > 0;
  }

  /**
   * Get active cloud model IDs
   */
  getModelIds(): ModelId[] {
    return this.models.map((m) => m.modelId);
  }

  /**
   * Get a specific cloud model provider
   */
  getProvider(modelId: ModelId): EmbeddingProvider | undefined {
    return this.models.find((m) => m.modelId === modelId)?.provider;
  }

  /**
   * Generate embeddings for text using all cloud models
   * Compatible with EnsembleService.embedAll() response format
   */
  async embedAll(
    text: string,
    mode: 'document' | 'query' = 'document',
  ): Promise<MultiEmbedResponse> {
    const start = Date.now();
    const embeddings: EmbeddingResult[] = [];
    const errors: EmbedError[] = [];

    // Set Cohere input type before embedding
    for (const { provider } of this.models) {
      if (provider instanceof CohereEmbeddingProvider) {
        provider.setInputType(
          mode === 'query' ? 'search_query' : 'search_document',
        );
      }
    }

    // Embed in parallel across all models
    const results = await Promise.allSettled(
      this.models.map(async ({ modelId, provider }) => {
        const modelStart = Date.now();
        const vectors = await provider.embed([text]);
        return {
          model: modelId,
          dimensions: provider.getDimensions(),
          embedding: vectors[0],
          latencyMs: Date.now() - modelStart,
        } as EmbeddingResult;
      }),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        embeddings.push(result.value);
      } else {
        const modelId = this.models[i].modelId;
        this.logger.error(
          `Cloud embed failed for ${modelId}: ${result.reason}`,
        );
        errors.push({
          model: modelId,
          error: result.reason?.message ?? String(result.reason),
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
   * Generate embeddings for a batch of texts with specific models
   */
  async embedBatch(
    texts: string[],
    models: ModelId[],
    mode: 'document' | 'query' = 'document',
  ): Promise<MultiEmbedResponse> {
    const start = Date.now();
    const embeddings: EmbeddingResult[] = [];
    const errors: EmbedError[] = [];

    const targetModels = this.models.filter((m) => models.includes(m.modelId));

    // Set Cohere input type
    for (const { provider } of targetModels) {
      if (provider instanceof CohereEmbeddingProvider) {
        provider.setInputType(
          mode === 'query' ? 'search_query' : 'search_document',
        );
      }
    }

    const results = await Promise.allSettled(
      targetModels.map(async ({ modelId, provider }) => {
        const modelStart = Date.now();
        const vectors = await provider.embed(texts);
        return vectors.map((embedding) => ({
          model: modelId,
          dimensions: provider.getDimensions(),
          embedding,
          latencyMs: Date.now() - modelStart,
        })) as EmbeddingResult[];
      }),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        embeddings.push(...result.value);
      } else {
        const modelId = targetModels[i].modelId;
        this.logger.error(
          `Cloud batch embed failed for ${modelId}: ${result.reason}`,
        );
        errors.push({
          model: modelId,
          error: result.reason?.message ?? String(result.reason),
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
}
