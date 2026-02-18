import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface FogIndexComponent {
  name: string;
  score: number; // 0-100
  weight: number;
  details: string;
}

export interface FogIndexResult {
  score: number; // 0-100
  tier: string;
  components: FogIndexComponent[];
  computedAt: string;
}

export interface FogScope {
  userId?: string;
  agentId?: string;
}

export type FogTier =
  | 'Crystal'
  | 'Clear'
  | 'Haze'
  | 'Mist'
  | 'Fog'
  | 'Dense Fog';

const TIERS: Array<{ min: number; name: FogTier }> = [
  { min: 90, name: 'Crystal' },
  { min: 75, name: 'Clear' },
  { min: 60, name: 'Haze' },
  { min: 40, name: 'Mist' },
  { min: 20, name: 'Fog' },
  { min: 0, name: 'Dense Fog' },
];

@Injectable()
export class FogIndexService {
  constructor(private prisma: PrismaService) {}

  static getTier(score: number): FogTier {
    for (const tier of TIERS) {
      if (score >= tier.min) return tier.name;
    }
    return 'Dense Fog';
  }

  /**
   * Build a Prisma `where` clause that scopes to the agent's memories.
   * Priority: explicit userId > agentId (all users) > fallback to most recent user.
   */
  private async resolveWhere(
    scope: FogScope,
  ): Promise<{ userId?: string; agentId?: string } | null> {
    if (scope.userId) return { userId: scope.userId };
    if (scope.agentId) return { agentId: scope.agentId };
    // Fallback: find the most recent memory's agent
    const mem = await this.prisma.memory.findFirst({
      where: { deletedAt: null },
      select: { agentId: true, userId: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!mem) return null;
    return mem.agentId ? { agentId: mem.agentId } : { userId: mem.userId };
  }

  async compute(scope: FogScope = {}): Promise<FogIndexResult> {
    const where = await this.resolveWhere(scope);
    if (!where) return this.emptyResult();

    const components = await Promise.all([
      this.memoryStaleness(where),
      this.embeddingCoverage(where),
      this.dedupDensity(where),
      this.consolidationHealth(),
      this.memoryDecayRate(where),
      this.coverageGaps(where),
    ]);

    const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
    const weightedScore =
      totalWeight > 0
        ? components.reduce((sum, c) => sum + c.score * c.weight, 0) /
          totalWeight
        : 0;

    const score =
      Math.round(Math.max(0, Math.min(100, weightedScore)) * 10) / 10;

    return {
      score,
      tier: FogIndexService.getTier(score),
      components,
      computedAt: new Date().toISOString(),
    };
  }

  async snapshot(scope: FogScope = {}): Promise<FogIndexResult> {
    const result = await this.compute(scope);

    try {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO fog_index_snapshots (id, score, tier, components, computed_at)
         VALUES (gen_random_uuid(), $1, $2, $3::jsonb, NOW())`,
        result.score,
        result.tier,
        JSON.stringify(result.components),
      );
    } catch (error) {
      console.warn('Failed to persist fog index snapshot:', error?.message);
    }

    return result;
  }

  async getHistory(
    limit = 30,
  ): Promise<Array<{ score: number; tier: string; computedAt: string }>> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{ score: number; tier: string; computed_at: Date }>
      >(
        `SELECT score, tier, computed_at FROM fog_index_snapshots
         ORDER BY computed_at DESC LIMIT $1`,
        limit,
      );

      return rows.map((r) => ({
        score: Number(r.score),
        tier: r.tier,
        computedAt: r.computed_at.toISOString(),
      }));
    } catch (error) {
      console.warn('Failed to query fog index history:', error?.message);
      return [];
    }
  }

  // ─── Components ──────────────────────────────────────────────────

  /** Build a Prisma memory filter from the scope */
  private memoryFilter(
    where: { userId?: string; agentId?: string },
    extra: Record<string, any> = {},
  ) {
    return {
      ...(where.userId ? { userId: where.userId } : {}),
      ...(where.agentId ? { agentId: where.agentId } : {}),
      deletedAt: null,
      ...extra,
    };
  }

  /** % of memories accessed (retrieved or used) in the last 7 days */
  private async memoryStaleness(
    where: { userId?: string; agentId?: string },
  ): Promise<FogIndexComponent> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const total = await this.prisma.memory.count({
      where: this.memoryFilter(where),
    });

    if (total === 0) {
      return {
        name: 'Memory Freshness',
        score: 50,
        weight: 25,
        details: 'No memories',
      };
    }

    const accessed = await this.prisma.memory.count({
      where: {
        ...this.memoryFilter(where),
        OR: [
          { lastRetrievedAt: { gte: sevenDaysAgo } },
          { lastUsedAt: { gte: sevenDaysAgo } },
          { createdAt: { gte: sevenDaysAgo } },
        ],
      },
    });

    const pct = (accessed / total) * 100;
    const score = Math.min(100, pct * 2);

    return {
      name: 'Memory Freshness',
      score: Math.round(score * 10) / 10,
      weight: 25,
      details: `${accessed}/${total} memories accessed in last 7 days (${pct.toFixed(1)}%)`,
    };
  }

  /** % of memories with valid embeddings (legacy + ensemble) */
  private async embeddingCoverage(
    where: { userId?: string; agentId?: string },
  ): Promise<FogIndexComponent> {
    const total = await this.prisma.memory.count({
      where: this.memoryFilter(where),
    });

    if (total === 0) {
      return {
        name: 'Embedding Coverage',
        score: 50,
        weight: 20,
        details: 'No memories',
      };
    }

    const withLegacy = await this.prisma.memory.count({
      where: this.memoryFilter(where, { embeddingId: { not: null } }),
    });

    // For agent-scoped queries, build the SQL condition dynamically
    const scopeCol = where.agentId ? 'agent_id' : 'user_id';
    const scopeVal = where.agentId ?? where.userId;

    const withEnsemble = await this.prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(DISTINCT me.memory_id) as count
       FROM memory_embeddings me
       JOIN memories m ON m.id = me.memory_id
       WHERE m.${scopeCol} = $1 AND m.deleted_at IS NULL`,
      scopeVal,
    );

    const ensembleCount = Number(withEnsemble[0]?.count ?? 0);
    const covered = Math.max(withLegacy, ensembleCount);
    const pct = (covered / total) * 100;

    return {
      name: 'Embedding Coverage',
      score: Math.round(pct * 10) / 10,
      weight: 20,
      details: `${covered}/${total} memories have embeddings (${pct.toFixed(1)}%)`,
    };
  }

  /** Near-duplicate density — lower is better */
  private async dedupDensity(
    where: { userId?: string; agentId?: string },
  ): Promise<FogIndexComponent> {
    const total = await this.prisma.memory.count({
      where: this.memoryFilter(where),
    });

    if (total === 0) {
      return {
        name: 'Dedup Health',
        score: 100,
        weight: 15,
        details: 'No memories',
      };
    }

    // merge_candidates may only have userId — scope by userId if available,
    // otherwise get all userIds for this agent
    let pendingDups: number;
    if (where.userId) {
      pendingDups = await this.prisma.mergeCandidate.count({
        where: { userId: where.userId, status: 'PENDING' },
      });
    } else if (where.agentId) {
      const users = await this.prisma.user.findMany({
        where: { agentId: where.agentId, deletedAt: null },
        select: { id: true },
      });
      const userIds = users.map((u) => u.id);
      pendingDups =
        userIds.length > 0
          ? await this.prisma.mergeCandidate.count({
              where: { userId: { in: userIds }, status: 'PENDING' },
            })
          : 0;
    } else {
      pendingDups = 0;
    }

    const score = Math.max(0, 100 - pendingDups * 5);

    return {
      name: 'Dedup Health',
      score: Math.round(score * 10) / 10,
      weight: 15,
      details: `${pendingDups} pending merge candidates`,
    };
  }

  /** How recently the last Dream Cycle ran and its status */
  private async consolidationHealth(): Promise<FogIndexComponent> {
    const lastReport = await this.prisma.dreamCycleReport.findFirst({
      orderBy: { startedAt: 'desc' },
      select: { completedAt: true, status: true, startedAt: true },
    });

    if (!lastReport || !lastReport.completedAt) {
      return {
        name: 'Consolidation Health',
        score: 0,
        weight: 20,
        details: 'No Dream Cycle has completed',
      };
    }

    const hoursSince =
      (Date.now() - lastReport.completedAt.getTime()) / (1000 * 60 * 60);
    const wasSuccessful =
      lastReport.status === 'COMPLETED' || lastReport.status === 'DRY_RUN';

    let score: number;
    if (hoursSince <= 24) score = 100;
    else if (hoursSince <= 48) score = 85;
    else if (hoursSince <= 72) score = 70;
    else if (hoursSince <= 168) score = 50;
    else score = Math.max(0, 50 - (hoursSince - 168) / 24);

    if (!wasSuccessful) score *= 0.5;

    return {
      name: 'Consolidation Health',
      score: Math.round(score * 10) / 10,
      weight: 20,
      details: `Last cycle: ${lastReport.status} ${hoursSince.toFixed(0)}h ago`,
    };
  }

  /** How fast memories are becoming stale (high decay = low score) */
  private async memoryDecayRate(
    where: { userId?: string; agentId?: string },
  ): Promise<FogIndexComponent> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const total = await this.prisma.memory.count({
      where: this.memoryFilter(where),
    });

    if (total === 0) {
      return {
        name: 'Memory Vitality',
        score: 50,
        weight: 10,
        details: 'No memories',
      };
    }

    const baseFilter = where.userId
      ? { userId: where.userId }
      : where.agentId
        ? { agentId: where.agentId }
        : {};

    const decayed = await this.prisma.memory.count({
      where: {
        ...baseFilter,
        deletedAt: { gte: thirtyDaysAgo },
      },
    });

    const lowScore = await this.prisma.memory.count({
      where: this.memoryFilter(where, { effectiveScore: { lt: 0.2 } }),
    });

    const decayPct = ((decayed + lowScore) / (total + decayed)) * 100;
    const score = Math.max(0, 100 - decayPct * 2.5);

    return {
      name: 'Memory Vitality',
      score: Math.round(score * 10) / 10,
      weight: 10,
      details: `${decayed} archived + ${lowScore} low-score memories (${decayPct.toFixed(1)}% decay)`,
    };
  }

  /** Coverage gaps: are there important types with thin coverage? */
  private async coverageGaps(
    where: { userId?: string; agentId?: string },
  ): Promise<FogIndexComponent> {
    const total = await this.prisma.memory.count({
      where: this.memoryFilter(where),
    });

    if (total === 0) {
      return {
        name: 'Coverage Breadth',
        score: 0,
        weight: 10,
        details: 'No memories',
      };
    }

    const typeCounts = await this.prisma.memory.groupBy({
      by: ['memoryType'],
      where: { ...this.memoryFilter(where), memoryType: { not: null } },
      _count: true,
    });

    const expectedTypes = [
      'CONSTRAINT',
      'PREFERENCE',
      'FACT',
      'TASK',
      'EVENT',
      'LESSON',
    ];
    const coveredTypes = typeCounts.filter((t) => t.memoryType !== null).length;
    const typeCoverage = (coveredTypes / expectedTypes.length) * 100;

    const layerCounts = await this.prisma.memory.groupBy({
      by: ['layer'],
      where: this.memoryFilter(where),
      _count: true,
    });

    const expectedLayers = ['IDENTITY', 'PROJECT', 'SESSION', 'TASK'];
    const coveredLayers = layerCounts.length;
    const layerCoverage = (coveredLayers / expectedLayers.length) * 100;

    const score = (typeCoverage + layerCoverage) / 2;

    return {
      name: 'Coverage Breadth',
      score: Math.round(score * 10) / 10,
      weight: 10,
      details: `${coveredTypes}/${expectedTypes.length} types, ${coveredLayers}/${expectedLayers.length} layers represented`,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private emptyResult(): FogIndexResult {
    return {
      score: 0,
      tier: 'Dense Fog',
      components: [],
      computedAt: new Date().toISOString(),
    };
  }
}
