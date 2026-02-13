import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MemoryGraphService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get graph data for visualization
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

      if (currentUser) {
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

    const memories = await this.prisma.memory.findMany({
      where: {
        userId: { in: userIds },
        deletedAt: null,
      },
      include: {
        extraction: true,
        entities: {
          include: { entity: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const memoryIds = memories.map((m) => m.id);
    const chainLinks = await this.prisma.memoryChainLink.findMany({
      where: {
        OR: [{ sourceId: { in: memoryIds } }, { targetId: { in: memoryIds } }],
      },
    });

    const entityMap = new Map<string, any>();
    for (const memory of memories) {
      for (const me of memory.entities) {
        if (!entityMap.has(me.entity.id)) {
          entityMap.set(me.entity.id, {
            id: me.entity.id,
            name: me.entity.name,
            type: me.entity.type,
            normalizedName: me.entity.normalizedName,
          });
        }
      }
    }

    const nodes = memories.map((m) => ({
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
      entities: m.entities.map((me) => ({
        id: me.entity.id,
        name: me.entity.name,
        type: me.entity.type,
      })),
      primaryEntityType:
        m.entities.length > 0
          ? m.entities[0].entity.type.toLowerCase()
          : 'other',
    }));

    const humanCount = nodes.filter((n) => n.memorySource === 'human').length;
    const agentCount = nodes.filter((n) => n.memorySource === 'agent').length;

    const edges = chainLinks
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
      }));

    return {
      nodes,
      edges,
      entities: Array.from(entityMap.values()),
      ...(includeAgent && { stats: { human: humanCount, agent: agentCount } }),
    };
  }
}
