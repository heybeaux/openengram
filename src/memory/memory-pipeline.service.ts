import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ExtractionService,
  ExtractionContext,
  EntityWithType,
} from './extraction.service';
import { EmbeddingService } from './embedding.service';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { parseFlexibleDate } from '../utils/date-parser';
import { RELATED_SIMILARITY_THRESHOLD, DEDUP_SIMILARITY_THRESHOLD } from './memory-dedup.service';

@Injectable()
export class MemoryPipelineService {
  constructor(
    private prisma: PrismaService,
    private extraction: ExtractionService,
    private embedding: EmbeddingService,
    @Optional() private hierarchyService?: HierarchyService,
  ) {}

  /**
   * Extract 5W1H structure and generate embedding for a memory
   */
  async extractAndEmbed(
    memoryId: string,
    raw: string,
    userId: string,
    context?: ExtractionContext,
  ): Promise<void> {
    const inputPreview = raw.length > 80 ? raw.substring(0, 80) + '...' : raw;

    console.log('[Memory] extractAndEmbed starting:', {
      memoryId,
      inputPreview,
      userId,
      userName: context?.userName,
    });

    // 1. Extract 5W1H structure with user context
    const extracted = await this.extraction.extract(raw, context);

    console.log('[Memory] Extraction result:', {
      memoryId,
      who: extracted.who,
      what: extracted.what?.substring(0, 50),
      hasWhen: !!extracted.when,
      hasWhere: !!extracted.where,
      hasWhy: !!extracted.why,
      hasHow: !!extracted.how,
      topicCount: extracted.topics.length,
      topics: extracted.topics,
      entityCount: extracted.entities.length,
      entities: extracted.entities.map((e) => ({ name: e.name, type: e.type })),
    });

    // 2. Build source metadata
    const sourceMetadata = context
      ? {
          source: {
            timestamp: context.timestamp?.toISOString(),
            turnIndex: context.turnIndex,
            conversationId: context.conversationId,
            userName: context.userName,
          },
        }
      : undefined;

    // 3. Save extraction
    const parsedWhen = parseFlexibleDate(
      extracted.when,
      context?.timestamp ?? new Date(),
    );

    if (extracted.when && !parsedWhen) {
      console.warn('[Memory] Could not parse date:', {
        memoryId,
        rawWhen: extracted.when,
        contextTimestamp: context?.timestamp?.toISOString(),
      });
    }

    const rawJsonData = {
      ...sourceMetadata,
      ...(extracted.lesson
        ? { lesson: JSON.parse(JSON.stringify(extracted.lesson)) }
        : {}),
    };

    await this.prisma.memoryExtraction.create({
      data: {
        memoryId,
        who: extracted.who,
        what: extracted.what,
        when: parsedWhen,
        whereCtx: extracted.where,
        why: extracted.why,
        how: extracted.how,
        topics: extracted.topics,
        rawJson:
          Object.keys(rawJsonData).length > 0
            ? (rawJsonData as any)
            : undefined,
        memoryType: extracted.memoryType,
        typeConfidence: extracted.typeConfidence,
        whoConfidence: extracted.confidence.whoConfidence,
        whatConfidence: extracted.confidence.whatConfidence,
        whenConfidence: extracted.confidence.whenConfidence,
        whereConfidence: extracted.confidence.whereConfidence,
        whyConfidence: extracted.confidence.whyConfidence,
        howConfidence: extracted.confidence.howConfidence,
      },
    });
    console.log('[Memory] MemoryExtraction saved for:', memoryId, {
      parsedWhen: parsedWhen?.toISOString() ?? null,
      memoryType: extracted.memoryType,
      typeConfidence: extracted.typeConfidence,
      confidence: extracted.confidence,
    });

    // Update memory record with type and priority
    if (extracted.memoryType) {
      const priority = this.extraction.getPriorityForType(extracted.memoryType);
      await this.prisma.memory.update({
        where: { id: memoryId },
        data: {
          memoryType: extracted.memoryType,
          typeConfidence: extracted.typeConfidence,
          priority,
        },
      });
      console.log('[Memory] Memory Intelligence updated:', {
        memoryId,
        memoryType: extracted.memoryType,
        priority,
      });

      // LESSON auto-promotion
      if (
        extracted.memoryType === 'LESSON' &&
        extracted.lesson?.lessonSeverity === 'critical'
      ) {
        await this.promoteToConstraint(memoryId);
      }
    }

    // 4. Store extracted entities
    if (extracted.entities && extracted.entities.length > 0) {
      console.log('[Memory] Storing entities:', {
        memoryId,
        count: extracted.entities.length,
        entities: extracted.entities.map((e) => `${e.name}:${e.type}`),
      });
      await this.storeEntities(userId, memoryId, extracted.entities);
      console.log('[Memory] Entities stored successfully for:', memoryId);
    } else {
      console.log('[Memory] No entities to store for:', memoryId);
    }

    // 5. Generate and store embedding
    try {
      const embedding = await this.embedding.generate(raw);
      const embeddingId = await this.embedding.store(memoryId, embedding);
      console.log('[Memory] Embedding stored:', { memoryId, embeddingId });

      await this.prisma.memory.update({
        where: { id: memoryId },
        data: { embeddingId },
      });

      // 7. Link to related memories
      await this.linkRelatedMemories(memoryId, embedding, userId);
    } catch (embedError) {
      console.warn(
        `[Memory] Embedding failed for ${memoryId} — memory saved without embedding, will retry later:`,
        embedError instanceof Error ? embedError.message : embedError,
      );
    }

    console.log('[Memory] extractAndEmbed complete:', memoryId);

    // 8. Process hierarchical embeddings
    if (this.hierarchyService?.isEnabled()) {
      this.hierarchyService
        .processMemory(memoryId, raw, userId)
        .catch((err) => {
          console.error(
            `[Memory] Hierarchy processing failed for ${memoryId}:`,
            err,
          );
        });
    }
  }

