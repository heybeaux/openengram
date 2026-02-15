import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { HierarchyService, AggregatedSearchResult } from './hierarchy.service';
import {
  QueryRouterService,
  QueryAnalysis,
  HierarchyLevel,
} from './query-router.service';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';
import { UserId } from '../common/decorators/user-id.decorator';
import {
  HierarchySearchDto,
  HierarchyQueryAnalyzeDto,
} from './dto/hierarchy.dto';

/**
 * Hierarchy Controller
 *
 * Provides endpoints for hierarchical embeddings:
 * - Search across hierarchy levels
 * - Analyze query for routing
 * - Get hierarchy statistics
 */
@Controller('v1/hierarchy')
@UseGuards(ApiKeyOrJwtGuard)
export class HierarchyController {
  constructor(
    private readonly hierarchyService: HierarchyService,
    private readonly queryRouter: QueryRouterService,
  ) {}

  /**
   * POST /v1/hierarchy/search
   * Search across hierarchy levels with automatic routing
   */
  @Post('search')
  async search(
    @UserId() userId: string,
    @Body() dto: HierarchySearchDto,
  ): Promise<AggregatedSearchResult> {
    return this.hierarchyService.search(dto.query, userId, {
      levels: dto.levels as HierarchyLevel[],
      routing: dto.routing,
      topK: dto.topK,
    });
  }

  /**
   * POST /v1/hierarchy/analyze
   * Analyze a query to determine optimal routing
   */
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  async analyzeQuery(
    @Body() dto: HierarchyQueryAnalyzeDto,
  ): Promise<QueryAnalysis> {
    return this.queryRouter.analyze(dto.query);
  }

  /**
   * GET /v1/hierarchy/stats
   * Get hierarchy statistics for the current user
   */
  @Get('stats')
  async getStats(@UserId() userId: string): Promise<{
    totalUnits: number;
    byLevel: Record<string, number>;
    lastUpdated: Date | null;
    enabled: boolean;
  }> {
    const stats = await this.hierarchyService.getStats(userId);
    return {
      ...stats,
      enabled: this.hierarchyService.isEnabled(),
    };
  }

  /**
   * GET /v1/hierarchy/memory/:memoryId
   * Get hierarchy units for a specific memory
   */
  @Get('memory/:memoryId')
  async getUnitsForMemory(@Param('memoryId') memoryId: string): Promise<{
    memoryId: string;
    units: Array<{
      id: string;
      level: string;
      text: string;
      position: number | null;
      charStart: number | null;
      charEnd: number | null;
    }>;
  }> {
    const units = await this.hierarchyService.getUnitsForMemory(memoryId);

    return {
      memoryId,
      units: units.map((u) => ({
        id: u.id,
        level: u.level,
        text: u.text,
        position: u.position,
        charStart: u.charStart,
        charEnd: u.charEnd,
      })),
    };
  }

  /**
   * POST /v1/hierarchy/reprocess
   * Reprocess all memories for the current user
   * (Admin/maintenance endpoint)
   */
  @Post('reprocess')
  async reprocessUser(
    @UserId() userId: string,
    @Query('batchSize') batchSize?: string,
  ): Promise<{
    processed: number;
    failed: number;
  }> {
    return this.hierarchyService.reprocessUser(userId, {
      batchSize: batchSize ? parseInt(batchSize, 10) : undefined,
    });
  }

  /**
   * GET /v1/hierarchy/status
   * Get hierarchy module status
   */
  @Get('status')
  async getStatus(): Promise<{
    enabled: boolean;
    levels: string[];
    phase: string;
  }> {
    return {
      enabled: this.hierarchyService.isEnabled(),
      levels: ['L0', 'L1'], // MVP levels
      phase: 'MVP (Phase 1)',
    };
  }
}
