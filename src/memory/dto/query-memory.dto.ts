import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsArray,
  IsEnum,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MemoryLayer, SubjectType } from '@prisma/client';
import { MultiQueryOptionsDto } from '../../multi-query/dto/multi-query.dto';

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

  // Subject filtering: what kind of memories to include?
  @IsOptional()
  @IsBoolean()
  includeUserMemories?: boolean = true;

  @IsOptional()
  @IsBoolean()
  includeAgentMemories?: boolean = true;

  @IsOptional()
  @IsEnum(SubjectType)
  subjectType?: SubjectType;

  @IsOptional()
  @IsString()
  agentId?: string;

  // Multi-query retrieval options
  @IsOptional()
  @ValidateNested()
  @Type(() => MultiQueryOptionsDto)
  multiQuery?: MultiQueryOptionsDto;

  // v0.7: Agent session attribution
  @IsOptional()
  @IsString()
  agentSessionKey?: string;
}

export class LoadContextDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  agentId?: string;

  @IsOptional()
  @IsNumber()
  maxTokens?: number = 4000;
}
