import {
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean,
  IsArray,
  IsEnum,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { MemoryType } from '@prisma/client';

// ============================================================================
// Enums
// ============================================================================

/**
 * Strategy for merging duplicate memories
 */
export enum MergeStrategy {
  KEEP_NEWEST = 'KEEP_NEWEST',
  KEEP_OLDEST = 'KEEP_OLDEST',
  KEEP_DETAILED = 'KEEP_DETAILED',
  KEEP_IMPORTANCE = 'KEEP_IMPORTANCE',
  COMBINE_METADATA = 'COMBINE_METADATA',
}

/**
 * Status of a merge candidate
 */
export enum CandidateStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  SKIPPED = 'SKIPPED',
}

/**
 * Status of a batch dedup job
 */
export enum BatchJobStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/**
 * Safety reason types
 */
export enum SafetyReasonType {
  PROTECTED_TYPE = 'protected_type',
  PROTECTED_KEYWORD = 'protected_keyword',
  HIGH_IMPORTANCE = 'high_importance',
  REQUIRES_REVIEW = 'requires_review',
  RECENTLY_ACCESSED = 'recently_accessed',
  MANUALLY_EDITED = 'manually_edited',
}

// ============================================================================
// Request DTOs
// ============================================================================

/**
 * Request to trigger batch deduplication scan
 */
