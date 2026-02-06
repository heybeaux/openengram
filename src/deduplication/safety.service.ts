import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryType } from '@prisma/client';
import { SafetyCheckResultDto, SafetyReasonDto, SafetyReasonType } from './dto/deduplication.dto';

/**
 * Safety configuration for deduplication
 */
export interface SafetyConfig {
  protectedTypes: MemoryType[];
  protectedKeywords: string[];
  protectedImportanceThreshold: number;
  alwaysReviewTypes: MemoryType[];
}

/**
 * Default safety configuration
 */
export const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  protectedTypes: [MemoryType.CONSTRAINT],
  protectedKeywords: [
    // Medical
    'allergy',
    'allergic',
    'allergies',
    'medication',
    'medicine',
    'drug',
    'medical',
    'health',
    'diagnosis',
    'emergency',
    'epipen',
    'anaphylaxis',
    // Safety
    'danger',
    'dangerous',
    'warning',
    'never',
    'must not',
    'do not',
    'critical',
    'fatal',
    'lethal',
    // Sensitive
    'password',
    'secret',
    'confidential',
    'ssn',
    'social security',
  ],
  protectedImportanceThreshold: 0.9,
  alwaysReviewTypes: [MemoryType.LESSON, MemoryType.CONSTRAINT],
};

/**
 * Safety Service
 *
 * Handles safety checks for memory deduplication.
 * Prevents auto-merging of protected memories like:
 * - CONSTRAINT type memories
 * - Memories containing allergy/medical keywords
 * - High-importance memories
 */
@Injectable()
export class SafetyService {
  private config: SafetyConfig;

  constructor(private prisma: PrismaService) {
    this.config = { ...DEFAULT_SAFETY_CONFIG };
  }

  /**
   * Update safety configuration
   */
  updateConfig(updates: Partial<SafetyConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Get current safety configuration
   */
  getConfig(): SafetyConfig {
    return { ...this.config };
  }

  /**
   * Check if a memory is safe to auto-merge
   */
  async checkMemorySafety(memoryId: string): Promise<SafetyCheckResultDto> {
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      select: {
        id: true,
        raw: true,
        memoryType: true,
        importanceScore: true,
        lastRetrievedAt: true,
        userPinned: true,
      },
    });

    if (!memory) {
      throw new Error(`Memory not found: ${memoryId}`);
    }

    const reasons: SafetyReasonDto[] = [];

    // Check protected types
    if (memory.memoryType && this.config.protectedTypes.includes(memory.memoryType)) {
      reasons.push({
        type: SafetyReasonType.PROTECTED_TYPE,
        memoryType: memory.memoryType,
      });
    }

    // Check keywords in content
    const contentLower = memory.raw.toLowerCase();
    for (const keyword of this.config.protectedKeywords) {
      if (contentLower.includes(keyword.toLowerCase())) {
        reasons.push({
          type: SafetyReasonType.PROTECTED_KEYWORD,
          keyword,
        });
        break; // One match is enough
      }
    }

    // Check importance score
    if (memory.importanceScore >= this.config.protectedImportanceThreshold) {
      reasons.push({
        type: SafetyReasonType.HIGH_IMPORTANCE,
        score: memory.importanceScore,
      });
    }

    // Check if requires review (LESSON, etc.)
    if (memory.memoryType && this.config.alwaysReviewTypes.includes(memory.memoryType)) {
      reasons.push({
        type: SafetyReasonType.REQUIRES_REVIEW,
        memoryType: memory.memoryType,
      });
    }

    // Check recent access (within 24 hours)
    if (memory.lastRetrievedAt) {
      const recentThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
      if (memory.lastRetrievedAt > recentThreshold) {
        reasons.push({
          type: SafetyReasonType.RECENTLY_ACCESSED,
          lastAccessed: memory.lastRetrievedAt,
        });
      }
    }

    // Check if user pinned
    if (memory.userPinned) {
      reasons.push({
        type: SafetyReasonType.MANUALLY_EDITED,
      });
    }

    const isProtected = reasons.some(
      (r) => r.type === SafetyReasonType.PROTECTED_TYPE || r.type === SafetyReasonType.PROTECTED_KEYWORD,
    );

    const requiresReview = reasons.some(
      (r) =>
        r.type === SafetyReasonType.REQUIRES_REVIEW ||
        r.type === SafetyReasonType.HIGH_IMPORTANCE ||
        r.type === SafetyReasonType.MANUALLY_EDITED,
    );

    return {
      memoryId,
      isProtected,
      canAutoMerge: !isProtected && !requiresReview,
      requiresReview,
      reasons,
    };
  }

  /**
   * Check safety for multiple memories at once
   */
  async checkMultipleSafety(memoryIds: string[]): Promise<SafetyCheckResultDto[]> {
    return Promise.all(memoryIds.map((id) => this.checkMemorySafety(id)));
  }

  /**
   * Check if a pair of memories can be auto-merged
   */
  async canAutoMergePair(memoryIdA: string, memoryIdB: string): Promise<{
    canAutoMerge: boolean;
    reasons: SafetyReasonDto[];
  }> {
    const [safetyA, safetyB] = await Promise.all([
      this.checkMemorySafety(memoryIdA),
      this.checkMemorySafety(memoryIdB),
    ]);

    const allReasons = [...safetyA.reasons, ...safetyB.reasons];
    const canAutoMerge = safetyA.canAutoMerge && safetyB.canAutoMerge;

    return { canAutoMerge, reasons: allReasons };
  }

  /**
   * Check if content contains protected keywords
   */
  containsProtectedKeywords(content: string): { contains: boolean; keywords: string[] } {
    const contentLower = content.toLowerCase();
    const foundKeywords: string[] = [];

    for (const keyword of this.config.protectedKeywords) {
      if (contentLower.includes(keyword.toLowerCase())) {
        foundKeywords.push(keyword);
      }
    }

    return { contains: foundKeywords.length > 0, keywords: foundKeywords };
  }

  /**
   * Check if memory type is protected
   */
  isProtectedType(memoryType: MemoryType | null): boolean {
    if (!memoryType) return false;
    return this.config.protectedTypes.includes(memoryType);
  }

  /**
   * Check if memory type requires review
   */
  requiresReviewType(memoryType: MemoryType | null): boolean {
    if (!memoryType) return false;
    return this.config.alwaysReviewTypes.includes(memoryType);
  }
}
