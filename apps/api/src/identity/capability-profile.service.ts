import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CapabilityProfileDto,
  CapabilityProfileResponseDto,
} from './dto/identity.dto';

/**
 * HEY-179: Agent Capability Profiles
 *
 * Builds and maintains persistent capability profiles by aggregating
 * evidence from task outcomes, trust signals, and capability extraction.
 * The profile is a "living document" that updates with each new evidence.
 */
@Injectable()
export class CapabilityProfileService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get the full capability profile for an agent
   */
  async getProfile(
    agentId: string,
    userId: string,
  ): Promise<CapabilityProfileResponseDto> {
    const profiles = await this.prisma.agentCapabilityProfile.findMany({
      where: { agentId, userId },
      orderBy: { confidence: 'desc' },
    });

    const latestUpdate = profiles.reduce(
      (latest, p) => (p.updatedAt > latest ? p.updatedAt : latest),
      new Date(0),
    );

    return {
      agentId,
      capabilities: profiles.map((p) => ({
        capability: p.capability,
        confidence: p.confidence,
        evidenceCount: p.evidenceCount,
        successRate: p.successRate,
        avgDurationMs: p.avgDurationMs ?? undefined,
        lastUsedAt: p.lastUsedAt ?? undefined,
        notes: p.notes ?? undefined,
      })),
      updatedAt: profiles.length > 0 ? latestUpdate : new Date(),
    };
  }

  /**
   * Update capability profiles based on a new task outcome.
   * Called automatically when a TASK_OUTCOME memory is created.
   */
  async updateFromTaskOutcome(
    agentId: string,
    userId: string,
    outcome: {
      capabilitiesUsed: string[];
      outcome: 'success' | 'partial' | 'failure';
      durationMs?: number;
      lessonsLearned?: string[];
    },
  ): Promise<void> {
    const successWeight =
      outcome.outcome === 'success'
        ? 1.0
        : outcome.outcome === 'partial'
          ? 0.5
          : 0.0;

    for (const capability of outcome.capabilitiesUsed) {
      const normalized = capability.toLowerCase().trim();

      const existing = await this.prisma.agentCapabilityProfile.findUnique({
        where: {
          agentId_userId_capability: {
            agentId,
            userId,
            capability: normalized,
          },
        },
      });

      if (existing) {
        // Incrementally update: weighted moving average
        const newCount = existing.evidenceCount + 1;
        const newSuccessRate =
          (existing.successRate * existing.evidenceCount + successWeight) /
          newCount;
        const newConfidence = Math.min(
          1.0,
          0.3 + 0.7 * (1 - Math.exp(-newCount / 10)),
        ); // Sigmoid-ish growth

        const newAvgDuration =
          outcome.durationMs != null
            ? existing.avgDurationMs != null
              ? (existing.avgDurationMs * existing.evidenceCount +
                  outcome.durationMs) /
                newCount
              : outcome.durationMs
            : existing.avgDurationMs;

        const newNotes = outcome.lessonsLearned?.length
          ? [existing.notes, ...outcome.lessonsLearned]
              .filter(Boolean)
              .join('; ')
          : existing.notes;

        await this.prisma.agentCapabilityProfile.update({
          where: { id: existing.id },
          data: {
            evidenceCount: newCount,
            successRate: newSuccessRate,
            confidence: newConfidence,
            avgDurationMs: newAvgDuration,
            lastUsedAt: new Date(),
            notes: newNotes ? newNotes.slice(0, 2000) : null,
          },
        });
      } else {
        // Create new capability entry
        await this.prisma.agentCapabilityProfile.create({
          data: {
            agentId,
            userId,
            capability: normalized,
            confidence: 0.3, // Low initial confidence
            evidenceCount: 1,
            successRate: successWeight,
            avgDurationMs: outcome.durationMs ?? null,
            lastUsedAt: new Date(),
            notes: outcome.lessonsLearned?.join('; ').slice(0, 2000) ?? null,
          },
        });
      }
    }
  }
}
