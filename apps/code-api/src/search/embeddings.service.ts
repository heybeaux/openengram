import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Service for generating embeddings via engram-embed.
 * Supports multiple models for ensemble search.
 */

interface EmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

/**
 * Supported embedding models with their configurations
 */
export const EMBEDDING_MODELS = {
  'bge-base': {
    name: 'bge-base-en-v1.5',
    dimensions: 768,
    maxTokens: 512,
    columnName: 'embedding_bge',
    description: 'Best for short methods, precise matching',
  },
  nomic: {
    name: 'nomic-embed-text-v1.5',
    dimensions: 768,
    maxTokens: 8192,
    columnName: 'embedding_nomic',
    description: 'Best for full classes, long methods (8K context)',
  },
  'gte-base': {
    name: 'gte-base-en-v1.5',
    dimensions: 768,
    maxTokens: 512,
    columnName: 'embedding_gte',
    description: 'Alternative semantic space',
  },
  minilm: {
    name: 'all-MiniLM-L6-v2',
    dimensions: 384,
    maxTokens: 256,
    columnName: 'embedding_minilm',
    description: 'Fast, lightweight',
  },
} as const;

export type EmbeddingModelId = keyof typeof EMBEDDING_MODELS;

@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>(
      'ENGRAM_EMBED_URL',
      'http://127.0.0.1:8080',
    );
  }

  /**
   * Generate an embedding for a single text input using the default model (bge-base).
   * @param text - The text to embed (query or code content)
   * @returns 768-dimensional embedding vector
   */
  async embed(text: string, modelId: EmbeddingModelId = 'bge-base'): Promise<number[]> {
    const embeddings = await this.embedBatch([text], modelId);
    return embeddings[0];
  }

  /**
   * Generate embeddings for a query using multiple models.
   * Used for ensemble search.
   * @param text - The query text
   * @param models - Array of model IDs to use
   * @returns Map of model ID to embedding vector
   */
  async embedMultiModel(
    text: string,
    models: EmbeddingModelId[] = ['bge-base', 'nomic'],
  ): Promise<Record<EmbeddingModelId, number[]>> {
    const results: Partial<Record<EmbeddingModelId, number[]>> = {};

    // Generate embeddings in parallel for efficiency
    const promises = models.map(async (modelId) => {
      const embedding = await this.embed(text, modelId);
      return { modelId, embedding };
    });

    const resolved = await Promise.all(promises);
    for (const { modelId, embedding } of resolved) {
      results[modelId] = embedding;
    }

    return results as Record<EmbeddingModelId, number[]>;
  }

  /**
   * Generate embeddings for multiple texts in a single request.
   * More efficient for bulk operations like ingestion.
   * @param texts - Array of texts to embed
   * @param modelId - The model to use
   * @returns Array of embedding vectors
   */
  async embedBatch(texts: string[], modelId: EmbeddingModelId = 'bge-base'): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const model = EMBEDDING_MODELS[modelId];
    const url = `${this.baseUrl}/v1/embeddings`;

    this.logger.debug(`Generating ${texts.length} embeddings via ${model.name}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: texts,
          model: model.name,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`engram-embed error: ${response.status} ${errorText}`);
        throw new HttpException(
          `Embedding service error: ${response.status}`,
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      const data: EmbeddingResponse = await response.json();

      // Sort by index to ensure correct order
      const sorted = data.data.sort((a, b) => a.index - b.index);
      const embeddings = sorted.map((d) => d.embedding);

      this.logger.debug(
        `Generated ${embeddings.length} embeddings with ${model.name} (${data.usage.total_tokens} tokens)`,
      );

      return embeddings;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(`Failed to connect to engram-embed for model ${model.name}`, error);
      throw new HttpException(
        'Embedding service unavailable. Is engram-embed running?',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * Prepare text for embedding.
   * Combines chunk metadata with content for better semantic matching.
   */
  prepareChunkText(chunk: {
    chunkType: string;
    name: string;
    content: string;
    parentName?: string;
  }): string {
    const parent = chunk.parentName ? ` in ${chunk.parentName}` : '';
    return `${chunk.chunkType} ${chunk.name}${parent}: ${chunk.content}`;
  }

  /**
   * Check if engram-embed is available.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get column name for a model ID
   */
  getModelColumnName(modelId: EmbeddingModelId): string {
    return EMBEDDING_MODELS[modelId].columnName;
  }

  /**
   * Get available models
   */
  getAvailableModels(): EmbeddingModelId[] {
    return Object.keys(EMBEDDING_MODELS) as EmbeddingModelId[];
  }

  /**
   * Get model info
   */
  getModelInfo(modelId: EmbeddingModelId) {
    return EMBEDDING_MODELS[modelId];
  }
}
