import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PgVectorProvider } from './providers/pgvector.provider';
import { PineconeProvider } from './providers/pinecone.provider';
import {
  VectorProvider,
  VectorRecord,
  VectorSearchResult,
  VectorSearchOptions,
} from './vector.interface';

/**
 * Vector Storage Service
 *
 * Manages vector providers and routes to the configured one.
 * Default: pgvector (local, free)
 * Alternative: Pinecone (cloud, scales to billions)
 */
@Injectable()
export class VectorService {
  private readonly logger = new Logger(VectorService.name);
  private provider: VectorProvider;
  private providers: Map<string, VectorProvider> = new Map();

  constructor(
    private config: ConfigService,
    private pgvector: PgVectorProvider,
    private pinecone: PineconeProvider,
  ) {
    // Register providers
    this.providers.set('pgvector', pgvector);
    this.providers.set('pinecone', pinecone);

    // Select provider based on config (default: pgvector)
    const providerName =
      this.config.get<string>('VECTOR_PROVIDER') || 'pgvector';
    this.provider = this.providers.get(providerName) || pgvector;

    // If configured provider isn't available, fall back to pgvector
    if (!this.provider.isConfigured()) {
      this.logger.warn(
        `Vector provider '${providerName}' not configured, falling back to pgvector`,
      );
      this.provider = pgvector;
    }

    this.logger.log(`Vector storage: ${this.provider.name}`);
  }

  /**
   * Get current provider name
   */
  getProviderName(): string {
    return this.provider.name;
  }

  /**
   * Store a vector
   */
  async upsert(record: VectorRecord): Promise<void> {
    return this.provider.upsert(record);
  }

  /**
   * Store multiple vectors
   */
  async upsertMany(records: VectorRecord[]): Promise<void> {
    return this.provider.upsertMany(records);
  }

  /**
   * Search for similar vectors
   */
  async search(
    embedding: number[],
    options: VectorSearchOptions,
  ): Promise<VectorSearchResult[]> {
    return this.provider.search(embedding, options);
  }

  /**
   * Delete a vector by ID
   */
  async delete(id: string): Promise<void> {
    return this.provider.delete(id);
  }

  /**
   * Delete all vectors for a user
   */
  async deleteByUser(userId: string): Promise<void> {
    return this.provider.deleteByUser(userId);
  }

  /**
   * List available providers
   */
  listProviders(): { name: string; configured: boolean }[] {
    return Array.from(this.providers.entries()).map(([name, provider]) => ({
      name,
      configured: provider.isConfigured(),
    }));
  }
}
