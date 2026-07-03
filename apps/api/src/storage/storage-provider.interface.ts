/**
 * Storage Provider Interface
 *
 * Abstracts database operations behind a clean provider pattern.
 * Implementations: Prisma/PostgreSQL (default), SQLite, future cloud providers.
 *
 * Covers the core storage operations used across Engram's modules:
 * - Memory CRUD (create, read, update, delete, search/list)
 * - Vector similarity search (pgvector in Postgres, brute-force in SQLite)
 * - Bulk operations (batch insert, batch update)
 * - Stats/aggregations (count, group by layer, etc.)
 * - Merge/dedup support (find similar, create merge candidates)
 * - Health checks
 */

import {
  MemoryLayer,
  MemorySource,
  MemoryType,
  SubjectType,
} from '@prisma/client';

// ─── Token for DI ───────────────────────────────────────────────────────────

export const STORAGE_PROVIDER_TOKEN = 'STORAGE_PROVIDER';

// ─── DTOs / Types ───────────────────────────────────────────────────────────

/** Data required to create a new memory */
export interface CreateMemoryData {
  userId: string;
  raw: string;
  layer: MemoryLayer;
  source?: MemorySource;
  importanceHint?: string;
  importanceScore?: number;
  confidence?: number;
  projectId?: string;
  sessionId?: string;
  subjectType?: SubjectType;
  subjectId?: string;
  agentId?: string;
  createdBySession?: string;
  memoryType?: MemoryType;
  typeConfidence?: number;
  priority?: number;
  effectiveScore?: number;
  embedding?: number[];
}

/** Data for updating a memory */
export interface UpdateMemoryData {
  raw?: string;
  layer?: MemoryLayer;
  importanceHint?: string;
  importanceScore?: number;
  confidence?: number;
  effectiveScore?: number;
  scoreComputedAt?: Date;
  safetyCritical?: boolean;
  memoryType?: MemoryType;
  typeConfidence?: number;
  priority?: number;
  userPinned?: boolean;
  userHidden?: boolean;
  deletedAt?: Date | null;
  supersededById?: string;
  consolidated?: boolean;
  consolidatedInto?: string;
  usedCount?: number;
  lastUsedAt?: Date;
  retrievalCount?: number;
  lastRetrievedAt?: Date;
  embedding?: number[];
}

/** Increment operations for memory fields */
export interface IncrementMemoryData {
  usedCount?: number;
  retrievalCount?: number;
}

/** Filters for querying memories */
export interface MemoryFilters {
  userId?: string;
  userIds?: string[];
  layer?: MemoryLayer;
  layers?: MemoryLayer[];
  source?: MemorySource;
  subjectType?: SubjectType;
  projectId?: string;
  sessionId?: string;
  agentId?: string;
  memoryType?: MemoryType;
  memoryTypes?: MemoryType[];
  deletedAt?: Date | null;
  supersededById?: null; // Filter for non-superseded
  consolidated?: boolean;
  consolidatedInto?: null; // Filter for non-consolidated
  createdAtGte?: Date;
  createdAtLte?: Date;
  ids?: string[];
  excludeIds?: string[];
  hasEmbedding?: boolean;
}

/** Pagination options */
export interface PaginationOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
}

/** Include related data in queries */
export interface MemoryInclude {
  extraction?: boolean;
  entities?: boolean;
  chainLinks?: boolean;
}

/** Memory record as returned by storage */
export interface StoredMemory {
  id: string;
  userId: string;
  raw: string;
  layer: MemoryLayer;
  source: MemorySource;
  memoryType?: MemoryType | null;
  typeConfidence?: number | null;
  priority: number;
  importanceHint?: string | null;
  importanceScore: number;
  effectiveScore: number;
  scoreComputedAt?: Date | null;
  safetyCritical: boolean;
  subjectType: SubjectType;
  subjectId?: string | null;
  agentId?: string | null;
  projectId?: string | null;
  sessionId?: string | null;
  confidence: number;
  userPinned: boolean;
  userHidden: boolean;
  usedCount: number;
  lastUsedAt?: Date | null;
  retrievalCount: number;
  lastRetrievedAt?: Date | null;
  consolidated: boolean;
  consolidatedInto?: string | null;
  supersededById?: string | null;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBySession?: string | null;
  // Related data (when included)
  extraction?: any;
  entities?: any[];
  [key: string]: any; // Allow extra fields from provider
}

