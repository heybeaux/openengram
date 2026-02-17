import { Injectable, Optional, Inject } from '@nestjs/common';
import { Memory, MemoryLayer } from '@prisma/client';

export interface ScoreComponents {
  baseScore: number;
  decayFactor: number;
  noveltyBoost: number;
  usageBoost: number;
  pinnedBoost: number;
  safetyFloor: number;
  effectiveScore: number;
}

export interface ScoringConfig {
  // Decay settings - half-life in days by layer
  decayHalfLifeDays: Record<MemoryLayer, number>;
  minDecayFactor: number;

  // Boost settings
  maxUsageBoost: number;
  usageBoostPerUse: number;
  pinnedBoost: number;

  // V2 additions
  noveltyBoostMax: number; // Max boost for brand new memories
  noveltyBoostDays: number; // Days over which novelty tapers to 0
  safetyFloor: number; // Minimum score for safety-critical memories

  // Lesson scoring
  lessonBaseScoreFloor: number; // Minimum score for LESSON memories (default 0.7)
}

const DEFAULT_CONFIG: ScoringConfig = {
  decayHalfLifeDays: {
    [MemoryLayer.IDENTITY]: Infinity,
    [MemoryLayer.PROJECT]: 60,
    [MemoryLayer.SESSION]: 30,
    [MemoryLayer.TASK]: 7,
    [MemoryLayer.INSIGHT]: 90,
  },
  minDecayFactor: 0.1,

  maxUsageBoost: 0.3,
  usageBoostPerUse: 0.02,
  pinnedBoost: 0.5,

  // V2 additions
  noveltyBoostMax: 0.15,
  noveltyBoostDays: 7,
  safetyFloor: 0.6,

  // Lesson scoring
  lessonBaseScoreFloor: 0.7,
};

type MemoryWithRelations = Memory & {
  extraction?: {
    emotionalIntensity?: number | null;
    sentiment?: number | null;
  } | null;
};

@Injectable()
export class ImportanceScorerService {
  private config: ScoringConfig;

  constructor(
    @Optional() @Inject('SCORING_CONFIG') config?: Partial<ScoringConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Compute effective score for a memory
   * v2: includes confidence weighting and reinforcement-aware decay
   */
  computeScore(
    memory: MemoryWithRelations,
    now: Date = new Date(),
  ): ScoreComponents {
    // 1. Base score from importanceScore
    const baseScore = memory.importanceScore ?? 0.5;

    // 2. Decay factor based on layer and age (now reinforcement-aware)
    const decayFactor = this.computeDecayFactor(memory, now);

    // 3. Reinforcement multiplier: log2(1 + reinforcementCount) * 0.15
    // Uses usedCount as proxy for reinforcement count
    const reinforcementCount = memory.usedCount ?? 0;
    const reinforcementMultiplier =
      1 + Math.log2(1 + reinforcementCount) * 0.15;

    // 4. Confidence weight: scales from 0.5x to 1.0x based on confidence
    const confidence = memory.confidence ?? 1.0;
    const confidenceWeight = 0.5 + confidence * 0.5;

    // 5. Novelty boost for new memories
    const noveltyBoost = this.computeNoveltyBoost(memory, now);

    // 6. Usage boost based on retrieval/use count
    const usageBoost = this.computeUsageBoost(memory);

    // 7. Pinned boost
    const pinnedBoost = memory.userPinned ? this.config.pinnedBoost : 0;

    // 8. Safety floor for critical memories
    const safetyFloor = memory.safetyCritical ? this.config.safetyFloor : 0;

    // Compute final score with reinforcement and confidence
    const computedScore =
      baseScore * decayFactor * reinforcementMultiplier * confidenceWeight +
      noveltyBoost +
      usageBoost +
      pinnedBoost;
    let effectiveScore = Math.min(1.0, Math.max(safetyFloor, computedScore));

    // Lesson floor - lessons maintain high visibility
    if (memory.memoryType === 'LESSON') {
      const lessonFloor = this.config.lessonBaseScoreFloor ?? 0.7;
      effectiveScore = Math.max(lessonFloor, effectiveScore);
    }

    return {
      baseScore,
      decayFactor,
      noveltyBoost,
      usageBoost,
      pinnedBoost,
      safetyFloor,
      effectiveScore,
    };
  }

  /**
   * Compute decay factor based on memory age and layer
   * Uses exponential decay with configurable half-life
   */
  computeDecayFactor(memory: Memory, now: Date): number {
    const halfLifeDays = this.config.decayHalfLifeDays[memory.layer];

    // Identity memories don't decay
    if (halfLifeDays === Infinity) {
      return 1.0;
    }

    // Use lastRetrievedAt as decay anchor if available — retrieval refreshes relevance
    const decayAnchor = memory.lastRetrievedAt ?? memory.createdAt;
    const ageMs = now.getTime() - decayAnchor.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    // Exponential decay: factor = 0.5 ^ (age / halfLife)
    const decayFactor = Math.pow(0.5, ageDays / halfLifeDays);

    return Math.max(this.config.minDecayFactor, decayFactor);
  }

  /**
   * Compute novelty boost for memories < noveltyBoostDays old
   * Tapers linearly from max to 0 over the novelty period
   */
  computeNoveltyBoost(memory: Memory, now: Date): number {
    const ageMs = now.getTime() - memory.createdAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    if (ageDays >= this.config.noveltyBoostDays) {
      return 0;
    }

    // Linear taper: full boost at day 0, zero at noveltyBoostDays
    const taper = 1 - ageDays / this.config.noveltyBoostDays;
    return this.config.noveltyBoostMax * taper;
  }

  /**
   * Compute usage boost based on retrieval and use counts
   */
  computeUsageBoost(memory: Memory): number {
    const totalUses = (memory.retrievalCount ?? 0) + (memory.usedCount ?? 0);
    const boost = totalUses * this.config.usageBoostPerUse;
    return Math.min(this.config.maxUsageBoost, boost);
  }

  /**
   * Get the current config
   */
  getConfig(): ScoringConfig {
    return { ...this.config };
  }

  /**
   * Update config
   */
  updateConfig(updates: Partial<ScoringConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}
