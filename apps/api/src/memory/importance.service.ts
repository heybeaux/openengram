import { Injectable } from '@nestjs/common';
import { ImportanceHint, MemoryLayer } from '@prisma/client';

export interface ImportanceInput {
  hint?: ImportanceHint;
  layer?: MemoryLayer;
  repetitionCount?: number;
  referenceCount?: number;
  isCorrection?: boolean;
  isPrimacy?: boolean; // First in session
  isRecency?: boolean; // Last in session
}

/**
 * Calculates importance scores for memories
 *
 * Based on design doc formula:
 * importance = (
 *     explicit_boost
 *   + correction_boost
 *   + agent_flag
 *   + (repetition_count * 10)
 *   + (reference_count * 5)
 *   + recency_score
 *   + position_boost
 * ) * layer_weight
 */
@Injectable()
export class ImportanceService {
  // Weight multipliers by layer
  private readonly layerWeights: Record<MemoryLayer, number> = {
    [MemoryLayer.IDENTITY]: 2.0,
    [MemoryLayer.PROJECT]: 1.5,
    [MemoryLayer.SESSION]: 1.0,
    [MemoryLayer.TASK]: 0.5,
    [MemoryLayer.INSIGHT]: 1.8,
  };

  // Boost values for hints
  private readonly hintBoosts: Record<ImportanceHint, number> = {
    [ImportanceHint.LOW]: 0,
    [ImportanceHint.MEDIUM]: 25,
    [ImportanceHint.HIGH]: 50,
    [ImportanceHint.CRITICAL]: 100,
  };

  /**
   * Calculate initial importance score
   * Returns a normalized score between 0 and 1
   */
  calculate(input: ImportanceInput): number {
    let score = 50; // Base score

    // 1. Apply hint boost
    if (input.hint) {
      score += this.hintBoosts[input.hint];
    }

    // 2. Apply correction boost
    if (input.isCorrection) {
      score += 50;
    }

    // 3. Apply repetition boost
    if (input.repetitionCount) {
      score += input.repetitionCount * 10;
    }

    // 4. Apply reference boost
    if (input.referenceCount) {
      score += input.referenceCount * 5;
    }

    // 5. Apply position boost (primacy/recency)
    if (input.isPrimacy || input.isRecency) {
      score *= 1.2; // 20% boost
    }

    // 6. Apply layer weight
    const layerWeight = input.layer ? this.layerWeights[input.layer] : 1.0;
    score *= layerWeight;

    // Normalize to 0-1 range
    // Max theoretical score is roughly: (100 + 50 + 100 + 50) * 1.2 * 2.0 = 720
    const normalized = Math.min(score / 300, 1.0);

    return Math.round(normalized * 100) / 100; // 2 decimal places
  }

  /**
   * Recalculate importance after usage
   */
  recalculate(
    currentScore: number,
    event: 'retrieved' | 'used' | 'confirmed' | 'corrected',
  ): number {
    let multiplier = 1.0;

    switch (event) {
      case 'retrieved':
        multiplier = 1.02; // Small boost for being retrieved
        break;
      case 'used':
        multiplier = 1.05; // Medium boost for being used
        break;
      case 'confirmed':
        multiplier = 1.1; // Larger boost for being confirmed
        break;
      case 'corrected':
        // Corrected memories lose importance (superseded)
        multiplier = 0.5;
        break;
    }

    const newScore = currentScore * multiplier;
    return Math.min(Math.max(newScore, 0), 1); // Clamp to 0-1
  }

  /**
   * Apply time decay to importance
   * Memories lose importance over time if not accessed
   */
  applyDecay(
    currentScore: number,
    lastAccessedAt: Date,
    layer: MemoryLayer,
  ): number {
    // Identity layer doesn't decay
    if (layer === MemoryLayer.IDENTITY) {
      return currentScore;
    }

    const daysSinceAccess = Math.floor(
      (Date.now() - lastAccessedAt.getTime()) / (1000 * 60 * 60 * 24),
    );

    // Decay rates by layer
    const decayRates: Record<MemoryLayer, number> = {
      [MemoryLayer.IDENTITY]: 0, // No decay
      [MemoryLayer.PROJECT]: 0.01, // 1% per day
      [MemoryLayer.SESSION]: 0.02, // 2% per day
      [MemoryLayer.TASK]: 0.05, // 5% per day
      [MemoryLayer.INSIGHT]: 0.005, // 0.5% per day
    };

    const decayRate = decayRates[layer];
    const decayFactor = Math.exp(-decayRate * daysSinceAccess);

    return currentScore * decayFactor;
  }
}