/** Vector search result */
export interface VectorSearchResult {
  id: string;
  score: number;
}

/** Vector search options */
export interface VectorSearchOptions {
  limit: number;
  threshold?: number;
  filters?: MemoryFilters;
}

/** Bulk update entry */
export interface BulkUpdateEntry {
  id: string;
  data: UpdateMemoryData;
}

/** Stats about stored memories */
export interface StorageStats {
  totalMemories: number;
  activeMemories: number;
  deletedMemories: number;
  consolidatedMemories: number;
  layerDistribution: Record<string, number>;
  memoryTypeDistribution?: Record<string, number>;
  oldestMemory?: Date;
  newestMemory?: Date;
}

/** Merge candidate data */
export interface CreateMergeCandidateData {
  userId: string;
  memoryIds: string[];
  similarity: number;
  suggestedStrategy: string;
  suggestedSurvivorId: string;
  status: string;
  reviewNotes?: string;
}

/** Health check result */
export interface HealthCheckResult {
  healthy: boolean;
  latencyMs: number;
  provider: string;
  details?: Record<string, any>;
}

// ─── Provider Interface ─────────────────────────────────────────────────────

export interface StorageProvider {
  /** Provider identifier */
  readonly name: string;

  // ── Memory CRUD ──────────────────────────────────────────────────────

  /** Create a new memory */
  createMemory(data: CreateMemoryData): Promise<StoredMemory>;

  /** Get a single memory by ID, optionally with related data */
  getMemory(id: string, include?: MemoryInclude): Promise<StoredMemory | null>;

  /** Update a memory by ID */
  updateMemory(id: string, data: UpdateMemoryData): Promise<StoredMemory>;

  /** Update a memory with increment operations (e.g., usedCount += 1) */
  incrementMemory(
    id: string,
    increments: IncrementMemoryData,
    data?: UpdateMemoryData,
  ): Promise<StoredMemory>;

  /** Soft-delete a memory */
  deleteMemory(id: string): Promise<void>;

  // ── Queries ──────────────────────────────────────────────────────────

  /** Find memories matching filters with pagination */
  findMemories(
    filters: MemoryFilters,
    pagination?: PaginationOptions,
    include?: MemoryInclude,
  ): Promise<StoredMemory[]>;

  /** Count memories matching filters */
  countMemories(filters: MemoryFilters): Promise<number>;

  /** Update many memories matching filters */
  updateManyMemories(
    filters: MemoryFilters,
    data: UpdateMemoryData,
  ): Promise<number>;

  /** Update many memories with increment operations */
  incrementManyMemories(
    filters: MemoryFilters,
    increments: IncrementMemoryData,
    data?: UpdateMemoryData,
  ): Promise<number>;

  // ── Vector Search ────────────────────────────────────────────────────

  /**
   * Search for memories similar to the given embedding vector.
   * Returns memory IDs with similarity scores, ordered by descending similarity.
   */
  vectorSearch(
    embedding: number[],
    options: VectorSearchOptions,
  ): Promise<VectorSearchResult[]>;

  /**
   * Get the raw embedding vector for a memory (stored in the memories table).
   * Returns null if no embedding is stored.
   */
  getMemoryEmbedding(memoryId: string): Promise<number[] | null>;

  // ── Bulk Operations ──────────────────────────────────────────────────

  /** Create multiple memories in a batch */
  bulkCreate(data: CreateMemoryData[]): Promise<StoredMemory[]>;

  /** Update multiple memories by ID */
  bulkUpdate(updates: BulkUpdateEntry[]): Promise<number>;

  // ── Stats / Aggregations ─────────────────────────────────────────────

  /** Get storage statistics */
  getStats(userId?: string): Promise<StorageStats>;

  /** Group memories by a field and count */
  groupBy(
    field: string,
    filters?: MemoryFilters,
  ): Promise<Array<{ value: string; count: number }>>;

  /** Aggregate numeric field */
  aggregate(
    field: string,
    operation: 'avg' | 'sum' | 'min' | 'max',
    filters?: MemoryFilters,
  ): Promise<number | null>;

  // ── Merge / Dedup Support ────────────────────────────────────────────

  /** Create a merge candidate record */
  createMergeCandidate(data: CreateMergeCandidateData): Promise<any>;

  // ── Health ───────────────────────────────────────────────────────────

  /** Check provider health and latency */
  healthCheck(): Promise<HealthCheckResult>;
}
