import { IsString, IsOptional, IsBoolean, IsNumber, IsArray, IsEnum } from 'class-validator';
import { MemoryLayer } from '@prisma/client';

export class QueryMemoryDto {
  @IsString()
  query: string;

  @IsOptional()
  @IsArray()
  @IsEnum(MemoryLayer, { each: true })
  layers?: MemoryLayer[];

  @IsOptional()
  @IsNumber()
  limit?: number = 10;

  @IsOptional()
  @IsBoolean()
  includeChains?: boolean = false;

  @IsOptional()
  @IsString()
  projectId?: string;
}

export class LoadContextDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsNumber()
  maxTokens?: number = 4000;
}
