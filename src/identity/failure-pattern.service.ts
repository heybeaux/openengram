import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryLayer, MemorySource } from '@prisma/client';

/**
 * HEY-187: Failure Pattern Detection
 *
 * Analyzes task outcomes and trust signals to detect recurring failure patterns.
 * Groups failures by: capability area, time of day, task type, collaboration partner.
 * Surfaces patterns as INSIGHT memories for the Waking Cycle.
 */

export interface FailurePattern {
  type: 'capability' | 'time_of_day' | 'task_type' | 'collaboration';
  key: string;
  failureCount: number;
  totalCount: number;
  failureRate: number;
  recentFailures: Array<{ context: string; createdAt: Date }>;
  insight: string;
}

export interface FailureAnalysis {
  patterns: FailurePattern[];
  insightsCreated: number;
}

@Injectable()
export class FailurePatternService {
  private readonly logger = new Logger(FailurePatternService.name);

  /** Minimum failures needed to flag a pattern */
  private static readonly MIN_FAILURES = 3;
  /** Minimum failure rate to flag */
  private static readonly MIN_FAILURE_RATE = 0.4;
  /** Lookback window in days */
  private static readonly LOOKBACK_DAYS = 30;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Analyze failure patterns for a user/agent and create INSIGHT memories.
   */
  async analyze(
    userId: string,
    opts?: { agentId?: string; storeInsights?: boolean },
  ): Promise<FailureAnalysis> {
    const since = new Date(
      Date.now() - FailurePatternService.LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );

    // Fetch trust signals (failures and successes)
    const signals = await this.prisma.trustSignal.findMany({
      where: {
        userId,
        ...(opts?.agentId ? { agentId: opts.agentId } : {}),
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Also fetch task outcome memories for richer context
    const taskOutcomes = await this.prisma.memory.findMany({
      where: {
        userId,
        memoryType: 'TASK_OUTCOME',
        deletedAt: null,
        createdAt: { gte: since },
        ...(opts?.agentId ? { agentId: opts.agentId } : {}),
      },
      include: { extraction: true },
    });

    const patterns: FailurePattern[] = [];

    // ── 1. Group by capability/category ───────────────────────────────
    patterns.push(...this.detectCategoryPatterns(signals));

    // ── 2. Group by time of day ───────────────────────────────────────
    patterns.push(...this.detectTimePatterns(signals));

    // ── 3. Group by task type (from memories) ─────────────────────────
    patterns.push(...this.detectTaskTypePatterns(taskOutcomes));

    // ── 4. Group by collaboration partner ─────────────────────────────
    patterns.push(...this.detectCollaborationPatterns(signals));

    // Store insights if requested
    let insightsCreated = 0;
    if (opts?.storeInsights !== false && patterns.length > 0) {
      insightsCreated = await this.storePatternInsights(userId, patterns, opts?.agentId);
    }

    return { patterns, insightsCreated };
  }

  private detectCategoryPatterns(signals: any[]): FailurePattern[] {
    const byCategory = new Map<string, { failures: any[]; total: number }>();

    for (const signal of signals) {
      const cat = signal.category ?? 'uncategorized';
      if (!byCategory.has(cat)) byCategory.set(cat, { failures: [], total: 0 });
      const entry = byCategory.get(cat)!;
      entry.total++;
      if (signal.signalType === 'FAILURE') {
        entry.failures.push(signal);
      }
    }

    const patterns: FailurePattern[] = [];
    for (const [category, data] of byCategory) {
      if (
        data.failures.length >= FailurePatternService.MIN_FAILURES &&
        data.failures.length / data.total >= FailurePatternService.MIN_FAILURE_RATE
      ) {
        const rate = data.failures.length / data.total;
        patterns.push({
          type: 'capability',
          key: category,
          failureCount: data.failures.length,
          totalCount: data.total,
          failureRate: rate,
          recentFailures: data.failures.slice(0, 5).map((f: any) => ({
            context: f.context,
            createdAt: f.createdAt,
          })),
          insight: `Recurring failures in ${category}: ${data.failures.length} of ${data.total} tasks failed (${(rate * 100).toFixed(0)}% failure rate). Consider delegating or reviewing approach.`,
        });
      }
    }

    return patterns;
  }

  private detectTimePatterns(signals: any[]): FailurePattern[] {
    const timeSlots = ['morning (6-12)', 'afternoon (12-18)', 'evening (18-24)', 'night (0-6)'];
    const getSlot = (hour: number): number => {
      if (hour >= 6 && hour < 12) return 0;
      if (hour >= 12 && hour < 18) return 1;
      if (hour >= 18) return 2;
      return 3;
    };

    const byTime = [
      { failures: [] as any[], total: 0 },
      { failures: [] as any[], total: 0 },
      { failures: [] as any[], total: 0 },
      { failures: [] as any[], total: 0 },
    ];

    for (const signal of signals) {
      const slot = getSlot(new Date(signal.createdAt).getHours());
      byTime[slot].total++;
      if (signal.signalType === 'FAILURE') {
        byTime[slot].failures.push(signal);
      }
    }

    const patterns: FailurePattern[] = [];
    for (let i = 0; i < 4; i++) {
      const data = byTime[i];
      if (
        data.failures.length >= FailurePatternService.MIN_FAILURES &&
        data.failures.length / data.total >= FailurePatternService.MIN_FAILURE_RATE
      ) {
        const rate = data.failures.length / data.total;
        patterns.push({
          type: 'time_of_day',
          key: timeSlots[i],
          failureCount: data.failures.length,
          totalCount: data.total,
          failureRate: rate,
          recentFailures: data.failures.slice(0, 5).map((f: any) => ({
            context: f.context,
            createdAt: f.createdAt,
          })),
          insight: `Higher failure rate during ${timeSlots[i]}: ${data.failures.length} of ${data.total} tasks (${(rate * 100).toFixed(0)}%).`,
        });
      }
    }

    return patterns;
  }

  private detectTaskTypePatterns(memories: any[]): FailurePattern[] {
    const byType = new Map<string, { failures: any[]; total: number }>();

    for (const memory of memories) {
      const meta = memory.metadata as any;
      const outcome = meta?.outcome ?? (memory.raw.includes('failure') ? 'failure' : 'success');
      const taskType = memory.extraction?.topics?.[0] ?? 'unknown';

      if (!byType.has(taskType)) byType.set(taskType, { failures: [], total: 0 });
      const entry = byType.get(taskType)!;
      entry.total++;
      if (outcome === 'failure' || outcome === 'partial') {
        entry.failures.push(memory);
      }
    }

    const patterns: FailurePattern[] = [];
    for (const [taskType, data] of byType) {
      if (
        data.failures.length >= FailurePatternService.MIN_FAILURES &&
        data.failures.length / data.total >= FailurePatternService.MIN_FAILURE_RATE
      ) {
        const rate = data.failures.length / data.total;
        patterns.push({
          type: 'task_type',
          key: taskType,
          failureCount: data.failures.length,
          totalCount: data.total,
          failureRate: rate,
          recentFailures: data.failures.slice(0, 5).map((m: any) => ({
            context: m.raw.slice(0, 200),
            createdAt: m.createdAt,
          })),
          insight: `Repeated failures in ${taskType} tasks: ${data.failures.length} of ${data.total} (${(rate * 100).toFixed(0)}% failure rate).`,
        });
      }
    }

    return patterns;
  }

  private detectCollaborationPatterns(signals: any[]): FailurePattern[] {
    // Group by agentId to detect agents that co-occur with failures
    const byAgent = new Map<string, { failures: any[]; total: number }>();

    for (const signal of signals) {
      const partner = signal.agentId ?? 'solo';
      if (!byAgent.has(partner)) byAgent.set(partner, { failures: [], total: 0 });
      const entry = byAgent.get(partner)!;
      entry.total++;
      if (signal.signalType === 'FAILURE') {
        entry.failures.push(signal);
      }
    }

    const patterns: FailurePattern[] = [];
    for (const [agent, data] of byAgent) {
      if (
        agent !== 'solo' &&
        data.failures.length >= FailurePatternService.MIN_FAILURES &&
        data.failures.length / data.total >= FailurePatternService.MIN_FAILURE_RATE
      ) {
        const rate = data.failures.length / data.total;
        patterns.push({
          type: 'collaboration',
          key: agent,
          failureCount: data.failures.length,
          totalCount: data.total,
          failureRate: rate,
          recentFailures: data.failures.slice(0, 5).map((f: any) => ({
            context: f.context,
            createdAt: f.createdAt,
          })),
          insight: `Agent ${agent} has a ${(rate * 100).toFixed(0)}% failure rate over ${data.total} tasks — consider different task assignment or pairing.`,
        });
      }
    }

    return patterns;
  }

  /**
   * Store detected patterns as INSIGHT memories.
   */
  private async storePatternInsights(
    userId: string,
    patterns: FailurePattern[],
    agentId?: string,
  ): Promise<number> {
    let created = 0;

    for (const pattern of patterns) {
      try {
        // Check for recent duplicate insight
        const recent = await this.prisma.memory.findFirst({
          where: {
            userId,
            layer: MemoryLayer.INSIGHT,
            deletedAt: null,
            createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
            metadata: {
              path: ['failurePattern', 'type'],
              equals: pattern.type,
            },
          },
        });

        // Skip if we already surfaced this pattern type + key recently
        if (recent) {
          const meta = recent.metadata as any;
          if (meta?.failurePattern?.key === pattern.key) continue;
        }

        await this.prisma.memory.create({
          data: {
            userId,
            raw: pattern.insight,
            layer: MemoryLayer.INSIGHT,
            memoryType: 'LESSON',
            source: MemorySource.PATTERN_DETECTED,
            subjectType: agentId ? 'AGENT' : 'USER',
            agentId: agentId ?? null,
            importanceScore: Math.min(0.9, 0.6 + pattern.failureRate * 0.3),
            confidence: Math.min(pattern.failureCount / 10, 1.0),
            metadata: {
              failurePattern: {
                type: pattern.type,
                key: pattern.key,
                failureCount: pattern.failureCount,
                totalCount: pattern.totalCount,
                failureRate: pattern.failureRate,
              },
              actionable: true,
              insightType: 'failure_pattern',
            },
          },
        });
        created++;
      } catch (error) {
        this.logger.warn(`Failed to store pattern insight: ${error.message}`);
      }
    }

    if (created > 0) {
      this.logger.log(`Stored ${created} failure pattern insights for user ${userId}`);
    }

    return created;
  }
}
