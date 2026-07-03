import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExperienceWeightResult } from './identity.types';
import { MemoryWithScore } from '../memory/memory.types';

/**
 * HEY-173: Experience-Weighted Recall
 *
 * Makes memory retrieval aware of task-type experience.
 * Boosts recall results from areas where the agent has demonstrated competence.
 * If agent has 20 successful deploys, deploy-related memories rank higher.
 */
@Injectable()
export class ExperienceWeightedRecallService {
  /**
   * Base multiplier — 1.0 means no boost.
   * Max multiplier caps how much experience can boost a result.
   */
  private static readonly BASE_WEIGHT = 1.0;
  private static readonly MAX_WEIGHT = 2.0;

  /**
   * How many successes to reach ~90% of max boost (logarithmic curve).
   * At 20 successes, weight ≈ 1.8x. At 50, weight ≈ 1.95x.
   */
  private static readonly SCALE_FACTOR = 15;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Update experience weights when a trust signal is recorded.
   * Called from the trust signal pipeline.
   */
  async updateWeight(
    userId: string,
    category: string,
    isSuccess: boolean,
    agentId?: string,
  ): Promise<void> {
    const existing = await this.prisma.experienceWeight.findUnique({
      where: {
        userId_agentId_category: {
          userId,
          agentId: agentId ?? '',
          category,
        },
      },
    });

    const successCount = (existing?.successCount ?? 0) + (isSuccess ? 1 : 0);
    const totalCount = (existing?.totalCount ?? 0) + 1;
    const weight = this.calculateWeight(successCount);

    await this.prisma.experienceWeight.upsert({
      where: {
        userId_agentId_category: {
          userId,
          agentId: agentId ?? '',
          category,
        },
      },
      create: {
        userId,
        agentId: agentId ?? '',
        category,
        successCount,
        totalCount,
        weight,
      },
      update: {
        successCount,
        totalCount,
        weight,
      },
    });
  }

  /**
   * Apply experience weights to recall results.
   * Boosts scores for memories whose topics match high-experience categories.
   */
  async applyWeights(
    userId: string,
    memories: MemoryWithScore[],
    opts?: { agentId?: string },
  ): Promise<MemoryWithScore[]> {
    // Load all experience weights for this user
    const where: Record<string, unknown> = { userId };
    if (opts?.agentId) where.agentId = opts.agentId;

    const weights = await this.prisma.experienceWeight.findMany({ where });

    if (weights.length === 0) return memories;

    const weightMap = new Map(weights.map((w) => [w.category, w.weight]));

    return memories.map((memory) => {
      const topics = (memory as any).extraction?.topics as string[] | undefined;
      if (!topics || topics.length === 0) return memory;

      // Find the best matching weight from memory topics
      let maxBoost = ExperienceWeightedRecallService.BASE_WEIGHT;
      for (const topic of topics) {
        const normalizedTopic = topic.toLowerCase();
        const weight = weightMap.get(normalizedTopic);
        if (weight && weight > maxBoost) {
          maxBoost = weight;
        }
      }

      if (maxBoost <= ExperienceWeightedRecallService.BASE_WEIGHT) {
        return memory;
      }

      return {
        ...memory,
        score: (memory.score ?? 0) * maxBoost,
      };
    });
  }

  /**
   * Get all experience weights for a user.
   */
  async getWeights(
    userId: string,
    opts?: { agentId?: string },
  ): Promise<ExperienceWeightResult[]> {
    const where: Record<string, unknown> = { userId };
    if (opts?.agentId) where.agentId = opts.agentId;

    const weights = await this.prisma.experienceWeight.findMany({
      where,
      orderBy: { weight: 'desc' },
    });

    return weights.map((w) => ({
      category: w.category,
      successCount: w.successCount,
      totalCount: w.totalCount,
      weight: w.weight,
    }));
  }

  /**
   * Logarithmic weight calculation.
   * successCount=0 → 1.0, successCount=20 → ~1.8, successCount=50 → ~1.95
   */
  calculateWeight(successCount: number): number {
    if (successCount <= 0) return ExperienceWeightedRecallService.BASE_WEIGHT;

    const range =
      ExperienceWeightedRecallService.MAX_WEIGHT -
      ExperienceWeightedRecallService.BASE_WEIGHT;
    const boost =
      range *
      (1 -
        Math.exp(
          (-successCount / ExperienceWeightedRecallService.SCALE_FACTOR) *
            Math.LN2,
        ));

    return ExperienceWeightedRecallService.BASE_WEIGHT + boost;
  }
}
