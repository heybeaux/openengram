import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsEnum,
  ValidateNested,
  IsObject,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Fusion strategy for combining results from multiple queries
 */
export enum FusionStrategy {
  RRF = 'rrf', // Reciprocal Rank Fusion (default)
  FREQUENCY = 'frequency', // Frequency-based boost
  WEIGHTED = 'weighted', // Weighted RRF with query source weights
  MAX_SCORE = 'max', // Use maximum similarity score
}

/**
 * Expansion strategy for generating query variants
 */
export enum ExpansionStrategy {
  RULES = 'rules', // Rule-based only (synonyms, patterns)
  LLM = 'llm', // LLM-powered only
  HYBRID = 'hybrid', // Combine rules + LLM
}

/**
 * Multi-query configuration options
 */
export class MultiQueryOptionsDto {
  @ApiPropertyOptional({ description: 'Enable/disable multi-query retrieval' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Preset configuration',
    enum: ['fast', 'balanced', 'comprehensive'],
  })
  @IsOptional()
  @IsString()
  preset?: 'fast' | 'balanced' | 'comprehensive';

  @ApiPropertyOptional({
    description: 'Maximum number of query variants',
    minimum: 2,
    maximum: 15,
  })
  @IsOptional()
  @IsNumber()
  @Min(2)
  @Max(15)
  maxVariants?: number;

  @ApiPropertyOptional({
    description: 'Fusion strategy for combining results',
    enum: ['rrf', 'frequency', 'weighted', 'max'],
  })
  @IsOptional()
  @ApiPropertyOptional({
    enum: ['rrf', 'frequency', 'weighted', 'max'],
    type: String,
  })
  @IsEnum(FusionStrategy)
  fusionStrategy?: string;

  @ApiPropertyOptional({
    description: 'Expansion strategy for generating variants',
    enum: ['rules', 'llm', 'hybrid'],
  })
  @IsOptional()
  @ApiPropertyOptional({ enum: ['rules', 'llm', 'hybrid'], type: String })
  @IsEnum(ExpansionStrategy)
  expansionStrategy?: string;

  @ApiPropertyOptional({ description: 'Include expanded variants in response' })
  @IsOptional()
  @IsBoolean()
  includeVariants?: boolean;

  @ApiPropertyOptional({
    description: 'Include detailed timing breakdown in response',
  })
  @IsOptional()
  @IsBoolean()
  includeTimings?: boolean;

  @ApiPropertyOptional({ description: 'Include match explanations per result' })
  @IsOptional()
  @IsBoolean()
  includeExplanations?: boolean;

  @ApiPropertyOptional({
    description: 'Target latency in milliseconds',
    minimum: 100,
    maximum: 5000,
  })
  @IsOptional()
  @IsNumber()
  @Min(100)
  @Max(5000)
  targetLatencyMs?: number;
}

/**
 * Request to expand a query into variants (for debugging)
 */
export class ExpandQueryDto {
  @ApiProperty({ description: 'Query to expand' })
  @IsString()
  query: string;

  @ApiPropertyOptional({
    description: 'Expansion strategy',
    enum: ['rules', 'llm', 'hybrid'],
  })
  @IsOptional()
  @ApiPropertyOptional({ enum: ['rules', 'llm', 'hybrid'], type: String })
  @IsEnum(ExpansionStrategy)
  strategy?: string;

  @ApiPropertyOptional({ description: 'Maximum number of variants' })
  @IsOptional()
  @IsNumber()
  @Min(2)
  @Max(15)
  maxVariants?: number;
}

/**
 * Query match details for explaining results
 */
export class QueryMatchDto {
  @ApiProperty({ description: 'Query index' })
  queryIndex: number;

  @ApiProperty({ description: 'Query text' })
  query: string;

  @ApiProperty({ description: "Rank in this query's results" })
  rank: number;

  @ApiProperty({ description: 'Similarity score from this query' })
  score: number;

  @ApiProperty({ description: 'Whether this is the original query' })
  isOriginal: boolean;
}

/**
 * Multi-query signals for a result
 */
export class MultiQuerySignalsDto {
  @ApiProperty({ description: 'Number of queries that matched this result' })
  queryCount: number;

  @ApiProperty({ description: 'Best rank across all queries' })
  bestRank: number;

  @ApiProperty({ description: 'Raw RRF score' })
  rrfScore: number;

  @ApiProperty({ description: 'Average similarity score across queries' })
  avgScore: number;
}

/**
 * Result explanation for debugging
 */
export class ResultExplanationDto {
  @ApiProperty({ description: 'Memory ID' })
  memoryId: string;

  @ApiProperty({ description: 'Final combined score' })
  totalScore: number;

  @ApiProperty({
    description: 'Details of which queries matched',
    type: [QueryMatchDto],
  })
  matchedQueries: QueryMatchDto[];

  @ApiProperty({ description: 'Contribution breakdown' })
  fusionContributions: {
    rrfScore: number;
    frequencyBoost: number;
    weightBoost: number;
  };
}

/**
 * Timing breakdown for multi-query search
 */
export class MultiQueryTimingsDto {
  @ApiProperty({ description: 'Query expansion time (ms)' })
  expansionMs: number;

  @ApiProperty({ description: 'Batch embedding time (ms)' })
  embeddingMs: number;

  @ApiProperty({ description: 'Parallel search time (ms)' })
  searchMs: number;

  @ApiProperty({ description: 'Result fusion time (ms)' })
  fusionMs: number;

  @ApiProperty({ description: 'Total time (ms)' })
  totalMs: number;
}

/**
 * Multi-query metadata in search response
 */
export class MultiQueryMetadataDto {
  @ApiProperty({ description: 'Whether multi-query was enabled' })
  enabled: boolean;

  @ApiPropertyOptional({ description: 'Expanded query variants' })
  variants?: string[];

  @ApiPropertyOptional({ description: 'Source of each variant' })
  variantSources?: Record<string, 'original' | 'rules' | 'llm'>;

  @ApiProperty({ description: 'Fusion strategy used' })
  fusionStrategy: string;

  @ApiPropertyOptional({ description: 'Timing breakdown' })
  timings?: MultiQueryTimingsDto;
}

/**
 * Query expansion result
 */
export class QueryExpansionResultDto {
  @ApiProperty({ description: 'Original query' })
  original: string;

  @ApiProperty({ description: 'Expanded variants' })
  variants: string[];

  @ApiProperty({ description: 'Source of each variant' })
  sources: Record<string, 'original' | 'rules' | 'llm'>;

  @ApiProperty({ description: 'Expansion timing' })
  timings: {
    rulesMs: number;
    llmMs: number;
    totalMs: number;
  };

  @ApiProperty({ description: 'Whether LLM was used' })
  llmUsed: boolean;
}
