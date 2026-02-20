import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface TrustHistoryEntry {
  agentId: string;
  trustScore: number;
  timestamp: Date;
  reason?: string;
}

@Injectable()
export class TrustHistoryService {
  private readonly logger = new Logger(TrustHistoryService.name);
  private history: TrustHistoryEntry[] = [];

  constructor(private readonly prisma: PrismaService) {}

  async getHistory(
    agentId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<{ data: TrustHistoryEntry[]; total: number }> {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const agentHistory = this.history
      .filter((h) => h.agentId === agentId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return {
      data: agentHistory.slice(offset, offset + limit),
      total: agentHistory.length,
    };
  }

  recordTrustScore(agentId: string, trustScore: number, reason?: string): void {
    this.history.push({ agentId, trustScore, timestamp: new Date(), reason });
  }

  async bulkRecompute(): Promise<{ recomputed: number; agents: string[] }> {
    const agents = await this.prisma.memory.findMany({
      where: { subjectType: 'AGENT', deletedAt: null },
      select: { subjectId: true },
      distinct: ['subjectId'],
    });
    const agentIds = agents.map((a) => a.subjectId).filter((id): id is string => id !== null);
    for (const agentId of agentIds) {
      const memories = await this.prisma.memory.findMany({
        where: { subjectType: 'AGENT', subjectId: agentId, deletedAt: null },
        select: { importanceScore: true },
      });
      if (memories.length === 0) continue;
      const avg = memories.reduce((s, m) => s + m.importanceScore, 0) / memories.length;
      this.recordTrustScore(agentId, Math.min(1, Math.max(0, avg)), 'bulk-recompute');
    }
    this.logger.log(`Bulk recomputed trust for ${agentIds.length} agents`);
    return { recomputed: agentIds.length, agents: agentIds };
  }
}
