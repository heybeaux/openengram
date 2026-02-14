/**
 * SQLite Storage Provider (Stub)
 *
 * Portable/edge storage provider using SQLite.
 * Basic CRUD is implemented; vector search is stubbed.
 *
 * Vector search approach options for SQLite:
 * 1. sqlite-vss extension (if available) — real vector index
 * 2. Brute-force cosine similarity in JS — works for small datasets (<10k memories)
 * 3. sqlite-vec (newer, simpler API) — promising alternative
 *
 * For now, vector search uses brute-force cosine similarity in JS,
 * which is acceptable for the portable/edge use case (small datasets).
 *
 * TODO: Full SQLite implementation for production edge use
 * - Wire up better-sqlite3 or Prisma SQLite
 * - Implement proper migrations
 * - Add sqlite-vss/sqlite-vec for vector search at scale
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  StorageProvider,
  CreateMemoryData,
  UpdateMemoryData,
  IncrementMemoryData,
  MemoryFilters,
  PaginationOptions,
  MemoryInclude,
  StoredMemory,
  VectorSearchResult,
  VectorSearchOptions,
  BulkUpdateEntry,
  StorageStats,
  CreateMergeCandidateData,
  HealthCheckResult,
} from './storage-provider.interface';

@Injectable()
export class SqliteProvider implements StorageProvider {
  readonly name = 'sqlite';
  private readonly logger = new Logger(SqliteProvider.name);
  private readonly dbPath: string;

  constructor(private readonly configService: ConfigService) {
    this.dbPath = this.configService.get<string>('SQLITE_PATH', './engram.db');
    this.logger.log(`SQLite provider initialized (path: ${this.dbPath})`);
  }

  // ── Memory CRUD ──────────────────────────────────────────────────────

  async createMemory(data: CreateMemoryData): Promise<StoredMemory> {
    // TODO: Implement with better-sqlite3 or Prisma SQLite client
    throw new Error(
      'SQLite provider: createMemory not yet implemented. Configure STORAGE_PROVIDER=prisma-postgres for full functionality.',
    );
  }

  async getMemory(
    id: string,
    include?: MemoryInclude,
  ): Promise<StoredMemory | null> {
    // TODO: Implement — simple SELECT by id
    throw new Error('SQLite provider: getMemory not yet implemented.');
  }

  async updateMemory(
    id: string,
    data: UpdateMemoryData,
  ): Promise<StoredMemory> {
    // TODO: Implement — UPDATE by id
    throw new Error('SQLite provider: updateMemory not yet implemented.');
  }

  async incrementMemory(
    id: string,
    increments: IncrementMemoryData,
    data?: UpdateMemoryData,
  ): Promise<StoredMemory> {
    // TODO: Implement — UPDATE with SET field = field + increment
    throw new Error('SQLite provider: incrementMemory not yet implemented.');
  }

  async deleteMemory(id: string): Promise<void> {
    // TODO: Implement — UPDATE SET deleted_at = NOW()
    throw new Error('SQLite provider: deleteMemory not yet implemented.');
  }

  // ── Queries ──────────────────────────────────────────────────────────

  async findMemories(
    filters: MemoryFilters,
    pagination?: PaginationOptions,
    include?: MemoryInclude,
  ): Promise<StoredMemory[]> {
    // TODO: Implement — SELECT with WHERE clause built from filters
    // Note: include (relations) may need separate queries in SQLite
    throw new Error('SQLite provider: findMemories not yet implemented.');
  }

  async countMemories(filters: MemoryFilters): Promise<number> {
    // TODO: Implement — SELECT COUNT(*) with WHERE
    throw new Error('SQLite provider: countMemories not yet implemented.');
  }

  async updateManyMemories(
    filters: MemoryFilters,
    data: UpdateMemoryData,
  ): Promise<number> {
    // TODO: Implement — UPDATE with WHERE clause
    throw new Error('SQLite provider: updateManyMemories not yet implemented.');
  }

  async incrementManyMemories(
    filters: MemoryFilters,
    increments: IncrementMemoryData,
    data?: UpdateMemoryData,
  ): Promise<number> {
    // TODO: Implement
    throw new Error(
      'SQLite provider: incrementManyMemories not yet implemented.',
    );
  }

  // ── Vector Search ────────────────────────────────────────────────────

  /**
   * Vector search using brute-force cosine similarity.
   *
   * Approach: Load all embeddings for matching memories into JS,
   * compute cosine similarity against the query vector, sort, return top-K.
   *
   * Performance: O(n) where n = number of memories with embeddings.
   * Acceptable for <10k memories (portable/edge use case).
   *
   * For larger datasets, integrate sqlite-vss or sqlite-vec:
   * - sqlite-vss: CREATE VIRTUAL TABLE vss_memories USING vss0(embedding(768))
   * - sqlite-vec: CREATE VIRTUAL TABLE vec_memories USING vec0(embedding float[768])
   *
   * TODO: Implement with actual SQLite queries + JS cosine similarity
   */
  async vectorSearch(
    embedding: number[],
    options: VectorSearchOptions,
  ): Promise<VectorSearchResult[]> {
    // TODO: Implementation outline:
    // 1. Query all memories with embeddings matching filters
    // 2. For each, compute cosine similarity with `embedding`
    // 3. Filter by threshold, sort descending, take limit
    //
    // const cosineSimilarity = (a: number[], b: number[]): number => {
    //   let dot = 0, magA = 0, magB = 0;
    //   for (let i = 0; i < a.length; i++) {
    //     dot += a[i] * b[i];
    //     magA += a[i] * a[i];
    //     magB += b[i] * b[i];
    //   }
    //   return dot / (Math.sqrt(magA) * Math.sqrt(magB));
    // };
    throw new Error(
      'SQLite provider: vectorSearch not yet implemented. See code comments for approach.',
    );
  }

  async getMemoryEmbedding(memoryId: string): Promise<number[] | null> {
    // TODO: Implement — embeddings stored as JSON text in SQLite
    throw new Error('SQLite provider: getMemoryEmbedding not yet implemented.');
  }

  // ── Bulk Operations ──────────────────────────────────────────────────

  async bulkCreate(data: CreateMemoryData[]): Promise<StoredMemory[]> {
    // TODO: Implement — use SQLite transaction for atomicity
    throw new Error('SQLite provider: bulkCreate not yet implemented.');
  }

  async bulkUpdate(updates: BulkUpdateEntry[]): Promise<number> {
    // TODO: Implement — use SQLite transaction
    throw new Error('SQLite provider: bulkUpdate not yet implemented.');
  }

  // ── Stats / Aggregations ─────────────────────────────────────────────

  async getStats(userId?: string): Promise<StorageStats> {
    // TODO: Implement — standard SQL aggregations work in SQLite
    throw new Error('SQLite provider: getStats not yet implemented.');
  }

  async groupBy(
    field: string,
    filters?: MemoryFilters,
  ): Promise<Array<{ value: string; count: number }>> {
    // TODO: Implement — GROUP BY works in SQLite
    throw new Error('SQLite provider: groupBy not yet implemented.');
  }

  async aggregate(
    field: string,
    operation: 'avg' | 'sum' | 'min' | 'max',
    filters?: MemoryFilters,
  ): Promise<number | null> {
    // TODO: Implement — AVG/SUM/MIN/MAX work in SQLite
    throw new Error('SQLite provider: aggregate not yet implemented.');
  }

  // ── Merge / Dedup Support ────────────────────────────────────────────

  async createMergeCandidate(data: CreateMergeCandidateData): Promise<any> {
    // TODO: Implement — simple INSERT
    throw new Error(
      'SQLite provider: createMergeCandidate not yet implemented.',
    );
  }

  // ── Health ───────────────────────────────────────────────────────────

  async healthCheck(): Promise<HealthCheckResult> {
    // TODO: Open SQLite connection and run a simple query
    // For now, just check if the db path is accessible
    const start = Date.now();
    try {
      const fs = await import('fs');
      // Check if db file exists or directory is writable
      const dir =
        this.dbPath.substring(0, this.dbPath.lastIndexOf('/') || 1) || '.';
      fs.accessSync(dir, fs.constants.W_OK);
      return {
        healthy: true,
        latencyMs: Date.now() - start,
        provider: this.name,
        details: {
          path: this.dbPath,
          note: 'stub — only checks directory writability',
        },
      };
    } catch (error: any) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        provider: this.name,
        details: { error: error.message, path: this.dbPath },
      };
    }
  }
}
