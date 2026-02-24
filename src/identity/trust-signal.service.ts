import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TrustSignalInput, TrustScoreResult } from './identity.types';
import { TrustSignalType } from '@prisma/client';

/**
 * HEY-170: Trust Signal Extraction
 *
 * Extracts behavioral trust signals from observed agent history.
 * Computes trust scores from accumulated signals using time-decayed weighting.
 */
@Injectable()
export class TrustSignalService {
  /** Half-life for time decay in days */
  private static readonly DECAY_HALF_LIFE_DAYS = 30;

  /** Weight multipliers per signal type */
  private static readonly SIGNAL_WEIGHTS: Record<TrustSignalType, number> = {
    SUCCESS: 1.0,
    FAILURE: -1.5, // Failures weigh more heavily
    CORRECTION: -0.5, // Corrections are mild negatives (agent learned)
  };

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a trust signal from an observed behavior.
   */
  async recordSignal(input: TrustSignalInput) {
    const effectiveWeight =
      (input.weight ?? 1.0) *
      TrustSignalService.SIGNAL_WEIGHTS[input.signalType];

    return this.prisma.trustSignal.create({
      data: {
        userId: input.userId,
        agentId: input.agentId,
        signalType: input.signalType as TrustSignalType,
        context: input.context,
        category: input.category ?? null,
        weight: effectiveWeight,
        sourceMemoryId: input.sourceMemoryId ?? null,
        metadata: (input.metadata as any) ?? undefined,
      },
    });
  }

  /**
   * Compute trust score for a user/agent, optionally filtered by category.
   * Uses time-decayed weighting so recent signals matter more.
   */
  async computeScore(
    userId: string,
    opts?: { agentId?: string; category?: string },
  ): Promise<TrustScoreResult> {
    const where: Record<string, unknown> = { userId };
    if (opts?.agentId) where.agentId = opts.agentId;
    if (opts?.category) where.category = opts.category;

    const signals = await this.prisma.trustSignal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const now = Date.now();
    let weightedSum = 0;
    let totalWeight = 0;
    let successCount = 0;
    let failureCount = 0;
    let correctionCount = 0;

    for (const signal of signals) {
      const ageDays =
        (now - signal.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      const decay = Math.pow(
        0.5,
        ageDays / TrustSignalService.DECAY_HALF_LIFE_DAYS,
      );
      const decayedWeight = Math.abs(signal.weight) * decay;

      // Positive contribution for success, negative for failure/correction
      weightedSum += signal.weight * decay;
      totalWeight += decayedWeight;

      if (signal.signalType === 'SUCCESS') successCount++;
      else if (signal.signalType === 'FAILURE') failureCount++;
      else if (signal.signalType === 'CORRECTION') correctionCount++;
    }

    // Normalize to 0-1 range using sigmoid-like mapping
    const rawScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
    const score = Math.max(0, Math.min(1, (rawScore + 1) / 2));

    const result: TrustScoreResult = {
      category: opts?.category ?? null,
      score,
      signalCount: signals.length,
      successCount,
      failureCount,
      correctionCount,
      computedAt: new Date(),
    };

    // Persist snapshot
    await this.prisma.trustScore.create({
      data: {
        userId,
        agentId: opts?.agentId,
        category: opts?.category ?? null,
        score: result.score,
        signalCount: result.signalCount,
        successCount: result.successCount,
        failureCount: result.failureCount,
        correctionCount: result.correctionCount,
      },
    });

    return result;
  }

  /**
   * Get the most recent trust score for a user/category without recomputing.
   */
  async getLatestScore(
    userId: string,
    opts?: { agentId?: string; category?: string },
  ): Promise<TrustScoreResult | null> {
    const where: Record<string, unknown> = { userId };
    if (opts?.agentId) where.agentId = opts.agentId;
    if (opts?.category !== undefined) where.category = opts.category ?? null;

    const latest = await this.prisma.trustScore.findFirst({
      where,
      orderBy: { computedAt: 'desc' },
    });

    if (!latest) return null;

    return {
      category: latest.category,
      score: latest.score,
      signalCount: latest.signalCount,
      successCount: latest.successCount,
      failureCount: latest.failureCount,
      correctionCount: latest.correctionCount,
      computedAt: latest.computedAt,
    };
  }

  /**
   * Extract trust signals from a memory creation event.
   * Called from the memory pipeline when new memories are stored.
   */
  async extractFromMemory(memory: {
    id: string;
    userId: string;
    agentId?: string | null;
    raw: string;
    memoryType?: string | null;
    source?: string | null;
    extraction?: {
      topics?: string[];
      what?: string | null;
    } | null;
  }): Promise<void> {
    const category =
      memory.extraction?.topics?.[0]?.toLowerCase() ?? undefined;

    // Corrections are explicit trust signals
    if (memory.source === 'CORRECTION') {
      await this.recordSignal({
        userId: memory.userId,
        agentId: memory.agentId ?? undefined,
        signalType: 'CORRECTION',
        context: memory.raw.substring(0, 500),
        category,
        sourceMemoryId: memory.id,
      });
      return;
    }

    // LESSON memories indicate a failure that was learned from
    if (memory.memoryType === 'LESSON') {
      await this.recordSignal({
        userId: memory.userId,
        agentId: memory.agentId ?? undefined,
        signalType: 'FAILURE',
        context: memory.raw.substring(0, 500),
        category,
        weight: 0.8, // Slightly lower weight since it was captured as lesson
        sourceMemoryId: memory.id,
      });
      return;
    }

    // TASK completions observed through agent reflections
    if (
      memory.source === 'AGENT_REFLECTION' ||
      memory.source === 'AGENT_OBSERVATION'
    ) {
      const successState = this.classifyOutcome(memory.raw);
      // HEY-357: Only record signal when outcome is clear, skip ambiguous
      if (successState !== null) {
        await this.recordSignal({
          userId: memory.userId,
          agentId: memory.agentId ?? undefined,
          signalType: successState ? 'SUCCESS' : 'FAILURE',
          context: memory.raw.substring(0, 500),
          category,
          weight: 0.5, // Lower weight for implicit signals
          sourceMemoryId: memory.id,
        });
      }
    }
  }

  /**
   * Simple heuristic to detect success language in memory content.
   */
  /**
   * @deprecated Use classifyOutcome instead
   */
  private looksLikeSuccess(text: string): boolean {
    return this.classifyOutcome(text) ?? false;
  }

  /**
   * HEY-357: Classify outcome as true (success), false (failure), or null (ambiguous/neutral).
   * Returns null when text has mixed signals or neither success nor failure patterns.
   */
  private classifyOutcome(text: string): boolean | null {
    const successPatterns =
      /\b(completed|succeeded|deployed|fixed|resolved|passed|shipped|merged|approved)\b/i;
    const failurePatterns =
      /\b(failed|broke|crashed|error|bug|regression|reverted|rejected)\b/i;

    const hasSuccess = successPatterns.test(text);
    const hasFailure = failurePatterns.test(text);

    if (hasSuccess && !hasFailure) return true;
    if (hasFailure && !hasSuccess) return false;
    return null; // HEY-357: Default to neutral when ambiguous
  }
}
