import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmbedHealthService } from './embed-health.service';

@Controller('health')
export class HealthController {
  private readonly startTime = Date.now();

  constructor(
    private prisma: PrismaService,
    private embedHealth: EmbedHealthService,
  ) {}

  @Get()
  async check(): Promise<any> {
    const start = Date.now();

    // 1. Database health
    let dbStatus: 'up' | 'down' = 'down';
    let dbLatencyMs: number | null = null;
    let memoryCount: number | null = null;

    try {
      const dbStart = Date.now();
      memoryCount = await this.prisma.memory.count({ where: { deletedAt: null } });
      dbLatencyMs = Date.now() - dbStart;
      dbStatus = 'up';
    } catch {
      dbStatus = 'down';
    }

    // 2. engram-embed health (cached)
    const embedStatus = await this.embedHealth.getStatus();

    // 3. Last Dream Cycle run
    let lastDreamCycle: { completedAt: Date | null; status: string } | null = null;
    try {
      const report = await this.prisma.dreamCycleReport.findFirst({
        orderBy: { startedAt: 'desc' },
        select: { completedAt: true, status: true },
      });
      lastDreamCycle = report;
    } catch {
      // table might not exist yet
    }

    // Determine overall status
    const overallStatus = dbStatus === 'down' ? 'unhealthy' : embedStatus.status === 'down' ? 'degraded' : 'healthy';

    const body = {
      status: overallStatus,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      dependencies: {
        database: {
          status: dbStatus,
          latencyMs: dbLatencyMs,
          memoryCount,
        },
        engramEmbed: {
          status: embedStatus.status,
          latencyMs: embedStatus.latencyMs,
          lastUp: embedStatus.lastUp?.toISOString() ?? null,
        },
      },
      dreamCycle: lastDreamCycle
        ? {
            lastRun: lastDreamCycle.completedAt?.toISOString() ?? null,
            status: lastDreamCycle.status,
          }
        : null,
      memory: {
        heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
      },
      checkedIn: `${Date.now() - start}ms`,
    };

    if (dbStatus === 'down') {
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }

    return body;
  }
}
