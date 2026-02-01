import { IsString, IsOptional, IsEnum, IsObject } from 'class-validator';
import { ImportanceHint, MemoryLayer } from '@prisma/client';

export class CreateMemoryDto {
  @IsString()
  raw: string;

  @IsOptional()
  @IsEnum(MemoryLayer)
  layer?: MemoryLayer;

  @IsOptional()
  @IsEnum(ImportanceHint)
  importanceHint?: ImportanceHint;

  @IsOptional()
  @IsObject()
  context?: {
    projectId?: string;
    sessionId?: string;
  };
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
