import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { FogIndexService, FogIndexResult } from './fog-index.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@UseGuards(ApiKeyGuard)
@Controller('v1/fog-index')
export class FogIndexController {
  constructor(private fogIndex: FogIndexService) {}

  @Get()
  async getCurrent(@Query('userId') userId?: string): Promise<FogIndexResult> {
    return this.fogIndex.compute(userId);
  }

  @Get('history')
  async getHistory(
    @Query('limit') limit?: string,
  ): Promise<Array<{ score: number; tier: string; computedAt: string }>> {
    return this.fogIndex.getHistory(parseInt(limit || '30', 10));
  }

  @Get('snapshot')
  async takeSnapshot(
    @Query('userId') userId?: string,
  ): Promise<FogIndexResult> {
    return this.fogIndex.snapshot(userId);
  }
}
