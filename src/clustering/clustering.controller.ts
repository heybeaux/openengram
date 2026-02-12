import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import type {
  ClusteringRunOptions,
  ClusteringRunResult,
  ClusterSummary,
  ClusterDetail,
} from './clustering.service';
import { ClusteringService } from './clustering.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@UseGuards(ApiKeyGuard)
@Controller('v1/clustering')
export class ClusteringController {
  constructor(private clusteringService: ClusteringService) {}

  @Post('run')
  async run(
    @Body() body?: ClusteringRunOptions,
    @Query('dryRun') dryRun?: string,
  ): Promise<ClusteringRunResult> {
    return this.clusteringService.run({
      ...body,
      dryRun: dryRun === 'true' || dryRun === '1' || body?.dryRun,
    });
  }

  @Get('clusters')
  async listClusters(): Promise<ClusterSummary[]> {
    return this.clusteringService.listClusters();
  }

  @Get('clusters/:id')
  async getCluster(@Param('id') id: string): Promise<ClusterDetail> {
    const cluster = await this.clusteringService.getCluster(id);
    if (!cluster) {
      throw new NotFoundException(`Cluster ${id} not found`);
    }
    return cluster;
  }
}
