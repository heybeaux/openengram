import { Controller, Post, Query, Body, Get } from '@nestjs/common';
import { DreamCycleService, DreamCycleStage, DreamCycleResult } from './dream-cycle.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('v1/consolidation')
export class ConsolidationController {
  constructor(
    private dreamCycle: DreamCycleService,
    private prisma: PrismaService,
  ) {}

  @Post('dream-cycle')
  async runDreamCycle(
    @Query('dryRun') dryRun?: string,
    @Body() body?: { stages?: DreamCycleStage[]; userId?: string; maxMemories?: number },
  ): Promise<DreamCycleResult> {
    return this.dreamCycle.run({
      dryRun: dryRun === 'true' || dryRun === '1',
      stages: body?.stages,
      userId: body?.userId,
      maxMemories: body?.maxMemories,
    });
  }

  @Get('dream-cycle/reports')
  async getReports(
    @Query('userId') userId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.prisma.dreamCycleReport.findMany({
      where: userId ? { userId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit || '10', 10),
    });
  }
}
