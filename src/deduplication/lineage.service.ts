import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from '../memory/embedding.service';
import { MergeResult } from './merge.service';
import { MergeStrategy, MergeEventDto } from './dto/deduplication.dto';

/**
 * Original content preserved in merge event
 */
interface OriginalContent {
  memoryId: string;
  content: string;
  createdAt: Date;
}

/**
 * Lineage Service
 *
 * Tracks merge history and enables rollback of merges.
 * Preserves original content for audit and recovery.
 */
@Injectable()
export class LineageService {
  constructor(
    private prisma: PrismaService,
    private embedding: EmbeddingService,
  ) {}

  /**
   * Record a merge event and update memory state
   */
  async recordMerge(
    userId: string,
    result: MergeResult,
    trigger: 'auto' | 'batch' | 'manual',
    similarity: number,
    approvedBy?: string,
  ): Promise<MergeEventDto> {
    // Fetch original contents before soft-delete
    const absorbedMemories = await this.prisma.memory.findMany({
      where: { id: { in: result.absorbedIds } },
      select: {
        id: true,
        raw: true,
        createdAt: true,
      },
    });

    const originalContents: OriginalContent[] = absorbedMemories.map((m) => ({
      memoryId: m.id,
      content: m.raw,
      createdAt: m.createdAt,
    }));

    // Create merge event
    const event = await this.prisma.memoryMergeEvent.create({
      data: {
        userId,
        survivorMemoryId: result.survivorId,
        absorbedMemoryIds: result.absorbedIds,
        strategy: result.strategy,
        similarity,
        triggeredBy: trigger,
        approvedBy,
        originalContents: JSON.stringify(originalContents),
        mergedContent: result.mergedContent,
        contentChanged: result.contentChanged,
        canRollback: true,
      },
    });

    // Update survivor memory
    await this.prisma.memory.update({
      where: { id: result.survivorId },
      data: {
        raw: result.mergedContent,
        importanceScore: result.mergedMetadata.importanceScore,
        retrievalCount: {
          increment: result.mergedMetadata.accessCount,
        },
        lastRetrievedAt: result.mergedMetadata.lastAccessedAt ?? undefined,
      },
    });

    // Soft-delete absorbed memories
    await this.prisma.memory.updateMany({
      where: { id: { in: result.absorbedIds } },
      data: {
        deletedAt: new Date(),
        supersededById: result.survivorId,
        supersededAt: new Date(),
      },
    });

    // Delete absorbed memories from vector store
    for (const absorbedId of result.absorbedIds) {
      try {
        await this.embedding.delete(absorbedId);
      } catch (error) {
        console.warn(`Failed to delete vector for ${absorbedId}:`, error);
      }
    }

    // Re-embed survivor if content changed
    if (result.contentChanged) {
      try {
        const memory = await this.prisma.memory.findUnique({
          where: { id: result.survivorId },
          select: {
            userId: true,
            layer: true,
            importanceScore: true,
            createdAt: true,
          },
        });

        if (memory) {
          const newEmbedding = await this.embedding.generate(
            result.mergedContent,
          );
          await this.embedding.store(result.survivorId, newEmbedding, {
            userId: memory.userId,
            layer: memory.layer,
            importance: memory.importanceScore,
            createdAt: memory.createdAt,
          });
        }
      } catch (error) {
        console.warn(
          `Failed to re-embed survivor ${result.survivorId}:`,
          error,
        );
      }
    }

    return this.toDto(event);
  }

