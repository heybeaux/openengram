import {
  Injectable,
  Inject,
  Optional,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  MemoryCreatedEvent,
  MemoryUpdatedEvent,
  MemoryDeletedEvent,
} from '../events/event-types';
import { PrismaService } from '../prisma/prisma.service';
import { ExtractionService, ExtractionContext } from './extraction.service';
import { EmbeddingService } from './embedding.service';
import { ImportanceService } from './importance.service';
import { TemporalParserService } from './temporal/temporal-parser.service';
import { CreateMemoryDto, CreateMemoryBatchDto } from './dto/create-memory.dto';
import { ExportedMemory, ImportMemoryItemDto, ImportResult } from './dto/export-import.dto';
import { QueryMemoryDto, LoadContextDto } from './dto/query-memory.dto';
import { UpdateMemoryDto, CorrectMemoryDto } from './dto/update-memory.dto';
import { Memory, MemoryLayer, MemorySource, SubjectType } from '@prisma/client';
import { parseFlexibleDate } from '../utils/date-parser';
import { CorrectionService } from '../correction/correction.service';
import {
  MultiQueryMetadataDto,
  ResultExplanationDto,
} from '../multi-query/dto/multi-query.dto';
import { MemoryPoolService } from '../memory-pool/memory-pool.service';
import { MemoryAccessLogService } from '../memory-access-log/memory-access-log.service';

// Extracted services
import { MemoryDedupService, SOURCE_CONFIDENCE } from './memory-dedup.service';
import { MemoryQueryService } from './memory-query.service';
import { MemoryPipelineService } from './memory-pipeline.service';
import { MemoryGraphService } from './memory-graph.service';

// Re-export types for backward compatibility
export interface MemoryWithExtraction extends Memory {
  extraction?: {
    who: string | null;
    what: string | null;
    when: Date | null;
    whereCtx: string | null;
    why: string | null;
    how: string | null;
    topics: string[];
  } | null;
  chain?: MemoryWithExtraction[];
}

export interface MemoryWithScore extends MemoryWithExtraction {
  score?: number;
}

export interface QueryResult {
  memories: MemoryWithScore[];
  queryTokens: number;
  latencyMs: number;
  multiQuery?: MultiQueryMetadataDto;
  explanations?: Record<string, ResultExplanationDto>;
}

export interface ContextResult {
  context: string;
  tokenCount: number;
  memoriesIncluded: number;
  layers: {
    identity: number;
    project: number;
    session: number;
    agent?: number;
  };
}

@Injectable()
export class MemoryService {
  constructor(
    private prisma: PrismaService,
    private extraction: ExtractionService,
    private embedding: EmbeddingService,
    private importance: ImportanceService,
    private temporalParser: TemporalParserService,
    private dedupService: MemoryDedupService,
    private queryService: MemoryQueryService,
    private pipelineService: MemoryPipelineService,
    private graphService: MemoryGraphService,
    @Optional() private correctionService?: CorrectionService,
    @Optional() private memoryPoolService?: MemoryPoolService,
    @Optional() private memoryAccessLogService?: MemoryAccessLogService,
    @Optional() private eventEmitter?: EventEmitter2,
  ) {}