export class TriggerScanDto {
  @ApiPropertyOptional({
    description: 'Run in dry-run mode (no actual merges)',
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({
    description: 'Minimum similarity threshold (0.0-1.0)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  minSimilarity?: number;

  @ApiPropertyOptional({ description: 'Maximum memories to process' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10000)
  maxMemories?: number;

  @ApiPropertyOptional({ description: 'Filter to specific user ID' })
  @IsOptional()
  @IsString()
  userId?: string;
}

/**
 * Request to approve a merge candidate
 */
export class ApproveRequestDto {
  @ApiPropertyOptional({ description: 'Override suggested merge strategy' })
  @IsOptional()
  @IsEnum(MergeStrategy)
  strategy?: MergeStrategy;

  @ApiPropertyOptional({ description: 'Override suggested survivor ID' })
  @IsOptional()
  @IsString()
  survivorId?: string;

  @ApiPropertyOptional({ description: 'Custom merged content' })
  @IsOptional()
  @IsString()
  customContent?: string;
}

/**
 * Request to reject a merge candidate
 */
export class RejectRequestDto {
  @ApiProperty({ description: 'Reason for rejection' })
  @IsString()
  reason: string;

  @ApiPropertyOptional({ description: 'Add to never-merge list' })
  @IsOptional()
  @IsBoolean()
  neverMerge?: boolean;
}

/**
 * Request to manually trigger a merge
 */
export class ManualMergeDto {
  @ApiProperty({ description: 'Memory IDs to merge (2 or more)' })
  @IsArray()
  @IsString({ each: true })
  memoryIds: string[];

  @ApiProperty({ description: 'Merge strategy to use' })
  @IsEnum(MergeStrategy)
  strategy: MergeStrategy;

  @ApiPropertyOptional({ description: 'Which memory should survive' })
  @IsOptional()
  @IsString()
  survivorId?: string;

  @ApiPropertyOptional({ description: 'Custom merged content' })
  @IsOptional()
  @IsString()
  customContent?: string;
}

/**
 * Query params for listing candidates
 */
export class ListCandidatesQueryDto {
  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'Filter by status' })
  @IsOptional()
  @IsEnum(CandidateStatus)
  status?: CandidateStatus;

  @ApiPropertyOptional({ description: 'Minimum similarity filter' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  minSimilarity?: number;

  @ApiPropertyOptional({ description: 'Maximum results to return' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({ description: 'Offset for pagination' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  offset?: number;
}

/**
 * Request to update dedup configuration
 */
export class UpdateConfigDto {
  @ApiPropertyOptional({ description: 'Auto-merge threshold (0.0-1.0)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  autoMergeThreshold?: number;

  @ApiPropertyOptional({ description: 'Review suggest threshold (0.0-1.0)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  reviewSuggestThreshold?: number;

  @ApiPropertyOptional({ description: 'Default merge strategy' })
  @IsOptional()
  @IsEnum(MergeStrategy)
  defaultStrategy?: MergeStrategy;

  @ApiPropertyOptional({ description: 'Protected memory types' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  protectedTypes?: string[];

  @ApiPropertyOptional({ description: 'Protected keywords' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  protectedKeywords?: string[];

  @ApiPropertyOptional({ description: 'Protected importance threshold' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  protectedImportanceThreshold?: number;

  @ApiPropertyOptional({
    description:
      'Auto-resolve threshold (0.0-1.0). Candidates at or above this similarity with no safety flags are auto-approved. Set to 0 to disable.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  autoResolveThreshold?: number;

  @ApiPropertyOptional({ description: 'Enable batch deduplication' })
  @IsOptional()
  @IsBoolean()
  batchEnabled?: boolean;
}

// ============================================================================
// Response DTOs
// ============================================================================

/**
 * Safety reason attached to a memory/candidate
 */
export class SafetyReasonDto {
  @ApiProperty({ enum: SafetyReasonType })
  type: SafetyReasonType;

  @ApiPropertyOptional()
  memoryType?: string;

  @ApiPropertyOptional()
  keyword?: string;

  @ApiPropertyOptional()
  score?: number;

  @ApiPropertyOptional()
  lastAccessed?: Date;
}

/**
 * Memory summary in candidate
 */
export class MemorySummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  content: string;

  @ApiPropertyOptional()
  memoryType?: MemoryType;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  importanceScore: number;
}

/**
 * Merge candidate response
 */
export class MergeCandidateDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: [MemorySummaryDto] })
  memories: MemorySummaryDto[];

  @ApiProperty()
  similarity: number;

  @ApiProperty({ enum: MergeStrategy })
  suggestedStrategy: MergeStrategy;

  @ApiProperty()
  suggestedSurvivorId: string;

  @ApiProperty({ type: [SafetyReasonDto] })
  safetyFlags: SafetyReasonDto[];

  @ApiProperty({ enum: CandidateStatus })
  status: CandidateStatus;

  @ApiProperty()
  createdAt: Date;
}

/**
 * Response for listing candidates
 */
export class ListCandidatesResponseDto {
  @ApiProperty({ type: [MergeCandidateDto] })
  candidates: MergeCandidateDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  pendingCount: number;
}

/**
 * Response from approving a merge
 */
export class ApproveResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty()
  mergeEventId: string;

  @ApiProperty()
  survivorId: string;

  @ApiProperty({ type: [String] })
  absorbedIds: string[];
}

/**
 * Response from rejecting a merge
 */
export class RejectResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty()
  addedToNeverMerge: boolean;
}

/**
 * Response from batch scan
 */
export class ScanResponseDto {
  @ApiProperty()
  scanId: string;

  @ApiProperty({ enum: BatchJobStatus })
  status: BatchJobStatus;

  @ApiProperty()
  memoriesProcessed: number;

  @ApiProperty()
  clustersFound: number;

  @ApiProperty()
  autoMerged: number;

  @ApiProperty()
  queuedForReview: number;

  @ApiProperty()
  durationMs: number;
}

/**
 * Response from manual merge
 */
export class MergeResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty()
  mergeEventId: string;

  @ApiProperty()
  survivorId: string;

  @ApiProperty({ type: [String] })
  absorbedIds: string[];

  @ApiProperty()
  mergedContent: string;
}

/**
 * Response from rollback
 */
export class RollbackResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ type: [String] })
  restoredMemoryIds: string[];

  @ApiProperty()
  survivorId: string;
}

/**
 * Dedup configuration response
 */
export class ConfigResponseDto {
  @ApiProperty()
  autoMergeThreshold: number;

  @ApiProperty()
  reviewSuggestThreshold: number;

  @ApiProperty({ enum: MergeStrategy })
  defaultStrategy: MergeStrategy;

  @ApiProperty({ type: [String] })
  protectedTypes: string[];

  @ApiProperty({ type: [String] })
  protectedKeywords: string[];

  @ApiProperty()
  protectedImportanceThreshold: number;

  @ApiProperty({
    description:
      'Auto-resolve threshold. Candidates at or above this with no safety flags are auto-approved. 0 = disabled.',
  })
  autoResolveThreshold: number;

  @ApiProperty()
  batchEnabled: boolean;

  @ApiPropertyOptional()
  lastBatchRunAt?: Date;
}

/**
 * Dedup statistics response
 */
export class StatsResponseDto {
  @ApiProperty()
  totalMemories: number;

  @ApiProperty()
  potentialDuplicates: number;

  @ApiProperty()
  clustersIdentified: number;

  @ApiProperty()
  autoMergedToday: number;

  @ApiProperty()
  pendingReview: number;

  @ApiProperty()
  compressionRatio: number;

  @ApiProperty()
  mergesThisWeek: number;

  @ApiProperty()
  rollbacksThisWeek: number;
}

/**
 * Similar memory result from search
 */
export class SimilarMemoryDto {
  @ApiProperty()
  memoryId: string;

  @ApiProperty()
  similarity: number;

  @ApiProperty()
  content: string;

  @ApiPropertyOptional()
  memoryType?: MemoryType;

  @ApiProperty()
  createdAt: Date;
}

/**
 * Safety check result
 */
export class SafetyCheckResultDto {
  @ApiProperty()
  memoryId: string;

  @ApiProperty()
  isProtected: boolean;

  @ApiProperty()
  canAutoMerge: boolean;

  @ApiProperty()
  requiresReview: boolean;

  @ApiProperty({ type: [SafetyReasonDto] })
  reasons: SafetyReasonDto[];
}

/**
 * Merge event for lineage tracking
 */
export class MergeEventDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  survivorMemoryId: string;

  @ApiProperty({ type: [String] })
  absorbedMemoryIds: string[];

  @ApiProperty({ enum: MergeStrategy })
  strategy: MergeStrategy;

  @ApiProperty()
  similarity: number;

  @ApiProperty()
  triggeredBy: string;

  @ApiPropertyOptional()
  approvedBy?: string;

  @ApiProperty()
  mergedContent: string;

  @ApiProperty()
  contentChanged: boolean;

  @ApiProperty()
  canRollback: boolean;

  @ApiPropertyOptional()
  rolledBackAt?: Date;

  @ApiProperty()
  createdAt: Date;
}
