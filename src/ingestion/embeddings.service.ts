/**
 * Embeddings Service
 * Calls engram-embed at http://127.0.0.1:8080/v1/embeddings
 * Supports multiple models for ensemble search
 */

import { ProcessedChunk, ChunkWithEmbedding, EmbeddingResponse } from './types';

const ENGRAM_EMBED_URL = process.env.ENGRAM_EMBED_URL || 'http://127.0.0.1:8080';
const DEFAULT_BATCH_SIZE = 32;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

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
    batchSize: 32, // 512 tokens × 32 = 16K tokens/batch
  },
  nomic: {
    name: 'nomic-embed-text-v1.5',
    dimensions: 768,
    maxTokens: 8192,
    columnName: 'embedding_nomic',
    description: 'Best for full classes, long methods (8K context)',
    batchSize: 4, // 8192 tokens × 4 = 32K tokens/batch (reduced for performance)
  },
  'gte-base': {
    name: 'gte-base-en-v1.5',
    dimensions: 768,
    maxTokens: 512,
    columnName: 'embedding_gte',
    description: 'Alternative semantic space',
    batchSize: 32,
  },
  minilm: {
    name: 'all-MiniLM-L6-v2',
    dimensions: 384,
    maxTokens: 256,
    columnName: 'embedding_minilm',
    description: 'Fast, lightweight',
    batchSize: 64, // Small model, can handle larger batches
  },
} as const;

export type EmbeddingModelId = keyof typeof EMBEDDING_MODELS;

export interface EmbeddingsOptions {
  baseUrl?: string;
  batchSize?: number;
  models?: EmbeddingModelId[];
  onProgress?: (completed: number, total: number) => void;
}

export interface ChunkWithMultiEmbedding extends ProcessedChunk {
  embedding: number[];
  embeddings: Record<EmbeddingModelId, number[]>;
}

/**
 * Generate embeddings for a list of processed chunks using multiple models
 */
export async function generateEmbeddings(
  chunks: ProcessedChunk[],
  options: EmbeddingsOptions = {}
): Promise<ChunkWithMultiEmbedding[]> {
  const {
    baseUrl = ENGRAM_EMBED_URL,
    batchSize = DEFAULT_BATCH_SIZE,
    models = ['bge-base'], // Default: bge-base only (nomic requires separate model download)
    onProgress,
  } = options;

  // Initialize result chunks with empty embeddings
  const results: ChunkWithMultiEmbedding[] = chunks.map((chunk) => ({
    ...chunk,
    embedding: [], // Will be set to bge-base for backward compatibility
    embeddings: {} as Record<EmbeddingModelId, number[]>,
  }));

  const texts = chunks.map((chunk) => chunk.embeddingText);
  // Calculate total operations accounting for model-specific batch sizes
  const totalOperations = models.reduce((sum, modelId) => {
    const modelBatchSize = EMBEDDING_MODELS[modelId].batchSize || batchSize;
    return sum + Math.ceil(chunks.length / modelBatchSize);
  }, 0);
  let completedOperations = 0;

  // Generate embeddings for each model
  for (const modelId of models) {
    const model = EMBEDDING_MODELS[modelId];
    // Use model-specific batch size (falls back to provided batchSize or default)
    const modelBatchSize = model.batchSize || batchSize;
    console.log(`Generating embeddings with ${model.name} (${model.dimensions}-dim)...`);

    const batches = batchArray(texts, modelBatchSize);

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      const embeddings = await embedBatch(batch, baseUrl, model.name);

      // Assign embeddings to the corresponding chunks
      const startIdx = batchIdx * modelBatchSize;
      for (let i = 0; i < embeddings.length; i++) {
        results[startIdx + i].embeddings[modelId] = embeddings[i];

        // Set primary embedding to bge-base for backward compatibility
        if (modelId === 'bge-base') {
          results[startIdx + i].embedding = embeddings[i];
        }
      }

      completedOperations++;
      onProgress?.(completedOperations, totalOperations);
    }
  }

  // If bge-base wasn't in the models list but we need a primary embedding
  // Fall back to the first available model
  for (const result of results) {
    if (result.embedding.length === 0 && models.length > 0) {
      result.embedding = result.embeddings[models[0]] || [];
    }
  }

  return results;
}

/**
 * Generate embeddings for a batch of texts using a specific model
 */
async function embedBatch(
  texts: string[],
  baseUrl: string,
  model: string
): Promise<number[][]> {
  const url = `${baseUrl}/v1/embeddings`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: texts,
          model: model,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Embedding request failed: ${response.status} ${errorText}`);
      }

      const data = (await response.json()) as EmbeddingResponse;

      // Sort by index to ensure correct order
      const sorted = [...data.data].sort((a, b) => a.index - b.index);

      return sorted.map((item) => item.embedding);
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        throw error;
      }
      console.warn(
        `Embedding attempt ${attempt} failed for ${model}, retrying in ${RETRY_DELAY_MS}ms...`
      );
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  throw new Error('Embedding request failed after all retries');
}

/**
 * Generate embedding for a single text with a specific model (for search queries)
 */
export async function embedText(
  text: string,
  modelId: EmbeddingModelId = 'bge-base',
  baseUrl: string = ENGRAM_EMBED_URL
): Promise<number[]> {
  const model = EMBEDDING_MODELS[modelId];
  const results = await embedBatch([text], baseUrl, model.name);
  return results[0];
}

/**
 * Generate embeddings for a query using multiple models
 */
export async function embedQueryMultiModel(
  text: string,
  models: EmbeddingModelId[] = ['bge-base'],
  baseUrl: string = ENGRAM_EMBED_URL
): Promise<Record<EmbeddingModelId, number[]>> {
  const results: Partial<Record<EmbeddingModelId, number[]>> = {};

  for (const modelId of models) {
    const model = EMBEDDING_MODELS[modelId];
    const [embedding] = await embedBatch([text], baseUrl, model.name);
    results[modelId] = embedding;
  }

  return results as Record<EmbeddingModelId, number[]>;
}

/**
 * Check if engram-embed is available and list supported models
 */
export async function checkEmbeddingService(
  baseUrl: string = ENGRAM_EMBED_URL
): Promise<{ available: boolean; models?: string[]; error?: string }> {
  try {
    // Try a simple embedding request
    const response = await fetch(`${baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: 'test',
        model: EMBEDDING_MODELS['bge-base'].name,
      }),
    });

    if (!response.ok) {
      return {
        available: false,
        error: `HTTP ${response.status}`,
      };
    }

    const data = (await response.json()) as EmbeddingResponse;
    return {
      available: true,
      models: Object.keys(EMBEDDING_MODELS),
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Estimate token count for embedding (rough approximation)
 * Most models tokenize ~4 chars per token on average
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split an array into batches
 */
function batchArray<T>(arr: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < arr.length; i += batchSize) {
    batches.push(arr.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get embedding config info
 */
export function getEmbeddingConfig() {
  return {
    url: ENGRAM_EMBED_URL,
    models: EMBEDDING_MODELS,
    defaultModels: ['bge-base'],
  };
}

/**
 * Get model info by ID
 */
export function getModelInfo(modelId: EmbeddingModelId) {
  return EMBEDDING_MODELS[modelId];
}

/**
 * Get column name for a model
 */
export function getModelColumnName(modelId: EmbeddingModelId): string {
  return EMBEDDING_MODELS[modelId].columnName;
}
