import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MemoryGraphService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get graph data for visualization.
   *
   * Uses GraphEntity/GraphEntityMention/GraphRelationship tables
   * (the semantic graph) rather than the legacy Entity/MemoryEntity tables.
   */
  async getGraphData(
    userId: string,
    limit: number = 500,
    includeAgent: boolean = false,
  ): Promise<{
    nodes: any[];
    edges: any[];
    entities: any[];
    stats?: { human: number; agent: number };
  }> {
    const userIds = [userId];
    let agentUserId: string | null = null;

    if (includeAgent) {
      const currentUser = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (currentUser?.agentId) {
        const agentUser = await this.prisma.user.findFirst({
          where: {
            agentId: currentUser.agentId,
            externalId: 'rook',
            deletedAt: null,
          },
        });

        if (agentUser) {
          userIds.push(agentUser.id);
          agentUserId = agentUser.id;
        }
      }
    }

    // Fetch memories with extractions
    const memories = await this.prisma.memory.findMany({
      where: {
        userId: { in: userIds },
        deletedAt: null,
      },
      include: {
        extraction: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const memoryIds = memories.map((m) => m.id);

    // ── Entities from the semantic graph ────────────────────────────────
    // Get all entity mentions for these memories
    const mentions = await this.prisma.graphEntityMention.findMany({
      where: {
        memoryId: { in: memoryIds },
      },
      include: {
        entity: true,
      },
    });

    // Build entity map and memory→entity associations
    const entityMap = new Map<string, any>();
    const memoryEntityMap = new Map<string, Array<{ id: string; name: string; type: string }>>();

    for (const mention of mentions) {
      const entity = mention.entity;
      if (!entityMap.has(entity.id)) {
        entityMap.set(entity.id, {
          id: entity.id,
          name: entity.name,
          type: entity.type,
          mentionCount: entity.mentionCount,
        });
      }
      const existing = memoryEntityMap.get(mention.memoryId) || [];
      // Avoid duplicate entities per memory
      if (!existing.some((e) => e.id === entity.id)) {
        existing.push({ id: entity.id, name: entity.name, type: entity.type });
      }
      memoryEntityMap.set(mention.memoryId, existing);
    }

    // ── Relationships (edges between entities) ─────────────────────────
    const entityIds = Array.from(entityMap.keys());
    const relationships = entityIds.length > 0
      ? await this.prisma.graphRelationship.findMany({
          where: {
            OR: [
              { sourceEntityId: { in: entityIds } },
              { targetEntityId: { in: entityIds } },
            ],
          },
        })
      : [];

    // Also get chain links between memories
    const chainLinks = await this.prisma.memoryChainLink.findMany({
      where: {
        OR: [{ sourceId: { in: memoryIds } }, { targetId: { in: memoryIds } }],
      },
    });

    // ── Build response ─────────────────────────────────────────────────
    const nodes = memories.map((m) => {
      const memEntities = memoryEntityMap.get(m.id) || [];
      return {
        id: m.id,
        raw: m.raw,
        layer: m.layer,
        source: m.source,
        memorySource:
          agentUserId && m.userId === agentUserId ? 'agent' : 'human',
        importanceScore: m.importanceScore,
        effectiveScore: m.effectiveScore,
        safetyCritical: m.safetyCritical,
        consolidated: m.consolidated,
        userPinned: m.userPinned,
        confidence: m.confidence,
        createdAt: m.createdAt.toISOString(),
        extraction: m.extraction
          ? {
              who: m.extraction.who,
              what: m.extraction.what,
              when: m.extraction.when?.toISOString(),
              where: m.extraction.whereCtx,
              why: m.extraction.why,
              how: m.extraction.how,
              topics: m.extraction.topics,
              memoryType: m.extraction.memoryType,
              whoConfidence: m.extraction.whoConfidence,
              whatConfidence: m.extraction.whatConfidence,
              whenConfidence: m.extraction.whenConfidence,
              whereConfidence: m.extraction.whereConfidence,
              whyConfidence: m.extraction.whyConfidence,
              howConfidence: m.extraction.howConfidence,
            }
          : null,
        entities: memEntities,
        primaryEntityType:
          memEntities.length > 0
            ? memEntities[0].type.toLowerCase()
            : 'other',
      };
    });

    const humanCount = nodes.filter((n) => n.memorySource === 'human').length;
    const agentCount = nodes.filter((n) => n.memorySource === 'agent').length;

    // Edges: entity relationships + memory chain links
    const edges = [
      ...relationships
        .filter(
          (r) =>
            entityIds.includes(r.sourceEntityId) &&
            entityIds.includes(r.targetEntityId),
        )
        .map((r) => ({
          id: r.id,
          source: r.sourceEntityId,
          target: r.targetEntityId,
          linkType: r.type,
          confidence: r.weight,
          createdAt: r.createdAt.toISOString(),
        })),
      ...chainLinks
        .filter(
          (link) =>
            memoryIds.includes(link.sourceId) &&
            memoryIds.includes(link.targetId),
        )
        .map((link) => ({
          id: link.id,
          source: link.sourceId,
          target: link.targetId,
          linkType: link.linkType,
          confidence: link.confidence,
          createdAt: link.createdAt.toISOString(),
        })),
    ];

    return {
      nodes,
      edges,
      entities: Array.from(entityMap.values()),
      ...(includeAgent && { stats: { human: humanCount, agent: agentCount } }),
    };
  }
}
