import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { MultiQueryService } from './multi-query.service';
import { QueryExpansionService } from './query-expansion.service';
import {
  ExpandQueryDto,
  QueryExpansionResultDto,
  ExpansionStrategy,
} from './dto/multi-query.dto';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';

/**
 * Multi-Query Controller
 *
 * Debug and testing endpoints for multi-query retrieval.
 * The main search integration happens through MemoryController.
 *
 * Endpoints:
 * - GET /v1/multi-query/enabled - Check if multi-query is enabled
 * - POST /v1/multi-query/expand - Preview query expansion
 */
@ApiTags('multi-query')
@UseGuards(ApiKeyOrJwtGuard)
@Controller('v1/multi-query')
export class MultiQueryController {
  constructor(
    private multiQueryService: MultiQueryService,
    private expansionService: QueryExpansionService,
  ) {}

  /**
   * Check if multi-query retrieval is enabled
   */
  @Get('enabled')
  @ApiOperation({ summary: 'Check if multi-query is enabled' })
  @ApiResponse({ status: 200 })
  isEnabled(): { enabled: boolean; version: string } {
    return {
      enabled: this.multiQueryService.isEnabled(),
      version: '1.0.0',
    };
  }

  /**
   * Preview query expansion without performing search
   *
   * Useful for debugging and testing expansion rules.
   */
  @Post('expand')
  @ApiOperation({ summary: 'Expand a query into variants (for debugging)' })
  @ApiResponse({ status: 200, type: QueryExpansionResultDto })
  async expandQuery(
    @Body() dto: ExpandQueryDto,
  ): Promise<QueryExpansionResultDto> {
    if (!dto.query || dto.query.trim().length === 0) {
      throw new HttpException('Query is required', HttpStatus.BAD_REQUEST);
    }

    try {
      const result = await this.expansionService.expand(dto.query, {
        strategy: (dto.strategy ?? ExpansionStrategy.HYBRID) as any,
        maxVariants: dto.maxVariants ?? 7,
      });

      return {
        original: result.original,
        variants: result.variants,
        sources: result.sources,
        timings: result.timings,
        llmUsed: result.llmUsed,
      };
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to expand query',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get expansion rules info (for debugging)
   */
  @Get('rules')
  @ApiOperation({ summary: 'Get information about expansion rules' })
  @ApiResponse({ status: 200 })
  getRulesInfo(): {
    synonymGroups: number;
    relatedConcepts: number;
    patternRules: number;
    strategies: string[];
  } {
    // Import rules dynamically to get counts
    const {
      SYNONYM_GROUPS,
      RELATED_CONCEPTS,
      PATTERN_RULES,
    } = require('./expansion-rules');

    return {
      synonymGroups: Object.keys(SYNONYM_GROUPS).length,
      relatedConcepts: Object.keys(RELATED_CONCEPTS).length,
      patternRules: PATTERN_RULES.length,
      strategies: Object.values(ExpansionStrategy),
    };
  }

  /**
   * Test expansion with different strategies
   */
  @Post('test')
  @ApiOperation({ summary: 'Test expansion with all strategies' })
  @ApiResponse({ status: 200 })
  async testExpansion(@Body() dto: { query: string }): Promise<{
    query: string;
    results: Record<
      string,
      {
        variants: string[];
        count: number;
        timeMs: number;
        llmUsed: boolean;
      }
    >;
  }> {
    if (!dto.query || dto.query.trim().length === 0) {
      throw new HttpException('Query is required', HttpStatus.BAD_REQUEST);
    }

    const results: Record<
      string,
      {
        variants: string[];
        count: number;
        timeMs: number;
        llmUsed: boolean;
      }
    > = {};

    for (const strategy of Object.values(ExpansionStrategy)) {
      try {
        const result = await this.expansionService.expand(dto.query, {
          strategy,
          maxVariants: 10,
          llm: {
            temperature: 0.3,
            enabled: strategy !== ExpansionStrategy.RULES,
            fallbackOnly: strategy === ExpansionStrategy.HYBRID,
            timeoutMs: 2000,
          },
        });

        results[strategy] = {
          variants: result.variants,
          count: result.variants.length,
          timeMs: result.timings.totalMs,
          llmUsed: result.llmUsed,
        };
      } catch (error) {
        results[strategy] = {
          variants: [dto.query],
          count: 1,
          timeMs: 0,
          llmUsed: false,
        };
      }
    }

    return { query: dto.query, results };
  }
}