  /**
   * Store extracted entities and link them to the memory
   */
  async storeEntities(
    userId: string,
    memoryId: string,
    entities: EntityWithType[],
  ): Promise<void> {
    for (const entity of entities) {
      try {
        const normalizedName = entity.name.toLowerCase().trim();

        const existingEntity = await this.prisma.entity.findUnique({
          where: {
            userId_normalizedName_type: {
              userId,
              normalizedName,
              type: entity.type,
            },
          },
        });

        let entityId: string;

        if (existingEntity) {
          entityId = existingEntity.id;
        } else {
          const newEntity = await this.prisma.entity.create({
            data: {
              userId,
              name: entity.name,
              normalizedName,
              type: entity.type,
            },
          });
          entityId = newEntity.id;
        }

        await this.prisma.memoryEntity.upsert({
          where: {
            memoryId_entityId: { memoryId, entityId },
          },
          create: { memoryId, entityId },
          update: {},
        });
      } catch (error) {
        console.error(`Failed to store entity ${entity.name}:`, error);
      }
    }
  }

  /**
   * Link this memory to related memories based on embedding similarity
   */
  async linkRelatedMemories(
    memoryId: string,
    embedding: number[],
    userId: string,
  ): Promise<void> {
    try {
      const similar = await this.embedding.search(userId, embedding, 10);

      const related = similar.filter(
        (m) =>
          m.id !== memoryId &&
          m.score >= RELATED_SIMILARITY_THRESHOLD &&
          m.score < DEDUP_SIMILARITY_THRESHOLD,
      );

      if (related.length > 0) {
        console.debug(
          `[linkRelatedMemories] Memory ${memoryId}: found ${related.length} linkable memories (scores: ${related.map((r) => r.score.toFixed(3)).join(', ')})`,
        );
      }

      let linksCreated = 0;
      for (const match of related) {
        try {
          await this.prisma.memoryChainLink.upsert({
            where: {
              sourceId_targetId_linkType: {
                sourceId: memoryId,
                targetId: match.id,
                linkType: 'RELATED',
              },
            },
            create: {
              sourceId: memoryId,
              targetId: match.id,
              linkType: 'RELATED',
              confidence: match.score,
              createdBy: 'system',
            },
            update: {
              confidence: match.score,
            },
          });
          linksCreated++;
        } catch (error) {
          console.debug(
            `[linkRelatedMemories] Link skipped (may exist): ${memoryId} -> ${match.id}`,
          );
        }
      }

      if (linksCreated > 0) {
        console.debug(
          `[linkRelatedMemories] Memory ${memoryId}: created ${linksCreated} links`,
        );
      }
    } catch (error) {
      console.error(
        '[linkRelatedMemories] Failed to link related memories:',
        error,
      );
    }
  }

  /**
   * Promote a LESSON memory to CONSTRAINT
   */
  async promoteToConstraint(memoryId: string): Promise<void> {
    await this.prisma.memory.update({
      where: { id: memoryId },
      data: {
        memoryType: 'CONSTRAINT',
        priority: 1,
        promotedFrom: memoryId,
      },
    });
    console.log(
      `[LESSON→CONSTRAINT] Auto-promoted critical lesson: ${memoryId}`,
    );
  }
}
