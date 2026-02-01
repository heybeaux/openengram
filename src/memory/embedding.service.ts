import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pinecone } from '@pinecone-database/pinecone';
import { MemoryLayer } from '@prisma/client';
import { LLMService } from '../llm/llm.service';

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata?: Record<string, any>;
}

/**
 * Handles embedding generation and vector storage (Pinecone)
 * Uses LLM service for embedding generation
 */
@Injectable()
export class EmbeddingService {
  private pinecone: Pinecone | null = null;
  private indexName: string;
  private dimensions: number = 1536; // Default for OpenAI text-embedding-3-small

  constructor(
    private config: ConfigService,
    private llm: LLMService,
  ) {
    const apiKey = this.config.get<string>('PINECONE_API_KEY');
    
    if (apiKey) {
      this.pinecone = new Pinecone({ apiKey });
    }
    
    this.indexName = this.config.get<string>('PINECONE_INDEX') || 'engram';
  }

  /**
   * Generate embedding for text using configured LLM provider
   */
  async generate(text: string): Promise<number[]> {
    const result = await this.llm.embed(text);
    this.dimensions = result.dimensions;
    return result.embedding;
  }

  /**
   * Store embedding in Pinecone
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
    if (!this.pinecone) {
      console.warn('Pinecone not configured - embedding not stored');
      return memoryId;
    }

    const index = this.pinecone.index(this.indexName);

    await index.upsert([
      {
        id: memoryId,
        values: embedding,
        metadata: {
          userId: metadata?.userId || '',
          layer: metadata?.layer || MemoryLayer.SESSION,
          projectId: metadata?.projectId || '',
          importance: metadata?.importance || 0.5,
          createdAt: metadata?.createdAt?.toISOString() || new Date().toISOString(),
        },
      },
    ]);

    return memoryId;
  }

  /**
   * Search for similar embeddings in Pinecone
   */
  async search(
    userId: string,
    queryEmbedding: number[],
    limit: number = 10,
    layers?: MemoryLayer[],
    projectId?: string,
  ): Promise<VectorSearchResult[]> {
    if (!this.pinecone) {
      console.warn('Pinecone not configured - returning empty results');
      return [];
    }

    const index = this.pinecone.index(this.indexName);

    // Build filter
    const filter: Record<string, any> = { userId: { $eq: userId } };
    
    if (layers && layers.length > 0) {
      filter.layer = { $in: layers };
    }
    
    if (projectId) {
      filter.projectId = { $eq: projectId };
    }

    const results = await index.query({
      vector: queryEmbedding,
      topK: limit,
      filter,
      includeMetadata: true,
    });

    return (
      results.matches?.map((m) => ({
        id: m.id,
        score: m.score || 0,
        metadata: m.metadata as Record<string, any>,
      })) || []
    );
  }

  /**
   * Update metadata for an existing embedding
   */
  async updateMetadata(
    memoryId: string,
    metadata: Record<string, any>,
  ): Promise<void> {
    if (!this.pinecone) return;

    const index = this.pinecone.index(this.indexName);
    await index.update({
      id: memoryId,
      metadata,
    });
  }

  /**
   * Delete embedding from Pinecone
   */
  async delete(memoryId: string): Promise<void> {
    if (!this.pinecone) return;

    const index = this.pinecone.index(this.indexName);
    await index.deleteOne(memoryId);
  }

  /**
   * Delete all embeddings for a user
   */
  async deleteAllForUser(userId: string): Promise<void> {
    if (!this.pinecone) return;

    const index = this.pinecone.index(this.indexName);
    await index.deleteMany({ userId: { $eq: userId } });
  }

  /**
   * Get embedding dimensions
   */
  getDimensions(): number {
    return this.dimensions;
  }

  /**
   * Check if Pinecone is configured
   */
  isConfigured(): boolean {
    return this.pinecone !== null;
  }
}
