import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';
import { Agent } from '../common/decorators/user-id.decorator';
import { TimelineQueryDto, TimelineResponse } from './dto/timeline-query.dto';
import {
  TypeBreakdownQueryDto,
  TypeBreakdownResponse,
  LayerBreakdownQueryDto,
  LayerDistributionResponse,
} from './dto/breakdown-query.dto';
import { AnalyticsSummaryResponse } from './dto/summary.dto';

@Controller('v1/analytics')
@UseGuards(ApiKeyOrJwtGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * GET /v1/analytics/timeline
   * Memory creation timeline with configurable granularity
   */
  @Get('timeline')
  async getTimeline(
    @Agent() agent: any,
    @Query() dto: TimelineQueryDto,
  ): Promise<TimelineResponse> {
    return this.analyticsService.getTimeline(agent.id, dto);
  }

  /**
   * GET /v1/analytics/breakdown/type
   * Memory count breakdown by type over time
   */
  @Get('breakdown/type')
  async getTypeBreakdown(
    @Agent() agent: any,
    @Query() dto: TypeBreakdownQueryDto,
  ): Promise<TypeBreakdownResponse> {
    return this.analyticsService.getTypeBreakdown(agent.id, dto);
  }

  /**
   * GET /v1/analytics/breakdown/layer
   * Memory count breakdown by layer
   */
  @Get('breakdown/layer')
  async getLayerBreakdown(
    @Agent() agent: any,
    @Query() dto: LayerBreakdownQueryDto,
  ): Promise<LayerDistributionResponse> {
    return this.analyticsService.getLayerDistribution(agent.id, dto);
  }

  /**
   * GET /v1/analytics/summary
   * Aggregated analytics summary for dashboard
   */
  @Get('summary')
  async getSummary(@Agent() agent: any): Promise<AnalyticsSummaryResponse> {
    return this.analyticsService.getSummary(agent.id);
  }
}
