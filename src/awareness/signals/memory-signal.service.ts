import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Observation, SignalSource } from './signal.interface';

/**
 * Memory Signal Source — the MVP signal for the Waking Cycle.
 *
 * Watches Engram's own memories and knowledge graph for:
 * - New memories since last check
 * - Recurring topics / entities
 * - Stale threads (old memories never retrieved)
 * - Knowledge gaps (entities mentioned but not explained)
 */
@Injectable()
export class MemorySignalService implements SignalSource {
  readonly name = 'memory';
  private readonly logger = new Logger(MemorySignalService.name);

  constructor(private readonly prisma: PrismaService) {}

  async collect(
    checkpoint: Record<string, unknown> | null,
    budget: { maxQueries: number },
  ): Promise<{
    observations: Observation[];
    checkpoint: Record<string, unknown>;
  }> {
    const since = checkpoint?.lastCheckedAt
      ? new Date(checkpoint.lastCheckedAt as string)
      : new Date(Date.now() - 4 * 60 * 60 * 1000); // default: last 4 hours

    const observations: Observation[] = [];
    let queriesUsed = 0;

    // ── 1. New memories since last check ────────────────────────────────
    if (queriesUsed < budget.maxQueries) {
      const recentMemories = await this.prisma.memory.findMany({
        where: {
          createdAt: { gt: since },
          deletedAt: null,
          layer: { not: 'INSIGHT' }, // don't observe our own insights
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          raw: true,
          layer: true,
          createdAt: true,
          userId: true,
          agentId: true,
        },
      });
      queriesUsed++;

      if (recentMemories.length > 0) {
        observations.push({
          id: `new-memories-${since.toISOString()}`,
          source: this.name,
          content: `${recentMemories.length} new memories since ${since.toISOString()}. Topics: ${this.summarizeTopics(recentMemories)}`,
          observedAt: new Date(),
          relatedMemoryIds: recentMemories.map(m => m.id),
          metadata: {
            count: recentMemories.length,
            layers: [...new Set(recentMemories.map(m => m.layer))],
            agents: [...new Set(recentMemories.map(m => m.agentId).filter(Boolean))],
          },
        });
      }
    }

    // ── 2. Stale memories (old, never retrieved) ────────────────────────
    if (queriesUsed < budget.maxQueries) {
      const staleMemories = await this.prisma.memory.findMany({
        where: {
          deletedAt: null,
          retrievalCount: 0,
          createdAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // older than 7 days
          layer: { not: 'INSIGHT' },
          importanceScore: { gte: 0.5 }, // only flag important stale memories
        },
        take: 20,
        select: {
          id: true,
          raw: true,
          createdAt: true,
          importanceScore: true,
        },
      });
      queriesUsed++;

      if (staleMemories.length > 0) {
        observations.push({
          id: `stale-memories-${new Date().toISOString()}`,
          source: this.name,
          content: `${staleMemories.length} important memories (importance ≥ 0.5) created over 7 days ago have never been retrieved. They may contain valuable but forgotten context.`,
          observedAt: new Date(),
          relatedMemoryIds: staleMemories.map(m => m.id),
          metadata: { count: staleMemories.length },
        });
      }
    }

    // ── 3. Recurring entities (knowledge graph hot spots) ───────────────
    // Use a stable observation ID (not timestamp-based) so the pattern
    // detector can dedup across cycles.
    if (queriesUsed < budget.maxQueries) {
      const hotEntities = await this.prisma.graphEntity.findMany({
        where: {
          mentionCount: { gte: 5 },
        },
        orderBy: { mentionCount: 'desc' },
        take: 10,
        select: {
          id: true,
          name: true,
          type: true,
          mentionCount: true,
        },
      });
      queriesUsed++;

      if (hotEntities.length > 0) {
        // Stable ID: hash of sorted entity IDs so identical entity sets
        // produce the same observation ID across cycles
        const entityHash = hotEntities.map(e => e.id).sort().join(',');
        observations.push({
          id: `hot-entities-${entityHash.slice(0, 32)}`,
          source: this.name,
          content: `Top recurring entities: ${hotEntities.map(e => `${e.name} (${e.type}, ${e.mentionCount} mentions)`).join(', ')}`,
          observedAt: new Date(),
          metadata: { entities: hotEntities },
        });
      }
    }

    // ── 4. Cross-cutting memory sample (for LLM pattern discovery) ─────
    if (queriesUsed + 2 < budget.maxQueries) {
      // Sample recent high-importance memories across different layers
      const diverseMemories = await this.prisma.memory.findMany({
        where: {
          deletedAt: null,
          layer: { not: 'INSIGHT' },
          importanceScore: { gte: 0.3 },
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          raw: true,
          layer: true,
          createdAt: true,
          agentId: true,
          memoryType: true,
        },
      });
      queriesUsed++;

      // Also grab some older memories for temporal pattern detection
      const olderMemories = await this.prisma.memory.findMany({
        where: {
          deletedAt: null,
          layer: { not: 'INSIGHT' },
          importanceScore: { gte: 0.5 },
          createdAt: { lt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
        },
        orderBy: [{ importanceScore: 'desc' }, { retrievalCount: 'desc' }],
        take: 20,
        select: {
          id: true,
          raw: true,
          layer: true,
          createdAt: true,
          agentId: true,
          memoryType: true,
        },
      });
      queriesUsed++;

      const allSampled = [...diverseMemories, ...olderMemories];
      // Deduplicate by ID
      const seen = new Set<string>();
      const unique = allSampled.filter(m => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });

      if (unique.length >= 3) {
        observations.push({
          id: `cross-cutting-${new Date().toISOString()}`,
          source: this.name,
          content: `Cross-cutting memory sample: ${unique.length} memories across layers [${[...new Set(unique.map(m => m.layer))].join(', ')}] spanning ${this.daySpan(unique)} days. Looking for patterns, connections, and gaps.`,
          observedAt: new Date(),
          relatedMemoryIds: unique.map(m => m.id),
          metadata: {
            count: unique.length,
            layers: [...new Set(unique.map(m => m.layer))],
            agents: [...new Set(unique.map(m => m.agentId).filter(Boolean))],
            types: [...new Set(unique.map(m => m.memoryType).filter(Boolean))],
            crossCutting: true,
          },
        });
      }
    }

    this.logger.log(
      `Collected ${observations.length} observations using ${queriesUsed} queries`,
    );

    return {
      observations,
      checkpoint: {
        lastCheckedAt: new Date().toISOString(),
        queriesUsed,
        observationCount: observations.length,
      },
    };
  }

  /** Calculate the time span in days across a set of memories. */
  private daySpan(memories: { createdAt: Date }[]): number {
    if (memories.length < 2) return 0;
    const dates = memories.map(m => m.createdAt.getTime());
    return Math.round((Math.max(...dates) - Math.min(...dates)) / (24 * 60 * 60 * 1000));
  }

  /** Extract top keywords from memory content for observation summaries. */
  private summarizeTopics(memories: { raw: string; layer: string }[]): string {
    // Simple keyword extraction — the LLM will do the real synthesis
    const words = memories
      .flatMap(m => m.raw.toLowerCase().split(/\s+/))
      .filter(w => w.length > 4);
    const freq = new Map<string, number>();
    for (const w of words) {
      freq.set(w, (freq.get(w) || 0) + 1);
    }
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word)
      .join(', ');
  }
}
