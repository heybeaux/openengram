import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  Min,
  Max,
} from 'class-validator';

export class ScopedContextRequestDto {
  @IsString()
  userId: string;

  @IsString()
  agentSessionKey: string;

  @IsOptional()
  @IsString()
  taskDescription?: string;

  @IsOptional()
  @IsNumber()
  @Min(200)
  @Max(16000)
  maxTokens?: number;

  @IsOptional()
  @IsBoolean()
  includeGlobal?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  poolIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  topicHints?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludeTypes?: string[];
}

export interface ScopedContextResponseDto {
  context: string;
  tokenCount: number;
  memoriesIncluded: number;
  taskDescription: string | null;
  sections: {
    critical: number;
    taskRelevant: number;
    background: number;
  };
}
