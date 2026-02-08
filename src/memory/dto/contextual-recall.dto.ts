import { IsString, IsOptional, IsArray, IsNumber } from 'class-validator';

export class ContextualRecallDto {
  @IsString()
  text: string;

  @IsString()
  sessionKey: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludeIds?: string[];

  @IsOptional()
  @IsNumber()
  maxResults?: number = 5;

  @IsOptional()
  @IsNumber()
  maxTokens?: number = 500;

  @IsOptional()
  @IsNumber()
  minScore?: number = 0.65;
}

export class ContextualRecallResponseDto {
  memories: Array<{
    id: string;
    raw: string;
    layer: string;
    score: number;
    topics: string[];
  }>;
  topicShift: boolean;
  tokenCount: number;
  latencyMs: number;
}
