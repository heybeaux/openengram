import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ExportQueryDto {
  @ApiPropertyOptional({ enum: ['json', 'ndjson'], default: 'json' })
  @IsOptional()
  @IsEnum(['json', 'ndjson'] as const)
  format?: 'json' | 'ndjson' = 'json';
}

export interface ExportedMemory {
  id: string;
  raw: string;
  layer: string;
  importance: number;
  tags: string[];
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  ensembleEmbeddings?: Record<string, number[]>;
}

export class ImportMemoriesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportMemoryItemDto)
  memories: ImportMemoryItemDto[];
}

export class ImportMemoryItemDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  raw: string;

  @IsOptional()
  @IsString()
  layer?: string;

  @IsOptional()
  importance?: number;

  @IsOptional()
  tags?: string[];

  @IsOptional()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsString()
  createdAt?: string;

  @IsOptional()
  @IsString()
  updatedAt?: string;

  // Ignored on import (re-generated) but accepted for format compatibility
  @IsOptional()
  ensembleEmbeddings?: Record<string, number[]>;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
}
