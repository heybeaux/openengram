import {
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class IndexSessionDto {
  @IsString()
  sessionId: string;

  @IsString()
  transcript: string;

  @IsOptional()
  @IsString()
  agentId?: string;

  @IsOptional()
  @IsNumber()
  chunkSize?: number; // target characters per chunk, default 1500

  @IsOptional()
  @IsNumber()
  chunkOverlap?: number; // overlap characters, default 200
}

export class FlushMemoryItemDto {
  @IsString()
  content: string;

  @IsOptional()
  @IsString()
  layer?: string;

  @IsOptional()
  @IsString()
  importance?: string; // LOW, MEDIUM, HIGH, CRITICAL

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  agentId?: string;

  @IsOptional()
  @IsString()
  source?: string;
}

export class FlushMemoriesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FlushMemoryItemDto)
  memories: FlushMemoryItemDto[];

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  agentId?: string;

  @IsOptional()
  @IsString()
  reason?: string; // e.g. 'pre_compaction', 'context_overflow'
}