  /**
   * Create a single memory
   */
  async remember(
    userId: string,
    dto: CreateMemoryDto,
  ): Promise<MemoryWithExtraction> {
    const rawContent = dto.raw || (dto as any).content;
    if (!rawContent) {
      throw new Error(
        'Memory content is required (use "raw" or "content" field)',
      );
    }

    // 1. Fetch user info for extraction context
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, externalId: true, displayName: true },
    });

    // 2. Determine source type
    const source = dto.source ?? MemorySource.EXPLICIT_STATEMENT;

    // 3. Check for duplicates (three-tier dedup v2)
    const dedupResult = await this.dedupService.findDuplicateV2(
      userId,
      rawContent,
    );
    if (dedupResult.action !== 'create' && dedupResult.existingMemory) {
      if (dedupResult.action === 'merged') {
        await this.dedupService.autoMergeMemory(
          dedupResult.existingMemory.id,
          rawContent,
          source,
        );
      } else if (dedupResult.action === 'reinforced') {
        await this.dedupService.reinforceMemory(
          dedupResult.existingMemory.id,
          dto.context?.sessionId,
        );
      }
      return this.getById(
        dedupResult.existingMemory.id,
      ) as Promise<MemoryWithExtraction>;
    }

    // 4. Calculate initial importance score
    const importanceScore = this.importance.calculate({
      hint: dto.importanceHint,
      layer: dto.layer,
    });

    // 5. Set confidence based on source type
    const confidence = SOURCE_CONFIDENCE[source] ?? 1.0;

    // 6. Resolve sessionId
    const sessionId = await this.resolveSessionId(
      userId,
      dto.context?.sessionId,
    );

    // 7a. Determine layer
    let layer = dto.layer;
    if (!layer) {
      layer = this.extraction.classifyLayer(rawContent);
      console.log('[Memory] Smart layer classification:', {
        rawPreview: rawContent.substring(0, 50),
        layer,
      });
    }

    // 7b. Determine subject fields
    const subjectType = dto.subjectType ?? SubjectType.USER;
    const subjectId =
      dto.subjectId ??
      (subjectType === SubjectType.USER ? userId : dto.agentId);

    // 7. Create memory record
    const memory = await this.prisma.memory.create({
      data: {
        userId,
        raw: rawContent,
        layer,
        source,
        importanceHint: dto.importanceHint,
        importanceScore,
        confidence,
        projectId: dto.context?.projectId,
        sessionId,
        subjectType,
        subjectId,
        agentId: dto.agentId,
        createdBySession: dto.agentSessionKey ?? undefined,
      },
    });

    // v0.7: Auto-add to global pool and log creation
    if (dto.agentSessionKey) {
      this.addToGlobalPoolAndLog(memory.id, userId, dto.agentSessionKey).catch(
        (err) => {
          console.error(
            `[Memory] Failed to add to global pool / log creation for ${memory.id}:`,
            err,
          );
        },
      );
    }

    // v0.9: Pool-scoped memory write
    if (dto.poolId && this.memoryPoolService) {
      this.memoryPoolService
        .addMemory(dto.poolId, {
          memoryId: memory.id,
          addedBy: dto.agentSessionKey ?? 'system',
        })
        .catch((err) => {
          console.error(
            `[Memory] Failed to add memory ${memory.id} to pool ${dto.poolId}:`,
            err,
          );
        });
    }

    // 8. Build extraction context
    const extractionContext: ExtractionContext = {
      userId,
      userName: user?.displayName || user?.externalId,
      timestamp: dto.sourceTimestamp ?? new Date(),
      turnIndex: dto.sourceTurnIndex,
      conversationId: dto.context?.sessionId,
    };

    // 9. Extract structure asynchronously
    this.pipelineService
      .extractAndEmbed(memory.id, rawContent, userId, extractionContext)
      .catch((err) => {
        console.error(`Extraction failed for memory ${memory.id}:`, err);
      });

    // 10a. Increment account memoriesUsed
    this.incrementMemoriesUsed(userId, 1).catch((err) => {
      console.error(`[Memory] Failed to increment memoriesUsed:`, err);
    });

    // 10. Emit memory.created event
    this.emitEvent(
      'memory.created',
      new MemoryCreatedEvent(
        memory.id,
        memory.layer,
        importanceScore,
        [],
        userId,
        rawContent.substring(0, 200),
      ),
    );

    // 11. Check for contradictions
    if (this.correctionService) {
      this.correctionService
        .checkForContradictions(memory.id, userId, rawContent)
        .catch((err) => {
          console.error(
            `[Correction] Contradiction check failed for memory ${memory.id}:`,
            err,
          );
        });
    }

    return memory;
  }

  /**
   * v0.7: Add memory to global pool and log creation
   */
  private async addToGlobalPoolAndLog(
    memoryId: string,
    userId: string,
    agentSessionKey: string,
  ): Promise<void> {
    const globalPool = await this.prisma.memoryPool.findFirst({
      where: { userId, name: 'global', visibility: 'GLOBAL', archivedAt: null },
      select: { id: true },
    });
    if (globalPool) {
      try {
        await this.prisma.memoryPoolMembership.create({
          data: {
            memoryId,
            poolId: globalPool.id,
            addedBy: agentSessionKey,
          },
        });
      } catch (err: any) {
        if (!err?.code?.includes('P2002')) throw err;
      }
    }

    if (this.memoryAccessLogService) {
      this.memoryAccessLogService
        .logCreated(memoryId, agentSessionKey)
        .catch(() => {});
    }
  }

  /**
   * Create multiple memories in batch
   */
  async rememberAll(
    userId: string,
    dto: CreateMemoryBatchDto,
  ): Promise<{ created: number; failed: number }> {
    let created = 0;
    let failed = 0;

    for (const item of dto.memories) {
      try {
        await this.remember(userId, {
          raw: item.raw,
          layer: item.layer,
          importanceHint: item.importanceHint,
          context: dto.context,
        });
        created++;
      } catch (err) {
        console.error('Batch create failed:', err);
        failed++;
      }
    }

    return { created, failed };
  }

  /**
   * Semantic search for memories — delegates to MemoryQueryService
   */
  async recall(userId: string, dto: QueryMemoryDto): Promise<QueryResult> {
    return this.queryService.recall(userId, dto);
  }

  /**
   * Load context for session start — delegates to MemoryQueryService
   */
  async loadContext(
    userId: string,
    dto: LoadContextDto,
  ): Promise<ContextResult> {
    return this.queryService.loadContext(userId, dto);
  }

  /**
   * Verify memory ownership. Throws if not found or not owned by userId.
   */
  private async verifyOwnership(
    memoryId: string,
    userId: string,
  ): Promise<void> {
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      select: { userId: true },
    });
    if (!memory) {
      throw new NotFoundException(`Memory not found: ${memoryId}`);
    }
    if (memory.userId !== userId) {
      throw new ForbiddenException(
        'Access denied: Memory belongs to another user',
      );
    }
  }

  /**
   * Mark a memory as used
   */
  async markUsed(memoryId: string, userId?: string): Promise<void> {
    if (userId) {
      await this.verifyOwnership(memoryId, userId);
    }
    await this.prisma.memory.update({
      where: { id: memoryId },
      data: {
        usedCount: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });
  }

  /**
   * Get a single memory by ID (with ownership check)
   */
  async getById(
    memoryId: string,
    userId?: string,
  ): Promise<MemoryWithExtraction | null> {
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      include: { extraction: true },
    });
    if (!memory) return null;
    if (userId && memory.userId !== userId) {
      throw new ForbiddenException(
        'Access denied: Memory belongs to another user',
      );
    }
    return memory;
  }

  /**
   * Soft delete a memory (with ownership check)
   */
  async delete(memoryId: string, userId?: string): Promise<void> {
    if (userId) {
      await this.verifyOwnership(memoryId, userId);
    }
    await this.prisma.memory.update({
      where: { id: memoryId },
      data: { deletedAt: new Date() },
    });

    // Decrement account memoriesUsed
    if (userId) {
      this.incrementMemoriesUsed(userId, -1).catch((err) => {
        console.error(`[Memory] Failed to decrement memoriesUsed:`, err);
      });
    }

    this.emitEvent(
      'memory.deleted',
      new MemoryDeletedEvent(memoryId, userId ?? 'unknown'),
    );
  }

  /**
   * Update an existing memory
   */
  async update(
    userId: string,
    memoryId: string,
    dto: UpdateMemoryDto,
  ): Promise<MemoryWithExtraction> {
    // 1. Fetch memory and verify ownership
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      include: {
        extraction: true,
        user: { select: { id: true, externalId: true, displayName: true } },
      },
    });

    if (!memory) {
      throw new Error(`Memory not found: ${memoryId}`);
    }

    if (memory.userId !== userId) {
      throw new Error(`Access denied: Memory belongs to another user`);
    }

    if (memory.deletedAt) {
      throw new Error(`Cannot update deleted memory: ${memoryId}`);
    }

    // 2. Check if content changed
    const contentChanged = dto.raw && dto.raw !== memory.raw;

    // 3. Update memory record
    const updateData: any = {
      ...(dto.raw && { raw: dto.raw }),
      ...(dto.layer && { layer: dto.layer }),
      ...(dto.importanceHint && { importanceHint: dto.importanceHint }),
      ...(dto.importanceScore !== undefined && {
        importanceScore: dto.importanceScore,
      }),
    };

    if (dto.importanceHint && dto.importanceScore === undefined) {
      updateData.importanceScore = this.importance.calculate({
        hint: dto.importanceHint,
        layer: dto.layer ?? memory.layer,
      });
    }

    const updated = await this.prisma.memory.update({
      where: { id: memoryId },
      data: updateData,
      include: { extraction: true },
    });

    this.emitEvent(
      'memory.updated',
      new MemoryUpdatedEvent(memoryId, updateData, userId),
    );

    // 4. Update extraction fields if provided
    if (dto.extraction && memory.extraction) {
      const extractionUpdate: any = {};

      if (dto.extraction.who !== undefined)
        extractionUpdate.who = dto.extraction.who;
      if (dto.extraction.what !== undefined)
        extractionUpdate.what = dto.extraction.what;
      if (dto.extraction.where !== undefined)
        extractionUpdate.whereCtx = dto.extraction.where;
      if (dto.extraction.why !== undefined)
        extractionUpdate.why = dto.extraction.why;
      if (dto.extraction.how !== undefined)
        extractionUpdate.how = dto.extraction.how;
      if (dto.extraction.topics !== undefined)
        extractionUpdate.topics = dto.extraction.topics;

      if (dto.extraction.when !== undefined) {
        if (dto.extraction.when === null) {
          extractionUpdate.when = null;
        } else {
          extractionUpdate.when = parseFlexibleDate(
            dto.extraction.when,
            new Date(),
          );
        }
      }

      if (Object.keys(extractionUpdate).length > 0) {
        await this.prisma.memoryExtraction.update({
          where: { memoryId },
          data: extractionUpdate,
        });
      }
    }

    // 5. Re-embed if content changed
    if (contentChanged && dto.raw) {
      console.log(`[Memory] Content changed, re-embedding: ${memoryId}`);

      const embedding = await this.embedding.generate(dto.raw);
      await this.embedding.store(memoryId, embedding, {
        userId,
        layer: updated.layer,
        importance: updated.importanceScore,
      });

      await this.pipelineService.linkRelatedMemories(
        memoryId,
        embedding,
        userId,
      );

      const context: ExtractionContext = {
        userId,
        userName: (memory.user as any)?.displayName || memory.user?.externalId,
      };
      this.extraction
        .extract(dto.raw, context)
        .then(async (extracted) => {
          await this.prisma.memoryExtraction.update({
            where: { memoryId },
            data: {
              who: extracted.who,
              what: extracted.what,
              when: parseFlexibleDate(extracted.when, new Date()),
              whereCtx: extracted.where,
              why: extracted.why,
              how: extracted.how,
              topics: extracted.topics,
              extractedAt: new Date(),
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
          if (extracted.memoryType) {
            const priority = this.extraction.getPriorityForType(
              extracted.memoryType,
            );
            await this.prisma.memory.update({
              where: { id: memoryId },
              data: {
                memoryType: extracted.memoryType,
                typeConfidence: extracted.typeConfidence,
                priority,
              },
            });
          }
        })
        .catch((err) => {
          console.error(`[Memory] Re-extraction failed for ${memoryId}:`, err);
        });
    }

    return this.getById(memoryId) as Promise<MemoryWithExtraction>;
  }

  /**
   * Correct a memory with contradiction tracking
   */
  async correctMemory(
    userId: string,
    memoryId: string,
    dto: CorrectMemoryDto,
  ): Promise<MemoryWithExtraction> {
    const original = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      include: { user: { select: { id: true, externalId: true, displayName: true } } },
    });

    if (!original) {
      throw new Error(`Memory not found: ${memoryId}`);
    }

    if (original.userId !== userId) {
      throw new Error(`Access denied: Memory belongs to another user`);
    }

    if (original.deletedAt) {
      throw new Error(`Cannot correct deleted memory: ${memoryId}`);
    }

    if (original.supersededById) {
      throw new Error(
        `Memory already superseded by: ${original.supersededById}`,
      );
    }

    const correctionImportance = dto.importanceHint
      ? this.importance.calculate({
          hint: dto.importanceHint,
          layer: dto.layer ?? original.layer,
        })
      : Math.min(1.0, original.importanceScore + 0.1);

    const correction = await this.prisma.memory.create({
      data: {
        userId,
        raw: dto.correctedContent,
        layer: dto.layer ?? original.layer,
        source: MemorySource.CORRECTION,
        importanceHint:
          dto.importanceHint ?? original.importanceHint ?? undefined,
        importanceScore: correctionImportance,
        projectId: original.projectId,
        sessionId: original.sessionId,
      },
    });

    await this.prisma.memory.update({
      where: { id: memoryId },
      data: {
        supersededById: correction.id,
        supersededAt: new Date(),
      },
    });

    await this.prisma.memoryChainLink.create({
      data: {
        sourceId: correction.id,
        targetId: memoryId,
        linkType: 'CONTRADICTS',
        confidence: 1.0,
        createdBy: dto.reason ? `user:${dto.reason}` : 'user:correction',
      },
    });

    const context: ExtractionContext = {
      userId,
      userName: (original.user as any)?.displayName || original.user?.externalId,
    };
    this.pipelineService
      .extractAndEmbed(correction.id, dto.correctedContent, userId, context)
      .catch((err) => {
        console.error(
          `[Memory] Extraction failed for correction ${correction.id}:`,
          err,
        );
      });

    // Increment memoriesUsed for the correction
    this.incrementMemoriesUsed(userId, 1).catch((err) => {
      console.error(`[Memory] Failed to increment memoriesUsed for correction:`, err);
    });

    console.log(
      `[Memory] Created correction: ${correction.id} supersedes ${memoryId}`,
    );

    return correction;
  }

  /**
   * Get graph data for visualization — delegates to MemoryGraphService
   */
  async getGraphData(
    userId: string,
    limit: number = 500,
    includeAgent: boolean = false,
  ) {
    return this.graphService.getGraphData(userId, limit, includeAgent);
  }

  /**
   * Increment (or decrement) memoriesUsed on the account that owns this user.
   * Resolves accountId via user → agent → account chain.
   */
  private async incrementMemoriesUsed(
    userId: string,
    delta: number,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { agent: { select: { accountId: true } } },
    });
    const accountId = user?.agent?.accountId;
    if (!accountId) return;

    if (delta > 0) {
      await this.prisma.account.update({
        where: { id: accountId },
        data: { memoriesUsed: { increment: delta } },
      });
    } else {
      // Decrement but don't go below 0
      await this.prisma.$executeRawUnsafe(
        `UPDATE accounts SET memories_used = GREATEST(0, memories_used + $1) WHERE id = $2`,
        delta,
        accountId,
      );
    }
  }

  /**
   * Fire-and-forget event emission
   */
  private emitEvent(eventName: string, payload: any): void {
    try {
      this.eventEmitter?.emit(eventName, payload);
    } catch (err) {
      console.error(`[Memory] Failed to emit ${eventName}:`, err);
    }
  }

  // =========================================================================
  // EXPORT / IMPORT (HEY-55)
  // =========================================================================

  /**
   * Export all user memories for migration.
   * Returns an array of ExportedMemory objects.
   */
  async exportMemories(userId: string): Promise<ExportedMemory[]> {
    const memories = await this.prisma.memory.findMany({
      where: { userId, deletedAt: null },
      include: { extraction: true },
      orderBy: { createdAt: 'asc' },
    });

    // Batch-fetch ensemble embeddings
    const memoryIds = memories.map((m) => m.id);
    const ensembleRows = memoryIds.length
      ? await (this.prisma as any).ensembleEmbedding?.findMany({
          where: { memoryId: { in: memoryIds } },
          select: { memoryId: true, provider: true, vector: true },
        }).catch(() => [] as any[]) ?? []
      : [];

    const ensembleMap = new Map<string, Record<string, number[]>>();
    for (const row of ensembleRows) {
      if (!ensembleMap.has(row.memoryId)) {
        ensembleMap.set(row.memoryId, {});
      }
      ensembleMap.get(row.memoryId)![row.provider] = row.vector;
    }

    return memories.map((m) => ({
      id: m.id,
      raw: m.raw,
      layer: m.layer,
      importance: m.importanceScore,
      tags: m.extraction?.topics ?? [],
      metadata: {
        source: m.source,
        confidence: m.confidence,
        subjectType: m.subjectType,
        subjectId: m.subjectId,
        projectId: m.projectId,
        sessionId: m.sessionId,
        extraction: m.extraction
          ? {
              who: m.extraction.who,
              what: m.extraction.what,
              when: m.extraction.when,
              where: m.extraction.whereCtx,
              why: m.extraction.why,
              how: m.extraction.how,
              topics: m.extraction.topics,
            }
          : null,
      },
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
      ...(ensembleMap.has(m.id)
        ? { ensembleEmbeddings: ensembleMap.get(m.id) }
        : {}),
    }));
  }

  /**
   * Import memories with dedup and plan limit enforcement.
   */
  async importMemories(
    userId: string,
    items: ImportMemoryItemDto[],
  ): Promise<ImportResult> {
    // 1. Resolve account and check plan limits
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        externalId: true,
        displayName: true,
        agent: { select: { accountId: true, account: true } },
      },
    });

    const account = user?.agent?.account as any;
    let memoriesUsed = account?.memoriesUsed ?? 0;
    let memoryLimit = Infinity;

    if (account) {
      const { PLAN_LIMITS } = await import('../account/plan-limits.js');
      const limits = PLAN_LIMITS[account.plan as keyof typeof PLAN_LIMITS];
      if (limits && limits.memories !== -1) {
        memoryLimit = limits.memories;
      }
    }

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const item of items) {
      try {
        // Check plan limit
        if (memoriesUsed + imported >= memoryLimit) {
          errors += items.length - imported - skipped - errors;
          break;
        }

        // Dedup check
        const dedupResult = await this.dedupService.findDuplicateV2(
          userId,
          item.raw,
        );

        if (dedupResult.action !== 'create') {
          skipped++;
          continue;
        }

        // Determine layer
        const layer =
          item.layer && Object.values(MemoryLayer).includes(item.layer as MemoryLayer)
            ? (item.layer as MemoryLayer)
            : this.extraction.classifyLayer(item.raw);

        // Calculate importance
        const importanceScore = item.importance != null
          ? Math.max(0, Math.min(1, item.importance))
          : this.importance.calculate({ layer });

        // Create memory
        const memory = await this.prisma.memory.create({
          data: {
            userId,
            raw: item.raw,
            layer,
            source: MemorySource.EXPLICIT_STATEMENT,
            importanceScore,
            confidence: 1.0,
          },
        });

        // Extract and embed asynchronously (generates NEW embeddings)
        const extractionContext: ExtractionContext = {
          userId,
          userName: user?.displayName || user?.externalId,
          timestamp: item.createdAt ? new Date(item.createdAt) : new Date(),
        };

        this.pipelineService
          .extractAndEmbed(memory.id, item.raw, userId, extractionContext)
          .catch((err) => {
            console.error(`[Import] Extraction failed for ${memory.id}:`, err);
          });

        // Emit memory.created so ensemble embeddings get generated
        this.emitEvent(
          'memory.created',
          new MemoryCreatedEvent(
            memory.id,
            memory.layer,
            importanceScore,
            [],
            userId,
            item.raw.substring(0, 200),
          ),
        );

        imported++;
      } catch (err) {
        console.error('[Import] Failed to import memory:', err);
        errors++;
      }
    }

    // Increment memoriesUsed in bulk
    if (imported > 0) {
      this.incrementMemoriesUsed(userId, imported).catch((err) => {
        console.error(`[Import] Failed to increment memoriesUsed:`, err);
      });
    }

    return { imported, skipped, errors };
  }

  /**
   * Resolve sessionId
   */
  private async resolveSessionId(
    userId: string,
    sessionId?: string,
  ): Promise<string | undefined> {
    if (!sessionId) return undefined;

    const existingById = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });
    if (existingById) return existingById.id;

    const existingByExternalId = await this.prisma.session.findFirst({
      where: {
        userId,
        externalId: sessionId,
      },
      select: { id: true },
    });
    if (existingByExternalId) return existingByExternalId.id;

    const newSession = await this.prisma.session.create({
      data: {
        userId,
        externalId: sessionId,
      },
    });
    return newSession.id;
  }
}
