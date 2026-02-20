import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AgentExportBundle {
  version: '1.0';
  exportedAt: string;
  agent: {
    id: string;
    name: string;
    createdAt: string;
  };
  identitySnapshot: any | null;
  capabilities: Array<{
    capability: string;
    confidence: number;
    evidenceCount: number;
    successRate: number;
    avgDurationMs: number | null;
    notes: string | null;
  }>;
  preferences: Array<{
    raw: string;
    memoryType: string | null;
    layer: string;
    createdAt: string;
  }>;
  trustHistory: Array<{
    category: string | null;
    score: number;
    signalCount: number;
    computedAt: string;
  }>;
  workStyle: Array<{
    dimension: string;
    value: any;
    sampleCount: number;
  }>;
  keyMemories: Array<{
    raw: string;
    layer: string;
    memoryType: string | null;
    importance: number;
    createdAt: string;
  }>;
}

export interface ImportResult {
  agentId: string;
  imported: {
    capabilities: number;
    preferences: number;
    trustScores: number;
    workStyles: number;
    keyMemories: number;
  };
  skipped: {
    duplicateCapabilities: number;
    duplicateMemories: number;
  };
}

@Injectable()
export class PortableIdentityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Export an agent's full identity profile as a portable JSON bundle
   */
  async exportAgent(
    userId: string,
    agentId: string,
  ): Promise<AgentExportBundle> {
    const agent = await this.prisma.agent.findFirst({
      where: {
        OR: [{ id: agentId }, { name: agentId }],
        deletedAt: null,
      },
    });
    if (!agent) throw new NotFoundException(`Agent ${agentId} not found`);

    const [
      latestSnapshot,
      capabilities,
      preferences,
      trustScores,
      workStyles,
      keyMemories,
    ] = await Promise.all([
      this.prisma.identitySnapshot.findFirst({
        where: { agentId: agent.id },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.agentCapabilityProfile.findMany({
        where: { agentId: agent.id, userId },
      }),
      this.prisma.memory.findMany({
        where: {
          agentId: agent.id,
          memoryType: 'PREFERENCE',
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.trustScore.findMany({
        where: { agentId: agent.id },
        orderBy: { computedAt: 'desc' },
        take: 20,
      }),
      this.prisma.agentWorkStyle.findMany({
        where: { agentId: agent.id, userId },
      }),
      this.prisma.memory.findMany({
        where: {
          agentId: agent.id,
          deletedAt: null,
          effectiveScore: { gte: 0.7 },
        },
        orderBy: { effectiveScore: 'desc' },
        take: 100,
      }),
    ]);

    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      agent: {
        id: agent.id,
        name: agent.name,
        createdAt: agent.createdAt.toISOString(),
      },
      identitySnapshot: latestSnapshot
        ? {
            capabilities: latestSnapshot.capabilities,
            preferences: latestSnapshot.preferences,
            trustScores: latestSnapshot.trustScores,
            behavioralTraits: latestSnapshot.behavioralTraits,
          }
        : null,
      capabilities: capabilities.map((c) => ({
        capability: c.capability,
        confidence: c.confidence,
        evidenceCount: c.evidenceCount,
        successRate: c.successRate,
        avgDurationMs: c.avgDurationMs,
        notes: c.notes,
      })),
      preferences: preferences.map((m) => ({
        raw: m.raw,
        memoryType: m.memoryType,
        layer: m.layer,
        createdAt: m.createdAt.toISOString(),
      })),
      trustHistory: trustScores.map((t) => ({
        category: t.category,
        score: t.score,
        signalCount: t.signalCount,
        computedAt: t.computedAt.toISOString(),
      })),
      workStyle: workStyles.map((w) => ({
        dimension: w.dimension,
        value: w.value,
        sampleCount: w.sampleCount,
      })),
      keyMemories: keyMemories.map((m) => ({
        raw: m.raw,
        layer: m.layer,
        memoryType: m.memoryType,
        importance: m.effectiveScore,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Import an agent identity bundle into the system.
   * Validates structure, deduplicates capabilities and memories.
   */
  async importAgent(
    userId: string,
    agentId: string,
    bundle: AgentExportBundle,
  ): Promise<ImportResult> {
    // Validate bundle version
    if (bundle.version !== '1.0') {
      throw new BadRequestException(
        `Unsupported bundle version: ${bundle.version}`,
      );
    }

    // Validate required fields
    if (!bundle.agent?.name) {
      throw new BadRequestException('Bundle must include agent.name');
    }

    // Find or validate target agent
    const agent = await this.prisma.agent.findFirst({
      where: {
        OR: [{ id: agentId }, { name: agentId }],
        deletedAt: null,
      },
    });
    if (!agent) throw new NotFoundException(`Target agent ${agentId} not found`);

    const result: ImportResult = {
      agentId: agent.id,
      imported: {
        capabilities: 0,
        preferences: 0,
        trustScores: 0,
        workStyles: 0,
        keyMemories: 0,
      },
      skipped: {
        duplicateCapabilities: 0,
        duplicateMemories: 0,
      },
    };

    // Import capabilities (deduplicate by capability name)
    if (bundle.capabilities?.length) {
      const existing = await this.prisma.agentCapabilityProfile.findMany({
        where: { agentId: agent.id, userId },
        select: { capability: true },
      });
      const existingSet = new Set(existing.map((e) => e.capability));

      for (const cap of bundle.capabilities) {
        if (existingSet.has(cap.capability)) {
          result.skipped.duplicateCapabilities++;
          continue;
        }
        await this.prisma.agentCapabilityProfile.create({
          data: {
            agentId: agent.id,
            userId,
            capability: cap.capability,
            confidence: cap.confidence,
            evidenceCount: cap.evidenceCount,
            successRate: cap.successRate,
            avgDurationMs: cap.avgDurationMs,
            notes: cap.notes,
          },
        });
        result.imported.capabilities++;
      }
    }

    // Import work styles (deduplicate by dimension)
    if (bundle.workStyle?.length) {
      const existing = await this.prisma.agentWorkStyle.findMany({
        where: { agentId: agent.id, userId },
        select: { dimension: true },
      });
      const existingSet = new Set(existing.map((e) => e.dimension));

      for (const ws of bundle.workStyle) {
        if (existingSet.has(ws.dimension)) continue;
        await this.prisma.agentWorkStyle.create({
          data: {
            agentId: agent.id,
            userId,
            dimension: ws.dimension,
            value: ws.value,
            sampleCount: ws.sampleCount,
          },
        });
        result.imported.workStyles++;
      }
    }

    // Import key memories (deduplicate by raw content hash)
    if (bundle.keyMemories?.length) {
      const existingMemories = await this.prisma.memory.findMany({
        where: { agentId: agent.id, deletedAt: null },
        select: { raw: true },
      });
      const existingRaws = new Set(existingMemories.map((m) => m.raw));

      for (const mem of bundle.keyMemories) {
        if (existingRaws.has(mem.raw)) {
          result.skipped.duplicateMemories++;
          continue;
        }
        await this.prisma.memory.create({
          data: {
            userId,
            agentId: agent.id,
            raw: mem.raw,
            layer: mem.layer as any,
            memoryType: mem.memoryType as any,
            effectiveScore: mem.importance,
            subjectType: 'AGENT',
            subjectId: agent.id,
            metadata: { importedFrom: bundle.agent.id },
          },
        });
        result.imported.keyMemories++;
      }
    }

    // Import trust scores as historical snapshots
    if (bundle.trustHistory?.length) {
      for (const ts of bundle.trustHistory) {
        await this.prisma.trustScore.create({
          data: {
            userId,
            agentId: agent.id,
            category: ts.category,
            score: ts.score,
            signalCount: ts.signalCount,
            computedAt: new Date(ts.computedAt),
          },
        });
        result.imported.trustScores++;
      }
    }

    return result;
  }
}
