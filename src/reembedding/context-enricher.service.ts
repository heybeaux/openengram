import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Memory, MemoryExtraction, Entity, MemoryEntity } from '@prisma/client';
import { formatDistanceToNow, format } from 'date-fns';

/**
 * Result of enriching a memory's context
 */
export interface EnrichmentResult {
  originalContent: string;
  enrichedContent: string;
  metadata: {
    temporalContext?: string;
    entityContext?: string;
    importanceContext?: string;
    enrichmentVersion: string;
    enrichedAt: Date;
  };
}

/**
 * Memory with all relations needed for enrichment
 */
export interface MemoryWithRelations extends Memory {
  extraction?: MemoryExtraction | null;
  entities?: Array<MemoryEntity & { entity: Entity }>;
}

/**
 * Context Enricher Service
 * 
 * MVP Implementation: Builds enriched text for memories by prepending
 * contextual prefixes that improve semantic search quality.
 * 
 * Enrichment categories (MVP):
 * - Temporal: "From [date], [relative time]"
 * - Entity: "About [entity names]"
 * - Importance: "[High importance]" prefix for high-scoring memories
 */
@Injectable()
export class ContextEnricherService {
  // Current enrichment algorithm version
  static readonly ENRICHMENT_VERSION = '1.0.0';

  // Importance thresholds
  private readonly HIGH_IMPORTANCE_THRESHOLD = 0.7;
  private readonly CRITICAL_IMPORTANCE_THRESHOLD = 0.9;

  constructor(private prisma: PrismaService) {}

  /**
   * Enrich a memory with contextual prefixes
   * 
   * @param memory - Memory with extraction and entities loaded
   * @returns EnrichmentResult with original and enriched content
   */
  async enrich(memory: MemoryWithRelations): Promise<EnrichmentResult> {
    const prefixes: string[] = [];
    const metadata: EnrichmentResult['metadata'] = {
      enrichmentVersion: ContextEnricherService.ENRICHMENT_VERSION,
      enrichedAt: new Date(),
    };

    // 1. Generate temporal context
    const temporalContext = this.generateTemporalContext(memory);
    if (temporalContext) {
      prefixes.push(temporalContext);
      metadata.temporalContext = temporalContext;
    }

    // 2. Generate entity context
    const entityContext = await this.generateEntityContext(memory);
    if (entityContext) {
      prefixes.push(entityContext);
      metadata.entityContext = entityContext;
    }

    // 3. Generate importance context
    const importanceContext = this.generateImportanceContext(memory);
    if (importanceContext) {
      prefixes.push(importanceContext);
      metadata.importanceContext = importanceContext;
    }

    // Compose enriched content
    const prefix = prefixes.length > 0 ? prefixes.join(' ') + '\n\n' : '';
    const enrichedContent = prefix + memory.raw;

    return {
      originalContent: memory.raw,
      enrichedContent,
      metadata,
    };
  }

  /**
   * Generate temporal context prefix
   * Format: "From [absolute date], [relative time]."
   * 
   * Examples:
   * - "From February 5, 2026, 1 day ago."
   * - "From October 2025, 4 months ago."
   */
  private generateTemporalContext(memory: MemoryWithRelations): string | null {
    const date = memory.createdAt;
    if (!date) return null;

    try {
      const absoluteDate = format(date, 'MMMM d, yyyy');
      const relativeTime = formatDistanceToNow(date, { addSuffix: true });

      return `[Time: ${absoluteDate}, ${relativeTime}]`;
    } catch (error) {
      console.warn('[ContextEnricher] Failed to generate temporal context:', error);
      return null;
    }
  }

  /**
   * Generate entity context prefix
   * Format: "About [entity names]."
   * 
   * Examples:
   * - "About Stella, Deanna."
   * - "About Engram, NestJS."
   */
  private async generateEntityContext(
    memory: MemoryWithRelations,
  ): Promise<string | null> {
    // Use entities already loaded on the memory
    if (memory.entities && memory.entities.length > 0) {
      const entityNames = memory.entities
        .map((me) => me.entity.name)
        .slice(0, 5) // Limit to 5 entities for conciseness
        .join(', ');

      return `[About: ${entityNames}]`;
    }

    // Fallback: Query entities if not preloaded
    const memoryEntities = await this.prisma.memoryEntity.findMany({
      where: { memoryId: memory.id },
      include: { entity: true },
      take: 5,
    });

    if (memoryEntities.length === 0) return null;

    const entityNames = memoryEntities.map((me) => me.entity.name).join(', ');
    return `[About: ${entityNames}]`;
  }

  /**
   * Generate importance context prefix
   * Format: "[High importance]" or "[Critical importance]"
   * 
   * Only added for memories above the importance threshold
   */
  private generateImportanceContext(memory: MemoryWithRelations): string | null {
    // Use effectiveScore (Memory Intelligence v2) or fall back to importanceScore
    const score = memory.effectiveScore ?? memory.importanceScore;

    if (score >= this.CRITICAL_IMPORTANCE_THRESHOLD || memory.safetyCritical) {
      return '[Critical importance]';
    }

    if (score >= this.HIGH_IMPORTANCE_THRESHOLD) {
      return '[High importance]';
    }

    return null;
  }

  /**
   * Get a memory with all relations needed for enrichment
   */
  async getMemoryForEnrichment(memoryId: string): Promise<MemoryWithRelations | null> {
    return this.prisma.memory.findUnique({
      where: { id: memoryId },
      include: {
        extraction: true,
        entities: {
          include: { entity: true },
        },
      },
    });
  }

  /**
   * Batch fetch memories for enrichment
   */
  async getMemoriesForEnrichment(
    options: {
      userId?: string;
      staleDays?: number;
      limit?: number;
    } = {},
  ): Promise<MemoryWithRelations[]> {
    const { userId, staleDays, limit = 100 } = options;

    const where: any = {
      deletedAt: null,
    };

    if (userId) {
      where.userId = userId;
    }

    // If staleDays is specified, only get memories older than that
    // This is for finding memories that haven't been re-embedded recently
    // In MVP, we don't track lastEmbeddedAt, so this filters by createdAt
    if (staleDays !== undefined && staleDays > 0) {
      const staleDate = new Date();
      staleDate.setDate(staleDate.getDate() - staleDays);
      where.createdAt = { lt: staleDate };
    }

    return this.prisma.memory.findMany({
      where,
      include: {
        extraction: true,
        entities: {
          include: { entity: true },
        },
      },
      orderBy: { createdAt: 'asc' }, // Oldest first for batch processing
      take: limit,
    });
  }
}
