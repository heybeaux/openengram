import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface MonitoringMetrics {
  embeddingFailures: {
    countLastHour: number;
    byModel: Record<string, number>;
  };
  memoryCount: {
    current: number;
    previousSnapshot: number | null;
    delta: number | null;
  };
  apiErrors: {
    count5xxLastHour: number;
  };
  dreamCycle: {
    lastSuccessfulRun: string | null;
    lastDurationMs: number | null;
    lastStatus: string | null;
  };
  snapshotAt: string;
}

export interface MonitoringAlert {
  level: 'warning' | 'critical';
  type: string;
  message: string;
  value: number;
  threshold: number;
  detectedAt: string;
}

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  // In-memory counters (reset hourly by snapshot)
  private embeddingFailures: Array<{ model: string; timestamp: Date }> = [];
  private apiErrors5xx: Array<{
    timestamp: Date;
    statusCode: number;
    path: string;
  }> = [];

  constructor(private readonly prisma: PrismaService) {}

  /** Record an embedding failure */
  recordEmbeddingFailure(model: string): void {
    this.embeddingFailures.push({ model, timestamp: new Date() });
    // Prune entries older than 2 hours
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    this.embeddingFailures = this.embeddingFailures.filter(
      (f) => f.timestamp.getTime() > cutoff,
    );
  }

  /** Record a 5xx API error */
  recordApiError(statusCode: number, path: string): void {
    this.apiErrors5xx.push({ timestamp: new Date(), statusCode, path });
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    this.apiErrors5xx = this.apiErrors5xx.filter(
      (e) => e.timestamp.getTime() > cutoff,
    );
  }

  /** Get current metrics */
  async getMetrics(): Promise<MonitoringMetrics> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // Embedding failures in last hour
    const recentFailures = this.embeddingFailures.filter(
      (f) => f.timestamp >= oneHourAgo,
    );
    const byModel: Record<string, number> = {};
    for (const f of recentFailures) {
      byModel[f.model] = (byModel[f.model] || 0) + 1;
    }

    // Memory count
    let currentCount = 0;
    try {
      currentCount = await this.prisma.memory.count({
        where: { deletedAt: null },
      });
    } catch (e) {
      this.logger.warn('Failed to count memories', e);
    }

    // Previous snapshot for delta comparison
    let previousSnapshot: number | null = null;
    try {
      const lastSnapshot = await this.prisma.monitoringSnapshot.findFirst({
        orderBy: { snapshotAt: 'desc' },
      });
      if (lastSnapshot) {
        const metrics = lastSnapshot.metrics as any;
        previousSnapshot = metrics?.memoryCount?.current ?? null;
      }
    } catch {
      // table might not exist yet
    }

    // Dream cycle
    let dreamCycle: MonitoringMetrics['dreamCycle'] = {
      lastSuccessfulRun: null,
      lastDurationMs: null,
      lastStatus: null,
    };
    try {
      const lastRun = await this.prisma.dreamCycleReport.findFirst({
        orderBy: { startedAt: 'desc' },
        select: { completedAt: true, durationMs: true, status: true },
      });
      if (lastRun) {
        dreamCycle = {
          lastSuccessfulRun:
            lastRun.status === 'COMPLETED'
              ? (lastRun.completedAt?.toISOString() ?? null)
              : null,
          lastDurationMs: lastRun.durationMs,
          lastStatus: lastRun.status,
        };
      }
    } catch {
      // table might not exist yet
    }

    // API errors in last hour
    const recent5xx = this.apiErrors5xx.filter(
      (e) => e.timestamp >= oneHourAgo,
    );

    return {
      embeddingFailures: {
        countLastHour: recentFailures.length,
        byModel,
      },
      memoryCount: {
        current: currentCount,
        previousSnapshot,
        delta:
          previousSnapshot !== null ? currentCount - previousSnapshot : null,
      },
      apiErrors: {
        count5xxLastHour: recent5xx.length,
      },
      dreamCycle,
      snapshotAt: new Date().toISOString(),
    };
  }

  /** Evaluate alerts based on current metrics */
  async getAlerts(): Promise<MonitoringAlert[]> {
    const metrics = await this.getMetrics();
    const alerts: MonitoringAlert[] = [];
    const now = new Date().toISOString();

    // Alert: Embedding failure rate > 10% (if we have at least 10 failures)
    if (metrics.embeddingFailures.countLastHour > 10) {
      alerts.push({
        level: 'critical',
        type: 'embedding_failures',
        message: `High embedding failure rate: ${metrics.embeddingFailures.countLastHour} failures in the last hour`,
        value: metrics.embeddingFailures.countLastHour,
        threshold: 10,
        detectedAt: now,
      });
    }

    // Alert: Memory count dropped by > 100 in last snapshot interval
    if (
      metrics.memoryCount.delta !== null &&
      metrics.memoryCount.delta < -100
    ) {
      alerts.push({
        level: 'critical',
        type: 'memory_count_drop',
        message: `Memory count dropped by ${Math.abs(metrics.memoryCount.delta)} since last snapshot (${metrics.memoryCount.previousSnapshot} → ${metrics.memoryCount.current})`,
        value: metrics.memoryCount.delta,
        threshold: -100,
        detectedAt: now,
      });
    }

    // Alert: High 5xx error rate
    if (metrics.apiErrors.count5xxLastHour > 50) {
      alerts.push({
        level: 'critical',
        type: 'api_error_rate',
        message: `High API error rate: ${metrics.apiErrors.count5xxLastHour} 5xx errors in the last hour`,
        value: metrics.apiErrors.count5xxLastHour,
        threshold: 50,
        detectedAt: now,
      });
    } else if (metrics.apiErrors.count5xxLastHour > 10) {
      alerts.push({
        level: 'warning',
        type: 'api_error_rate',
        message: `Elevated API error rate: ${metrics.apiErrors.count5xxLastHour} 5xx errors in the last hour`,
        value: metrics.apiErrors.count5xxLastHour,
        threshold: 10,
        detectedAt: now,
      });
    }

    // Alert: Dream cycle failed or stale
    if (metrics.dreamCycle.lastStatus === 'FAILED') {
      alerts.push({
        level: 'warning',
        type: 'dream_cycle_failed',
        message: 'Last Dream Cycle run failed',
        value: 1,
        threshold: 0,
        detectedAt: now,
      });
    }

    return alerts;
  }

  /** Take a snapshot and persist to database */
  async takeSnapshot(): Promise<void> {
    try {
      const metrics = await this.getMetrics();
      const alerts = await this.getAlerts();
      await this.prisma.monitoringSnapshot.create({
        data: {
          metrics: metrics as any,
          alerts: alerts as any,
        },
      });
      this.logger.log('Monitoring snapshot saved');
    } catch (e) {
      this.logger.warn('Failed to save monitoring snapshot', e);
    }
  }
}
