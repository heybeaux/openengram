/**
 * Ensemble Controller
 * 
 * API endpoints for multi-model ensemble retrieval.
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { EnsembleService } from './ensemble.service';
import {
  ModelId,
  EnsembleQueryResult,
  FusedResult,
  EnsembleConfig,
} from './ensemble.types';

// ============================================================================
// DTOs
// ============================================================================

class EnsembleQueryDto {
  query: string;
  userId: string;
  limit?: number;
  k?: number;
  models?: ModelId[];
  weights?: Record<ModelId, number>;
}

class EnsembleUpsertDto {
  memoryId: string;
  content: string;
  userId: string;
  metadata?: Record<string, any>;
}

class CompareQueryDto {
  query: string;
  userId: string;
  limit?: number;
}

// ============================================================================
// Response Types
// ============================================================================

interface StatusResponse {
  enabled: boolean;
  models: ModelId[];
  config: EnsembleConfig;
}

interface FusedResultResponse extends Omit<FusedResult, 'modelScores'> {
  modelScores: Record<ModelId, { rank: number; score: number }>;
}

interface EnsembleQueryResponse extends Omit<EnsembleQueryResult, 'results'> {
  results: FusedResultResponse[];
}

// ============================================================================
// Controller
// ============================================================================

@ApiTags('ensemble')
@Controller('ensemble')
export class EnsembleController {
  constructor(private readonly ensembleService: EnsembleService) {}

  /**
   * Get ensemble status and configuration
   */
  @Get('status')
  @ApiOperation({ summary: 'Get ensemble retrieval status' })
  @ApiResponse({ status: 200, description: 'Ensemble status' })
  getStatus(): StatusResponse {
    const config = this.ensembleService.getConfig();
    return {
      enabled: this.ensembleService.isEnabled(),
      models: config.models,
      config,
    };
  }

  /**
   * Query memories using ensemble retrieval
   */
  @Post('query')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Query memories with multi-model ensemble' })
  @ApiResponse({ status: 200, description: 'Fused query results' })
  async query(@Body() dto: EnsembleQueryDto): Promise<EnsembleQueryResponse> {
    if (!this.ensembleService.isEnabled()) {
      throw new BadRequestException('Ensemble retrieval is not enabled');
    }

    if (!dto.query || !dto.userId) {
      throw new BadRequestException('query and userId are required');
    }

    const result = await this.ensembleService.query({
      query: dto.query,
      userId: dto.userId,
      limit: dto.limit,
      k: dto.k,
      models: dto.models,
      weights: dto.weights,
    });

    // Convert Map to object for JSON serialization
    return {
      ...result,
      results: result.results.map(r => ({
        ...r,
        modelScores: Object.fromEntries(r.modelScores) as Record<
          ModelId,
          { rank: number; score: number }
        >,
      })),
    };
  }

  /**
   * Upsert a memory with multi-model embeddings
   */
  @Post('upsert')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upsert memory with ensemble embeddings' })
  @ApiResponse({ status: 200, description: 'Memory upserted' })
  async upsert(@Body() dto: EnsembleUpsertDto): Promise<{ success: boolean }> {
    if (!this.ensembleService.isEnabled()) {
      throw new BadRequestException('Ensemble retrieval is not enabled');
    }

    if (!dto.memoryId || !dto.content || !dto.userId) {
      throw new BadRequestException('memoryId, content, and userId are required');
    }

    await this.ensembleService.upsert({
      memoryId: dto.memoryId,
      content: dto.content,
      userId: dto.userId,
      metadata: dto.metadata,
    });

    return { success: true };
  }

  /**
   * Compare ensemble vs single-model retrieval (debugging)
   */
  @Post('compare')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Compare ensemble vs single-model retrieval' })
  @ApiResponse({ status: 200, description: 'Comparison results' })
  async compare(@Body() dto: CompareQueryDto): Promise<{
    ensemble: EnsembleQueryResponse;
    singleModel: Record<ModelId, Array<{ memoryId: string; rank: number; score: number }>>;
  }> {
    if (!this.ensembleService.isEnabled()) {
      throw new BadRequestException('Ensemble retrieval is not enabled');
    }

    if (!dto.query || !dto.userId) {
      throw new BadRequestException('query and userId are required');
    }

    const result = await this.ensembleService.compare(
      dto.query,
      dto.userId,
      dto.limit ?? 10
    );

    return {
      ensemble: {
        ...result.ensemble,
        results: result.ensemble.results.map(r => ({
          ...r,
          modelScores: Object.fromEntries(r.modelScores) as Record<
            ModelId,
            { rank: number; score: number }
          >,
        })),
      },
      singleModel: Object.fromEntries(
        Array.from(result.singleModel.entries()).map(([model, results]) => [
          model,
          results.map(r => ({ memoryId: r.memoryId, rank: r.rank, score: r.score })),
        ])
      ) as Record<ModelId, Array<{ memoryId: string; rank: number; score: number }>>,
    };
  }

  /**
   * Generate embeddings for text (utility endpoint)
   */
  @Post('embed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate embeddings for text' })
  @ApiResponse({ status: 200, description: 'Embeddings from all models' })
  async embed(@Body() dto: { text: string }): Promise<{
    embeddings: Array<{
      model: ModelId;
      dimensions: number;
      latencyMs: number;
    }>;
    totalMs: number;
  }> {
    if (!dto.text) {
      throw new BadRequestException('text is required');
    }

    const result = await this.ensembleService.embedAll(dto.text);

    return {
      embeddings: result.embeddings.map(e => ({
        model: e.model,
        dimensions: e.dimensions,
        latencyMs: e.latencyMs,
        // Note: Not returning actual vectors to keep response small
      })),
      totalMs: result.totalMs,
    };
  }
}
