import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pinecone } from '@pinecone-database/pinecone';
import {
  VectorProvider,
  VectorRecord,
  VectorSearchResult,
  VectorSearchOptions,
} from '../vector.interface';

/**
 * Pinecone Provider
 *
 * Cloud-hosted vector database.
 * Use when you need massive scale (100M+ vectors).
 */
@Injectable()
export class PineconeProvider implements VectorProvider {
  private readonly logger = new Logger(PineconeProvider.name);
  readonly name = 'pinecone';

  private client: Pinecone | null = null;
  private indexName: string;

  constructor(private config: ConfigService) {
    const apiKey = this.config.get<string>('PINECONE_API_KEY');

    if (apiKey) {
      this.client = new Pinecone({ apiKey });
    }

    this.indexName = this.config.get<string>('PINECONE_INDEX') || 'engram';
  }

  async upsert(record: VectorRecord): Promise<void> {
    if (!this.client) return;

    const index = this.client.index(this.indexName);
    await index.upsert({
      records: [
        {
          id: record.id,
          values: record.embedding,
          metadata: record.metadata,
        },
      ],
    });
  }

  async upsertMany(records: VectorRecord[]): Promise<void> {
    if (!this.client) return;

    const index = this.client.index(this.indexName);
    await index.upsert({
      records: records.map((r) => ({
        id: r.id,
        values: r.embedding,
        metadata: r.metadata,
      })),
    });
  }

  async search(
    embedding: number[],
    options: VectorSearchOptions,
  ): Promise<VectorSearchResult[]> {
    if (!this.client) return [];

    const index = this.client.index(this.indexName);

    // Build filter
    const filter: Record<string, any> = { userId: { $eq: options.userId } };

    if (options.filter?.layers && options.filter.layers.length > 0) {
      filter.layer = { $in: options.filter.layers };
    }

    if (options.filter?.projectId) {
      filter.projectId = { $eq: options.filter.projectId };
    }

    const results = await index.query({
      vector: embedding,
      topK: options.limit || 10,
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

  async delete(id: string): Promise<void> {
    if (!this.client) return;

    const index = this.client.index(this.indexName);
    await index.deleteOne({ id });
  }

  async deleteByUser(userId: string): Promise<void> {
    if (!this.client) return;

    // Pinecone doesn't support filter-based deletion in all tiers
    // For production, consider namespace-per-user strategy
    this.logger.warn(
      'Pinecone deleteByUser requires namespace-per-user strategy for efficiency',
    );
  }

  isConfigured(): boolean {
    return this.client !== null;
  }
}
