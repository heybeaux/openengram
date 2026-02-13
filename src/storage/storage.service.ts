/**
 * Storage Service
 *
 * Facade that delegates to the configured storage provider.
 * Selected via STORAGE_PROVIDER env var (default: 'prisma-postgres').
 *
 * Follows the same pattern as EmbeddingService.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPostgresProvider } from './prisma-postgres.provider';
import { SqliteProvider } from './sqlite.provider';
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
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private provider: StorageProvider;

  constructor(
    private configService: ConfigService,
    private prismaPostgresProvider: PrismaPostgresProvider,
    private sqliteProvider: SqliteProvider,
  ) {
    const providerName = this.configService.get<string>(
      'STORAGE_PROVIDER',
      'prisma-postgres',
    );
    this.provider = this.resolveProvider(providerName);
  }

  async onModuleInit(): Promise<void> {
    this.logger.log(`Storage provider: ${this.provider.name}`);
    const health = await this.provider.healthCheck();
    if (health.healthy) {
      this.logger.log(`Storage health: OK (${health.latencyMs}ms)`);
    } else {
      this.logger.warn(`Storage health: UNHEALTHY`, health.details);
    }
  }

  // ── Provider Info ────────────────────────────────────────────────────

  getProviderName(): string {
    return this.provider.name;
  }

  getProvider(): StorageProvider {
    return this.provider;
  }

  // ── Delegated Methods ────────────────────────────────────────────────

  createMemory(data: CreateMemoryData): Promise<StoredMemory> {
    return this.provider.createMemory(data);
  }

  getMemory(id: string, include?: MemoryInclude): Promise<StoredMemory | null> {
    return this.provider.getMemory(id, include);
  }

  updateMemory(id: string, data: UpdateMemoryData): Promise<StoredMemory> {
    return this.provider.updateMemory(id, data);
  }

  incrementMemory(id: string, increments: IncrementMemoryData, data?: UpdateMemoryData): Promise<StoredMemory> {
    return this.provider.incrementMemory(id, increments, data);
  }

  deleteMemory(id: string): Promise<void> {
    return this.provider.deleteMemory(id);
  }

  findMemories(
    filters: MemoryFilters,
    pagination?: PaginationOptions,
    include?: MemoryInclude,
  ): Promise<StoredMemory[]> {
    return this.provider.findMemories(filters, pagination, include);
  }

  countMemories(filters: MemoryFilters): Promise<number> {
    return this.provider.countMemories(filters);
  }

  updateManyMemories(filters: MemoryFilters, data: UpdateMemoryData): Promise<number> {
    return this.provider.updateManyMemories(filters, data);
  }

  incrementManyMemories(
    filters: MemoryFilters,
    increments: IncrementMemoryData,
    data?: UpdateMemoryData,
  ): Promise<number> {
    return this.provider.incrementManyMemories(filters, increments, data);
  }

  vectorSearch(embedding: number[], options: VectorSearchOptions): Promise<VectorSearchResult[]> {
    return this.provider.vectorSearch(embedding, options);
  }

  getMemoryEmbedding(memoryId: string): Promise<number[] | null> {
    return this.provider.getMemoryEmbedding(memoryId);
  }

  bulkCreate(data: CreateMemoryData[]): Promise<StoredMemory[]> {
    return this.provider.bulkCreate(data);
  }

  bulkUpdate(updates: BulkUpdateEntry[]): Promise<number> {
    return this.provider.bulkUpdate(updates);
  }

  getStats(userId?: string): Promise<StorageStats> {
    return this.provider.getStats(userId);
  }

  groupBy(
    field: string,
    filters?: MemoryFilters,
  ): Promise<Array<{ value: string; count: number }>> {
    return this.provider.groupBy(field, filters);
  }

  aggregate(
    field: string,
    operation: 'avg' | 'sum' | 'min' | 'max',
    filters?: MemoryFilters,
  ): Promise<number | null> {
    return this.provider.aggregate(field, operation, filters);
  }

  createMergeCandidate(data: CreateMergeCandidateData): Promise<any> {
    return this.provider.createMergeCandidate(data);
  }

  healthCheck(): Promise<HealthCheckResult> {
    return this.provider.healthCheck();
  }

  // ── Private ──────────────────────────────────────────────────────────

  private resolveProvider(name: string): StorageProvider {
    switch (name) {
      case 'prisma-postgres':
        return this.prismaPostgresProvider;
      case 'sqlite':
        return this.sqliteProvider;
      default:
        this.logger.warn(
          `Unknown storage provider '${name}', falling back to 'prisma-postgres'`,
        );
        return this.prismaPostgresProvider;
    }
  }
}
