import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import { Memory, MemorySource } from '@prisma/client';

// Three-tier dedup thresholds (v2)
export const DEDUP_AUTO_MERGE_THRESHOLD = 0.93;
export const DEDUP_REINFORCE_THRESHOLD = 0.85;
export const DEDUP_REVIEW_THRESHOLD = 0.78;
export const DEDUP_SIMILARITY_THRESHOLD = DEDUP_AUTO_MERGE_THRESHOLD;
export const RELATED_SIMILARITY_THRESHOLD = 0.65;

// Source-based confidence mapping
export const SOURCE_CONFIDENCE: Record<string, number> = {
  EXPLICIT_STATEMENT: 1.0,
  CORRECTION: 1.0,
  AGENT_OBSERVATION: 0.7,
  AGENT_REFLECTION: 0.65,
  PATTERN_DETECTED: 0.65,
  SYSTEM: 0.8,
};

export interface DedupResult {
  action: 'create' | 'reinforced' | 'merged' | 'queued_review';
  existingMemory?: Memory;
  similarityScore?: number;
}

@Injectable()
export class MemoryDedupService {
  constructor(
    private prisma: PrismaService,
    private embedding: EmbeddingService,
  ) {}

  /**
   * Legacy dedup method kept for compatibility
   */
  async findDuplicate(
    userId: string,
    text: string,
    threshold: number = DEDUP_SIMILARITY_THRESHOLD,
  ): Promise<Memory | null> {
    const result = await this.findDuplicateV2(userId, text);
    return result.existingMemory ?? null;
  }

  /**
   * Three-tier semantic deduplication (v2)
   * - ≥0.93: auto-merge (combine content, boost confidence)
   * - ≥0.85: reinforce (increment accessCount, update lastAccessedAt)
   * - ≥0.78: flag for review (add to MergeCandidate table)
   */
  async findDuplicateV2(userId: string, text: string): Promise<DedupResult> {
    try {
      const embedding = await this.embedding.generate(text);
      const similar = await this.embedding.search(userId, embedding, 5);

      const bestMatch = similar.length > 0 ? similar[0] : null;
      if (!bestMatch) return { action: 'create' };

      const existingMemory = await this.prisma.memory.findUnique({
        where: { id: bestMatch.id },
      });
      if (!existingMemory || existingMemory.deletedAt)
        return { action: 'create' };

      if (bestMatch.score >= DEDUP_AUTO_MERGE_THRESHOLD) {
        console.log(
          `[Dedup] Auto-merge: score=${bestMatch.score.toFixed(3)} memory=${bestMatch.id}`,
        );
        return {
          action: 'merged',
          existingMemory,
          similarityScore: bestMatch.score,
        };
      }

      if (bestMatch.score >= DEDUP_REINFORCE_THRESHOLD) {
        console.log(
          `[Dedup] Reinforce: score=${bestMatch.score.toFixed(3)} memory=${bestMatch.id}`,
        );
        return {
          action: 'reinforced',
          existingMemory,
          similarityScore: bestMatch.score,
        };
      }

      if (bestMatch.score >= DEDUP_REVIEW_THRESHOLD) {
        console.log(
          `[Dedup] Queue for review: score=${bestMatch.score.toFixed(3)} memory=${bestMatch.id}`,
        );
        try {
          await this.prisma.mergeCandidate.create({
            data: {
              userId,
              memoryIds: [existingMemory.id],
              similarity: bestMatch.score,
              suggestedStrategy: 'SEMANTIC_SIMILAR',
              suggestedSurvivorId: existingMemory.id,
              status: 'PENDING',
            },
          });
        } catch (err) {
          console.error('[Dedup] Failed to create MergeCandidate:', err);
        }
        return { action: 'create' };
      }

      return { action: 'create' };
    } catch (error) {
      console.error('Duplicate check failed:', error);
      return { action: 'create' };
    }
  }

  /**
   * Auto-merge: combine content from new memory into existing, boost confidence
   */
  async autoMergeMemory(
    existingId: string,
    newContent: string,
    newSource: MemorySource,
  ): Promise<void> {
    const existing = await this.prisma.memory.findUnique({
      where: { id: existingId },
    });
    if (!existing) return;

    const newConfidence = SOURCE_CONFIDENCE[newSource] ?? 1.0;
    const boostedConfidence = Math.min(
      1.0,
      Math.max(existing.confidence, newConfidence) + 0.05,
    );

    await this.prisma.memory.update({
      where: { id: existingId },
      data: {
        confidence: boostedConfidence,
        usedCount: { increment: 1 },
        lastUsedAt: new Date(),
        importanceScore: Math.min(1.0, existing.importanceScore + 0.05),
      },
    });
  }

  /**
   * Reinforce an existing memory (boost importance, track sessions)
   */
  async reinforceMemory(
    memoryId: string,
    sessionId?: string,
  ): Promise<void> {
    await this.prisma.memory.update({
      where: { id: memoryId },
      data: {
        usedCount: { increment: 1 },
        lastUsedAt: new Date(),
        importanceScore: { increment: 0.05 },
      },
    });

    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
    });
    if (memory && memory.importanceScore > 1.0) {
      await this.prisma.memory.update({
        where: { id: memoryId },
        data: { importanceScore: 1.0 },
      });
    }
  }
}
