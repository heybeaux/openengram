import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pinecone } from '@pinecone-database/pinecone';
import { MemoryLayer } from '@prisma/client';

export interface VectorSearchResult {
  id: string;
  score: number;
}

/**
 * Handles embedding generation and vector storage (Pinecone)
 */
@Injectable()
export class EmbeddingService {
  private pinecone: Pinecone;
  private indexName: string;

  constructor(private config: ConfigService) {
    this.pinecone = new Pinecone({
      apiKey: this.config.get<string>('PINECONE_API_KEY') || '',
    });
    this.indexName = this.config.get<string>('PINECONE_INDEX') || 'engram';
  }

  /**
   * Generate embedding for text
   * 
   * In production, this would call an embedding API (OpenAI, Cohere, etc.)
   */
  async generate(text: string): Promise<number[]> {
    // TODO: Implement actual embedding generation
    // 
    // Options:
    // - OpenAI text-embedding-3-small (1536 dims)
    // - Cohere embed-english-v3.0 (1024 dims)
    // - Nomic nomic-embed-text-v1.5 (768 dims, open source)
    // - BGE-large (1024 dims, open source)
    
    // For now, return a stub embedding (random vector)
    // This allows the rest of the system to work during development
    const dims = 1536; // OpenAI embedding dimension
    const embedding = Array.from(
      { length: dims },
      () => Math.random() * 2 - 1,
    );
    
    return embedding;
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
    },
  ): Promise<string> {
    const index = this.pinecone.index(this.indexName);
    
    await index.upsert([
      {
        id: memoryId,
        values: embedding,
        metadata: {
          userId: metadata?.userId || '',
          layer: metadata?.layer || MemoryLayer.SESSION,
          projectId: metadata?.projectId || '',
        },
      },
    ]);

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
  ): Promise<VectorSearchResult[]> {
    const index = this.pinecone.index(this.indexName);

    // Build filter
    const filter: Record<string, any> = { userId };
    if (layers && layers.length > 0) {
      filter.layer = { $in: layers };
    }

    const results = await index.query({
      vector: queryEmbedding,
      topK: limit,
      filter,
      includeMetadata: false,
    });

    return results.matches?.map((m) => ({
      id: m.id,
      score: m.score || 0,
    })) || [];
  }

  /**
   * Delete embedding from Pinecone
   */
  async delete(memoryId: string): Promise<void> {
    const index = this.pinecone.index(this.indexName);
    await index.deleteOne(memoryId);
  }

  /**
   * Delete all embeddings for a user
   */
  async deleteAll(userId: string): Promise<void> {
    const index = this.pinecone.index(this.indexName);
    await index.deleteMany({ userId });
  }
}
