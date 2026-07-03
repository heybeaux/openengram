import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CapabilityEntry, CapabilityDelta } from './identity.types';

/**
 * HEY-172: Capability Delta Tracking
 *
 * Tracks how agent capabilities change over time by comparing
 * capability snapshots at intervals to detect growth trajectories.
 */
@Injectable()
export class CapabilityDeltaService {
  /** Minimum evidence count to consider something a capability */
  private static readonly MIN_EVIDENCE = 2;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build a capability snapshot from trust signals and store it as a checkpoint.
   */
  async createCheckpoint(
    userId: string,
    opts?: { agentId?: string },
  ): Promise<CapabilityEntry[]> {
    const where: Record<string, unknown> = { userId };
    if (opts?.agentId) where.agentId = opts.agentId;

    // Aggregate successful signals by category
    const signals = await this.prisma.trustSignal.findMany({
      where: {
        ...where,
        signalType: 'SUCCESS',
        category: { not: null },
      },
      select: { category: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    // Group by category
    const categoryMap = new Map<
      string,
      { count: number; firstSeen: Date; lastSeen: Date }
    >();

    for (const signal of signals) {
      if (!signal.category) continue;
      const existing = categoryMap.get(signal.category);
      if (existing) {
        existing.count++;
        if (signal.createdAt > existing.lastSeen)
          existing.lastSeen = signal.createdAt;
      } else {
        categoryMap.set(signal.category, {
          count: 1,
          firstSeen: signal.createdAt,
          lastSeen: signal.createdAt,
        });
      }
    }

    // Filter to entries with sufficient evidence
    const capabilities: CapabilityEntry[] = [];
    for (const [name, data] of categoryMap) {
      if (data.count >= CapabilityDeltaService.MIN_EVIDENCE) {
        capabilities.push({
          name,
          evidenceCount: data.count,
          firstSeen: data.firstSeen.toISOString(),
          lastSeen: data.lastSeen.toISOString(),
        });
      }
    }

    // Store checkpoint
    await this.prisma.capabilityCheckpoint.create({
      data: {
        userId,
        agentId: opts?.agentId,
        capabilities: capabilities as unknown as any,
      },
    });

    return capabilities;
  }

  /**
   * Compare the latest checkpoint against a previous one to detect deltas.
   * Answers: "What can this agent do now that it couldn't do before?"
   */
  async computeDelta(
    userId: string,
    opts?: { agentId?: string; sinceDate?: Date },
  ): Promise<CapabilityDelta> {
    const where: Record<string, unknown> = { userId };
    if (opts?.agentId) where.agentId = opts.agentId;

    // Get the two most recent checkpoints, or compare against a specific date
    const checkpoints = await this.prisma.capabilityCheckpoint.findMany({
      where,
      orderBy: { checkpointAt: 'desc' },
      take: 2,
    });

    if (checkpoints.length === 0) {
      return {
        gained: [],
        improved: [],
        period: { from: new Date(), to: new Date() },
      };
    }

    const current = checkpoints[0];
    const currentCaps = current.capabilities as unknown as CapabilityEntry[];
    const currentMap = new Map(currentCaps.map((c) => [c.name, c]));

    if (checkpoints.length < 2) {
      // Everything is new
      return {
        gained: currentCaps,
        improved: [],
        period: { from: current.checkpointAt, to: current.checkpointAt },
      };
    }

    const previous = checkpoints[1];
    const previousCaps = previous.capabilities as unknown as CapabilityEntry[];
    const previousMap = new Map(previousCaps.map((c) => [c.name, c]));

    const gained: CapabilityEntry[] = [];
    const improved: CapabilityDelta['improved'] = [];

    for (const [name, cap] of currentMap) {
      const prev = previousMap.get(name);
      if (!prev) {
        gained.push(cap);
      } else if (cap.evidenceCount > prev.evidenceCount) {
        improved.push({
          name,
          previousCount: prev.evidenceCount,
          currentCount: cap.evidenceCount,
        });
      }
    }

    return {
      gained,
      improved,
      period: { from: previous.checkpointAt, to: current.checkpointAt },
    };
  }

  /**
   * Get the latest capability snapshot without creating a new checkpoint.
   */
  async getLatestCapabilities(
    userId: string,
    opts?: { agentId?: string },
  ): Promise<CapabilityEntry[]> {
    const where: Record<string, unknown> = { userId };
    if (opts?.agentId) where.agentId = opts.agentId;

    const latest = await this.prisma.capabilityCheckpoint.findFirst({
      where,
      orderBy: { checkpointAt: 'desc' },
    });

    if (!latest) return [];
    return latest.capabilities as unknown as CapabilityEntry[];
  }
}