  /**
   * Rollback a merge event
   */
  async rollbackMerge(mergeEventId: string): Promise<{
    success: boolean;
    restoredMemoryIds: string[];
    survivorId: string;
  }> {
    const event = await this.prisma.memoryMergeEvent.findUnique({
      where: { id: mergeEventId },
    });

    if (!event) {
      throw new Error(`Merge event not found: ${mergeEventId}`);
    }

    if (!event.canRollback) {
      throw new Error('This merge cannot be rolled back');
    }

    if (event.rolledBackAt) {
      throw new Error('This merge has already been rolled back');
    }

    // Parse original contents
    const originalContents = JSON.parse(
      event.originalContents,
    ) as OriginalContent[];

    // Restore absorbed memories
    for (const original of originalContents) {
      // Restore the memory
      await this.prisma.memory.update({
        where: { id: original.memoryId },
        data: {
          deletedAt: null,
          supersededById: null,
          supersededAt: null,
          raw: original.content,
        },
      });

      // Re-add to vector store
      try {
        const memory = await this.prisma.memory.findUnique({
          where: { id: original.memoryId },
          select: {
            userId: true,
            layer: true,
            importanceScore: true,
            createdAt: true,
          },
        });

        if (memory) {
          const embedding = await this.embedding.generate(original.content);
          await this.embedding.store(original.memoryId, embedding, {
            userId: memory.userId,
            layer: memory.layer,
            importance: memory.importanceScore,
            createdAt: memory.createdAt,
          });
        }
      } catch (error) {
        console.warn(
          `Failed to restore vector for ${original.memoryId}:`,
          error,
        );
      }
    }

    // If content was changed, revert survivor
    if (event.contentChanged) {
      // Find survivor's pre-merge content from a previous merge event or use original
      const previousContent = await this.findPreMergeContent(
        event.survivorMemoryId,
        mergeEventId,
      );

      if (previousContent) {
        await this.prisma.memory.update({
          where: { id: event.survivorMemoryId },
          data: { raw: previousContent },
        });

        // Re-embed with original content
        try {
          const memory = await this.prisma.memory.findUnique({
            where: { id: event.survivorMemoryId },
            select: {
              userId: true,
              layer: true,
              importanceScore: true,
              createdAt: true,
            },
          });

          if (memory) {
            const embedding = await this.embedding.generate(previousContent);
            await this.embedding.store(event.survivorMemoryId, embedding, {
              userId: memory.userId,
              layer: memory.layer,
              importance: memory.importanceScore,
              createdAt: memory.createdAt,
            });
          }
        } catch (error) {
          console.warn(
            `Failed to re-embed survivor ${event.survivorMemoryId}:`,
            error,
          );
        }
      }
    }

    // Mark event as rolled back
    await this.prisma.memoryMergeEvent.update({
      where: { id: mergeEventId },
      data: {
        rolledBackAt: new Date(),
        canRollback: false,
      },
    });

    return {
      success: true,
      restoredMemoryIds: event.absorbedMemoryIds,
      survivorId: event.survivorMemoryId,
    };
  }

  /**
   * Get merge history for a user
   */
  async getMergeHistory(
    userId: string,
    options: {
      limit?: number;
      offset?: number;
      survivorId?: string;
    } = {},
  ): Promise<{ events: MergeEventDto[]; total: number }> {
    const { limit = 50, offset = 0, survivorId } = options;

    const where = {
      userId,
      ...(survivorId ? { survivorMemoryId: survivorId } : {}),
    };

    const [events, total] = await Promise.all([
      this.prisma.memoryMergeEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.memoryMergeEvent.count({ where }),
    ]);

    return {
      events: events.map((e) => this.toDto(e)),
      total,
    };
  }

  /**
   * Get merge event by ID
   */
  async getMergeEvent(mergeEventId: string): Promise<MergeEventDto | null> {
    const event = await this.prisma.memoryMergeEvent.findUnique({
      where: { id: mergeEventId },
    });

    return event ? this.toDto(event) : null;
  }

  /**
   * Get merge lineage for a specific memory
   */
  async getMemoryLineage(memoryId: string): Promise<{
    mergedFrom: string[];
    mergedInto: string | null;
    mergeEvents: MergeEventDto[];
  }> {
    // Get memories this was merged from (as survivor)
    const asSurvivor = await this.prisma.memoryMergeEvent.findMany({
      where: { survivorMemoryId: memoryId, rolledBackAt: null },
    });

    const mergedFrom = asSurvivor.flatMap((e) => e.absorbedMemoryIds);

    // Get memory this was merged into (as absorbed)
    const asAbsorbed = await this.prisma.memoryMergeEvent.findFirst({
      where: {
        absorbedMemoryIds: { has: memoryId },
        rolledBackAt: null,
      },
    });

    const mergedInto = asAbsorbed?.survivorMemoryId ?? null;

    return {
      mergedFrom: [...new Set(mergedFrom)],
      mergedInto,
      mergeEvents: asSurvivor.map((e) => this.toDto(e)),
    };
  }

  /**
   * Find the pre-merge content for a survivor memory
   */
  private async findPreMergeContent(
    survivorId: string,
    excludeEventId: string,
  ): Promise<string | null> {
    // Look for an earlier merge event where this was the survivor
    const earlierEvent = await this.prisma.memoryMergeEvent.findFirst({
      where: {
        survivorMemoryId: survivorId,
        id: { not: excludeEventId },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (earlierEvent) {
      return earlierEvent.mergedContent;
    }

    // If no earlier merge, look at original memory (shouldn't happen if content changed)
    const memory = await this.prisma.memory.findUnique({
      where: { id: survivorId },
      select: { raw: true },
    });

    return memory?.raw ?? null;
  }

  /**
   * Convert database model to DTO
   */
  private toDto(event: any): MergeEventDto {
    return {
      id: event.id,
      survivorMemoryId: event.survivorMemoryId,
      absorbedMemoryIds: event.absorbedMemoryIds,
      strategy: event.strategy as MergeStrategy,
      similarity: event.similarity,
      triggeredBy: event.triggeredBy,
      approvedBy: event.approvedBy ?? undefined,
      mergedContent: event.mergedContent,
      contentChanged: event.contentChanged,
      canRollback: event.canRollback,
      rolledBackAt: event.rolledBackAt ?? undefined,
      createdAt: event.createdAt,
    };
  }
}
