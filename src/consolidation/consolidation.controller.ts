import { Controller, Post, Query, Body, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DreamCycleService, DreamCycleStage, DreamCycleResult } from './dream-cycle.service';
import { GenerateContextService } from './generate-context.service';
import type { GenerateContextOptions, GenerateContextResult } from './generate-context.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Consolidation')
@Controller('v1/consolidation')
export class ConsolidationController {
  constructor(
    private dreamCycle: DreamCycleService,
    private generateContext: GenerateContextService,
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

  @Post('generate-context')
  async generateContextEndpoint(
    @Body() body: GenerateContextOptions,
  ): Promise<GenerateContextResult> {
    return this.generateContext.generate(body);
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
