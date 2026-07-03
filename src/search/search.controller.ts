import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { IsString, IsOptional, IsUUID, IsInt, Min, Max, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { 
  SearchService, 
  SearchQuery, 
  SearchResponse, 
  SearchResult,
  EnsembleSearchQuery,
  EnsembleSearchResponse,
  EnsembleSearchResult,
} from './search.service';
import { EmbeddingModelId } from './embeddings.service';

/**
 * Search controller for semantic code search.
 * POST /v1/search - Main search endpoint
 * POST /v1/search/ensemble - Multi-model ensemble search with RRF fusion
 */

// DTOs
export class SearchRequestDto {
  /**
   * Natural language query.
   * @example "where is CRUD/FLS checked"
   */
  @IsString()
  query: string;

  /**
   * Filter by project ID (UUID).
   * If omitted, searches all projects.
   */
  @IsOptional()
  @IsUUID()
  projectId?: string;

  /**
   * Filter by language (apex, lwc, javascript, typescript, python).
   */
  @IsOptional()
  @IsString()
  language?: string;

  /**
   * Filter by chunk type (class, method, function, component, trigger, test).
   */
  @IsOptional()
  @IsString()
  chunkType?: string;

  /**
   * Maximum number of results to return.
   * @default 10
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;
}

export class EnsembleSearchRequestDto extends SearchRequestDto {
  /**
   * Embedding models to use for ensemble search.
   * Available: bge-base, nomic, gte-base, minilm
   * @default ["bge-base", "nomic"]
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  models?: EmbeddingModelId[];
}

export class SearchResultDto {
  chunk: {
    id: string;
    projectId: string;
    filePath: string;
    lineStart: number;
    lineEnd: number;
    content: string;
    language: string;
    chunkType: string;
    name: string;
    parentName: string | null;
    dependencies: string[];
  };
  
  /**
   * Similarity score (0-1, higher = more similar).
   */
  score: number;
  
  /**
   * Keywords/patterns found in the content.
   */
  highlights?: string[];
}

export class EnsembleSearchResultDto extends SearchResultDto {
  /**
   * RRF fusion score (higher = more relevant across models).
   */
  fusedScore: number;

  /**
   * Rank in each model's results (1-indexed).
   */
  modelRanks: Record<string, number>;
}

export class SearchResponseDto {
  query: string;
  results: SearchResultDto[];
  totalFound: number;
  searchTimeMs: number;
}

export class EnsembleSearchResponseDto {
  query: string;
  results: EnsembleSearchResultDto[];
  totalFound: number;
  searchTimeMs: number;
  fusionMethod: 'rrf';
  modelsUsed: EmbeddingModelId[];
  perModelResults: Record<EmbeddingModelId, SearchResultDto[]>;
}

@Controller('v1')
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(private readonly searchService: SearchService) {}

  /**
   * Semantic search over ingested code chunks.
   * 
   * @example
   * POST /v1/search
   * {
   *   "query": "where is CRUD/FLS checked",
   *   "projectId": "550e8400-e29b-41d4-a716-446655440000",
   *   "language": "apex",
   *   "limit": 10
   * }
   */
  @Post('search')
  @HttpCode(HttpStatus.OK)
  async search(@Body() dto: SearchRequestDto): Promise<SearchResponseDto> {
    this.logger.log(`Search request: "${dto.query}"`);

    const searchQuery: SearchQuery = {
      query: dto.query,
      projectId: dto.projectId,
      language: dto.language?.toLowerCase(),
      chunkType: dto.chunkType?.toLowerCase(),
      limit: dto.limit ?? 10,
    };

    const response = await this.searchService.search(searchQuery);

    return {
      query: response.query,
      results: response.results.map((r) => ({
        chunk: r.chunk,
        score: r.score,
        highlights: r.highlights,
      })),
      totalFound: response.totalFound,
      searchTimeMs: response.searchTimeMs,
    };
  }

  /**
   * Ensemble search using multiple embedding models with RRF fusion.
   * Combines results from different models for better recall.
   * 
   * @example
   * POST /v1/search/ensemble
   * {
   *   "query": "where is authentication handled",
   *   "projectId": "550e8400-e29b-41d4-a716-446655440000",
   *   "models": ["bge-base", "nomic"],
   *   "limit": 10
   * }
   */
  @Post('search/ensemble')
  @HttpCode(HttpStatus.OK)
  async searchEnsemble(@Body() dto: EnsembleSearchRequestDto): Promise<EnsembleSearchResponseDto> {
    this.logger.log(`Ensemble search request: "${dto.query}" with models [${dto.models?.join(', ') || 'default'}]`);

    const searchQuery: EnsembleSearchQuery = {
      query: dto.query,
      projectId: dto.projectId,
      language: dto.language?.toLowerCase(),
      chunkType: dto.chunkType?.toLowerCase(),
      limit: dto.limit ?? 10,
      models: dto.models,
    };

    const response = await this.searchService.searchEnsemble(searchQuery);

    return {
      query: response.query,
      results: response.results.map((r) => ({
        chunk: r.chunk,
        score: r.score,
        fusedScore: r.fusedScore,
        modelRanks: r.modelRanks,
        highlights: r.highlights,
      })),
      totalFound: response.totalFound,
      searchTimeMs: response.searchTimeMs,
      fusionMethod: response.fusionMethod,
      modelsUsed: response.modelsUsed,
      perModelResults: response.perModelResults,
    };
  }

  /**
   * Find code similar to an existing chunk.
   * Useful for detecting duplicates or related patterns.
   * 
   * @example
   * GET /v1/search/similar/550e8400-e29b-41d4-a716-446655440000?limit=5
   */
  @Get('search/similar/:chunkId')
  async findSimilar(
    @Param('chunkId') chunkId: string,
    @Query('limit') limit?: string,
  ): Promise<{ results: SearchResultDto[] }> {
    const parsedLimit = limit ? parseInt(limit, 10) : 5;

    const results = await this.searchService.findSimilar(chunkId, parsedLimit);

    return {
      results: results.map((r) => ({
        chunk: r.chunk,
        score: r.score,
        highlights: r.highlights,
      })),
    };
  }

  /**
   * Get available embedding models for ensemble search.
   * Returns all models and which ones have populated embeddings.
   */
  @Get('search/models')
  async getModels(
    @Query('projectId') projectId?: string,
  ): Promise<{ all: EmbeddingModelId[]; populated: EmbeddingModelId[] }> {
    return this.searchService.getAvailableModels(projectId);
  }

  /**
   * Get example queries for testing.
   */
  @Get('search/examples')
  getExamples(): { queries: string[] } {
    return {
      queries: this.searchService.getExampleQueries(),
    };
  }

  /**
   * Health check for the search service.
   */
  @Get('search/health')
  async health(): Promise<{ status: string; timestamp: string }> {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}


/* ============================================================
   EXAMPLE USAGE (curl commands)
   ============================================================

# Basic search (single model)
curl -X POST http://localhost:3002/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query": "where is CRUD/FLS checked"}'

# Ensemble search (multi-model with RRF fusion)
curl -X POST http://localhost:3002/v1/search/ensemble \
  -H "Content-Type: application/json" \
  -d '{
    "query": "where is authentication handled",
    "models": ["bge-base", "nomic"]
  }'

# Ensemble search with project filter
curl -X POST http://localhost:3002/v1/search/ensemble \
  -H "Content-Type: application/json" \
  -d '{
    "query": "DML operations",
    "projectId": "550e8400-e29b-41d4-a716-446655440000",
    "models": ["bge-base", "nomic", "gte-base"],
    "limit": 20
  }'

# Get available models
curl http://localhost:3002/v1/search/models

# Get models populated for a project
curl http://localhost:3002/v1/search/models?projectId=550e8400-e29b-41d4-a716-446655440000

# Find similar code to a chunk
curl http://localhost:3002/v1/search/similar/abc123-chunk-id?limit=5

# Get example queries
curl http://localhost:3002/v1/search/examples

# Health check
curl http://localhost:3002/v1/search/health

============================================================ */
