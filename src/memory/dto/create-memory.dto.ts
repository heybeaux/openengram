import { IsString, IsOptional, IsEnum, IsObject, IsNumber, IsArray, IsDate } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ImportanceHint, MemoryLayer, SubjectType } from '@prisma/client';

/**
 * Map legacy memoryType values to MemoryLayer enum
 */
function mapMemoryType(value: string | undefined): MemoryLayer | undefined {
  if (!value) return undefined;
  const upperValue = value.toUpperCase();
  // Handle both "SESSION" and "session" formats
  if (Object.values(MemoryLayer).includes(upperValue as MemoryLayer)) {
    return upperValue as MemoryLayer;
  }
  return undefined;
}

/**
 * Map numeric importance (0-1) to ImportanceHint enum
 */
function mapImportanceToHint(value: number | string | undefined): ImportanceHint | undefined {
  if (value === undefined || value === null) return undefined;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return undefined;
  if (num >= 0.9) return ImportanceHint.CRITICAL;
  if (num >= 0.7) return ImportanceHint.HIGH;
  if (num >= 0.5) return ImportanceHint.MEDIUM;
  return ImportanceHint.LOW;
}

export class CreateMemoryDto {
  // Primary field name (transforms content -> raw for backward compatibility)
  @IsOptional()
  @IsString()
  @Transform(({ value, obj }) => value ?? obj.content)
  raw?: string;

  // Legacy alias: content -> raw (accepted but transformed to raw)
  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsEnum(MemoryLayer)
  @Transform(({ value, obj }) => value ?? mapMemoryType(obj.memoryType))
  layer?: MemoryLayer;

  // Legacy alias: memoryType -> layer
  @IsOptional()
  @IsString()
  memoryType?: string;

  @IsOptional()
  @Transform(({ value, obj }) => {
    // If importanceHint is already set, use it
    if (value && Object.values(ImportanceHint).includes(value)) return value;
    // Otherwise, try to map from numeric importance
    return mapImportanceToHint(obj.importance);
  })
  importanceHint?: ImportanceHint;

  // Legacy alias: importance (numeric 0-1) -> importanceHint
  @IsOptional()
  @IsNumber()
  importance?: number;

  // Legacy alias: tags (ignored but accepted for compatibility)
  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsObject()
  context?: {
    projectId?: string;
    sessionId?: string;
  };

  // Subject fields: who/what is this memory ABOUT?
  @IsOptional()
  @IsEnum(SubjectType)
  subjectType?: SubjectType;

  @IsOptional()
  @IsString()
  subjectId?: string;

  // For agent self-memories: which agent is this about?
  @IsOptional()
  @IsString()
  agentId?: string;

  // Source attribution fields (for tracking where memories came from)
  @IsOptional()
  @Type(() => Date)
  sourceTimestamp?: Date;

  @IsOptional()
  @IsNumber()
  sourceTurnIndex?: number;

  @IsOptional()
  @IsString()
  sourceMessageId?: string;
}

export class CreateMemoryBatchDto {
  memories: Array<{
    raw: string;
    ts?: string; // ISO timestamp
    layer?: MemoryLayer;
    importanceHint?: ImportanceHint;
  }>;

  context?: {
    projectId?: string;
    sessionId?: string;
  };
}
