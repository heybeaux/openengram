import { IsOptional, IsString, IsNumber, IsBoolean, IsEnum, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Request to trigger a re-embedding batch run
 */
export class TriggerReembeddingDto {
  @ApiPropertyOptional({ description: 'Limit number of memories to process' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10000)
  limit?: number;

  @ApiPropertyOptional({ description: 'Only re-embed memories older than this many days' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  staleDays?: number;

  @ApiPropertyOptional({ description: 'Filter to specific user ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'Dry run - compute enriched text but do not update' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

/**
 * Status of a re-embedding job
 */
export enum ReembeddingJobStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/**
 * Response from triggering a re-embedding run
 */
export class ReembeddingJobDto {
  @ApiProperty({ description: 'Job ID' })
  jobId: string;

  @ApiProperty({ enum: ReembeddingJobStatus })
  status: ReembeddingJobStatus;

  @ApiProperty({ description: 'Total memories to process' })
  totalMemories: number;

  @ApiProperty({ description: 'Memories processed so far' })
  processedCount: number;

  @ApiProperty({ description: 'Successful re-embeddings' })
  successCount: number;

  @ApiProperty({ description: 'Failed re-embeddings' })
  failureCount: number;

  @ApiPropertyOptional({ description: 'Job start time' })
  startedAt?: Date;

  @ApiPropertyOptional({ description: 'Job completion time' })
  completedAt?: Date;

  @ApiPropertyOptional({ description: 'Error message if failed' })
  error?: string;
}

/**
 * Enriched memory preview (for dry run)
 */
export class EnrichedMemoryPreviewDto {
  @ApiProperty({ description: 'Memory ID' })
  memoryId: string;

  @ApiProperty({ description: 'Original content' })
  originalContent: string;

  @ApiProperty({ description: 'Enriched content with context' })
  enrichedContent: string;

  @ApiProperty({ description: 'Temporal context added' })
  temporalContext?: string;

  @ApiProperty({ description: 'Entity context added' })
  entityContext?: string;

  @ApiProperty({ description: 'Importance context added' })
  importanceContext?: string;

  @ApiProperty({ description: 'Current embedding version' })
  currentVersion: number;

  @ApiProperty({ description: 'New embedding version after re-embed' })
  newVersion: number;
}
