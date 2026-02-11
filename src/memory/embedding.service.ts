import { Injectable } from '@nestjs/common';
import { MemoryLayer } from '@prisma/client';
import { LLMService } from '../llm/llm.service';
import { VectorService } from '../vector/vector.service';

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata?: Record<string, any>;
}

/**
 * Handles embedding generation and vector storage
 * Uses LLM service for embedding generation
 * Uses Vector service for storage (pgvector or Pinecone)
 */
@Injectable()
export class EmbeddingService {
  private dimensions: number = 1536; // Default for OpenAI text-embedding-3-small

  constructor(
    private llm: LLMService,
    private vector: VectorService,
  ) {}

  /**
   * Generate embedding for text using configured LLM provider
   */
  async generate(text: string): Promise<number[]> {
    const result = await this.llm.embed(text);
    this.dimensions = result.dimensions;
    return result.embedding;
  }

  /**
   * Store embedding in vector database
   */
  async store(
    memoryId: string,
    embedding: number[],
    metadata?: {
      userId?: string;
      layer?: MemoryLayer;
      projectId?: string;
      importance?: number;
      createdAt?: Date;
    },
  ): Promise<string> {
    await this.vector.upsert({
      id: memoryId,
      embedding,
      metadata: {
        userId: metadata?.userId || '',
        layer: metadata?.layer || MemoryLayer.SESSION,
        projectId: metadata?.projectId || '',
        importance: metadata?.importance || 0.5,
        createdAt: metadata?.createdAt?.toISOString() || new Date().toISOString(),
      },
    });

    return memoryId;
  }

  /**
   * Search for similar embeddings
   */
  async search(
    userId: string,
    queryEmbedding: number[],
    limit: number = 10,
    layers?: MemoryLayer[],
    projectId?: string,
    poolIds?: string[],
  ): Promise<VectorSearchResult[]> {
    return this.vector.search(queryEmbedding, {
      userId,
      limit,
      filter: {
        layers: layers?.map((l) => l.toString()),
        projectId,
        poolIds,
      },
    });
  }

  /**
   * Delete embedding
   */
  async delete(memoryId: string): Promise<void> {
    await this.vector.delete(memoryId);
  }

  /**
   * Delete all embeddings for a user
   */
  async deleteAllForUser(userId: string): Promise<void> {
    await this.vector.deleteByUser(userId);
  }

  /**
   * Get embedding dimensions
   */
  getDimensions(): number {
    return this.dimensions;
  }

  /**
   * Get current vector provider name
   */
  getProviderName(): string {
    return this.vector.getProviderName();
  }
}
