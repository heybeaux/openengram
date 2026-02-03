import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExtractionService, ExtractionContext, EntityWithType } from './extraction.service';
import { EmbeddingService } from './embedding.service';
import { ImportanceService } from './importance.service';
import { CreateMemoryDto, CreateMemoryBatchDto } from './dto/create-memory.dto';
import { QueryMemoryDto, LoadContextDto } from './dto/query-memory.dto';
import { Memory, MemoryLayer, MemorySource, Entity } from '@prisma/client';

// Similarity threshold for deduplication (0.90 = very similar)
const DEDUP_SIMILARITY_THRESHOLD = 0.90;
// Similarity threshold for creating RELATED links (0.65 = moderately related)
const RELATED_SIMILARITY_THRESHOLD = 0.65;

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
  score?: number; // Similarity score from vector search (0-1)
}

export interface QueryResult {
  memories: MemoryWithScore[];
  queryTokens: number;
  latencyMs: number;
}

export interface ContextResult {
  context: string;
  tokenCount: number;
  memoriesIncluded: number;
  layers: {
    identity: number;
    project: number;
    session: number;
  };
}

@Injectable()
export class MemoryService {
  constructor(
    private prisma: PrismaService,
    private extraction: ExtractionService,
    private embedding: EmbeddingService,
    private importance: ImportanceService,
  ) {}

  /**
   * Create a single memory
   * - Checks for duplicates first (semantic deduplication)
   * - Extracts structure (5W1H) with user context
   * - Generates embedding
   * - Calculates importance score
   * - Links related memories
   * - Stores extracted entities
   */
  async remember(
    userId: string,
    dto: CreateMemoryDto,
  ): Promise<MemoryWithExtraction> {
    // Support both 'raw' and 'content' field names for backward compatibility
    const rawContent = dto.raw || (dto as any).content;
    if (!rawContent) {
      throw new Error('Memory content is required (use "raw" or "content" field)');
    }

    // 1. Fetch user info for extraction context
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, externalId: true },
    });

    // 2. Check for duplicates BEFORE creating
    const duplicate = await this.findDuplicate(userId, rawContent);
    if (duplicate) {
      // Reinforce existing memory instead of creating duplicate
      await this.reinforceMemory(duplicate.id);
      return this.getById(duplicate.id) as Promise<MemoryWithExtraction>;
    }

    // 3. Calculate initial importance score
    const importanceScore = this.importance.calculate({
      hint: dto.importanceHint,
      layer: dto.layer,
    });

    // 4. Resolve sessionId - auto-create session if needed
    const sessionId = await this.resolveSessionId(userId, dto.context?.sessionId);

    // 5. Create memory record
    const memory = await this.prisma.memory.create({
      data: {
        userId,
        raw: rawContent,
        layer: dto.layer ?? MemoryLayer.SESSION,
        source: MemorySource.EXPLICIT_STATEMENT,
        importanceHint: dto.importanceHint,
        importanceScore,
        projectId: dto.context?.projectId,
        sessionId,
      },
    });

    // 6. Build extraction context
    const extractionContext: ExtractionContext = {
      userId,
      userName: user?.externalId, // Use externalId as user's name/identifier
      timestamp: dto.sourceTimestamp,
      turnIndex: dto.sourceTurnIndex,
      conversationId: dto.context?.sessionId,
    };

    // 7. Extract structure asynchronously (don't block response)
    this.extractAndEmbed(memory.id, rawContent, userId, extractionContext).catch((err) => {
      console.error(`Extraction failed for memory ${memory.id}:`, err);
    });

    return memory;
  }

  /**
   * Check if a similar memory already exists (semantic deduplication)
   */
  private async findDuplicate(
    userId: string,
    text: string,
    threshold: number = DEDUP_SIMILARITY_THRESHOLD,
  ): Promise<Memory | null> {
    try {
      // Generate embedding for comparison
      const embedding = await this.embedding.generate(text);
      
      // Search for similar memories
      const similar = await this.embedding.search(userId, embedding, 5);
      
      // Find any above threshold
      const match = similar.find(m => m.score >= threshold);
      
      if (match) {
        return this.prisma.memory.findUnique({ where: { id: match.id } });
      }
      
      return null;
    } catch (error) {
      // If embedding fails, allow creation (fail open)
      console.error('Duplicate check failed:', error);
      return null;
    }
  }

  /**
   * Reinforce an existing memory (boost importance, update timestamps)
   */
  private async reinforceMemory(memoryId: string): Promise<void> {
    await this.prisma.memory.update({
      where: { id: memoryId },
      data: {
        usedCount: { increment: 1 },
        lastUsedAt: new Date(),
        // Slight importance boost for reinforcement (max 1.0)
        importanceScore: {
          increment: 0.05,
        },
      },
    });

    // Cap importance at 1.0
    const memory = await this.prisma.memory.findUnique({ where: { id: memoryId } });
    if (memory && memory.importanceScore > 1.0) {
      await this.prisma.memory.update({
        where: { id: memoryId },
        data: { importanceScore: 1.0 },
      });
    }
  }

  /**
   * Create multiple memories in batch (for conversation import)
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
   * Semantic search for memories
   */
  async recall(userId: string, dto: QueryMemoryDto): Promise<QueryResult> {
    const startTime = Date.now();

    // 1. Generate query embedding
    const queryEmbedding = await this.embedding.generate(dto.query);

    // 2. Search vector store for similar memories (returns scored, ordered results)
    const vectorResults = await this.embedding.search(
      userId,
      queryEmbedding,
      dto.limit ?? 10,
      dto.layers,
    );

    // 3. Build score map for efficient lookup
    const scoreMap = new Map(vectorResults.map((r) => [r.id, r.score]));
    const memoryIds = vectorResults.map((r) => r.id);

    // 4. Fetch full memory records from Postgres
    const memories = await this.prisma.memory.findMany({
      where: {
        id: { in: memoryIds },
        deletedAt: null,
      },
      include: {
        extraction: true,
      },
    });

    // 5. Preserve vector search order and attach scores
    const orderedMemories: MemoryWithScore[] = memoryIds
      .map((id) => {
        const memory = memories.find((m) => m.id === id);
        if (!memory) return null;
        return {
          ...memory,
          score: scoreMap.get(id),
        } as MemoryWithScore;
      })
      .filter((m): m is MemoryWithScore => m !== null);

    // 6. Optionally include reasoning chains
    let result: MemoryWithScore[] = orderedMemories;
    if (dto.includeChains) {
      result = await this.attachChains(orderedMemories) as MemoryWithScore[];
    }

    // 7. Update retrieval counts
    await this.prisma.memory.updateMany({
      where: { id: { in: memoryIds } },
      data: {
        retrievalCount: { increment: 1 },
        lastRetrievedAt: new Date(),
      },
    });

    return {
      memories: result,
      queryTokens: dto.query.split(/\s+/).length, // Rough estimate
      latencyMs: Date.now() - startTime,
    };
  }

  /**
   * Load context for session start
   * Returns formatted string ready for system prompt injection
   */
  async loadContext(userId: string, dto: LoadContextDto): Promise<ContextResult> {
    const layers = { identity: 0, project: 0, session: 0 };
    const memories: Memory[] = [];

    // 1. Always load identity layer
    const identityMemories = await this.prisma.memory.findMany({
      where: {
        userId,
        layer: MemoryLayer.IDENTITY,
        deletedAt: null,
      },
      orderBy: { importanceScore: 'desc' },
      take: 50,
    });
    memories.push(...identityMemories);
    layers.identity = identityMemories.length;

    // 2. Load project memories if specified
    if (dto.projectId) {
      const projectMemories = await this.prisma.memory.findMany({
        where: {
          userId,
          projectId: dto.projectId,
          layer: MemoryLayer.PROJECT,
          deletedAt: null,
        },
        orderBy: { importanceScore: 'desc' },
        take: 50,
      });
      memories.push(...projectMemories);
      layers.project = projectMemories.length;
    }

    // 3. Load recent session memories
    const sessionMemories = await this.prisma.memory.findMany({
      where: {
        userId,
        layer: MemoryLayer.SESSION,
        deletedAt: null,
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // Last 7 days
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    memories.push(...sessionMemories);
    layers.session = sessionMemories.length;

    // 4. Format as context string
    const context = this.formatContext(memories, dto.maxTokens ?? 4000);

    return {
      context: context.text,
      tokenCount: context.tokens,
      memoriesIncluded: memories.length,
      layers,
    };
  }

  /**
   * Mark a memory as used (implicit feedback)
   */
  async markUsed(memoryId: string): Promise<void> {
    await this.prisma.memory.update({
      where: { id: memoryId },
      data: {
        usedCount: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });
  }

  /**
   * Get a single memory by ID
   */
  async getById(memoryId: string): Promise<MemoryWithExtraction | null> {
    return this.prisma.memory.findUnique({
      where: { id: memoryId },
      include: { extraction: true },
    });
  }

  /**
   * Soft delete a memory
   */
  async delete(memoryId: string): Promise<void> {
    await this.prisma.memory.update({
      where: { id: memoryId },
      data: { deletedAt: new Date() },
    });
  }

  // =========================================================================
  // PRIVATE HELPERS
  // =========================================================================

  /**
   * Resolve sessionId - if provided as external ID, find or create the session
   * This allows callers to pass any sessionId string without pre-creating sessions
   */
  private async resolveSessionId(
    userId: string,
    sessionId?: string,
  ): Promise<string | undefined> {
    if (!sessionId) return undefined;

    // First, check if this is already a valid session ID in our DB
    const existingById = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });
    if (existingById) return existingById.id;

    // Check if this is an external ID for this user
    const existingByExternalId = await this.prisma.session.findFirst({
      where: {
        userId,
        externalId: sessionId,
      },
      select: { id: true },
    });
    if (existingByExternalId) return existingByExternalId.id;

    // Session doesn't exist - create it with the provided sessionId as externalId
    const newSession = await this.prisma.session.create({
      data: {
        userId,
        externalId: sessionId,
      },
    });
    return newSession.id;
  }

  private async extractAndEmbed(
    memoryId: string, 
    raw: string, 
    userId: string,
    context?: ExtractionContext,
  ): Promise<void> {
    // 1. Extract 5W1H structure with user context
    const extracted = await this.extraction.extract(raw, context);

    // 2. Build source metadata for rawJson
    const sourceMetadata = context ? {
      source: {
        timestamp: context.timestamp?.toISOString(),
        turnIndex: context.turnIndex,
        conversationId: context.conversationId,
        userName: context.userName,
      },
    } : undefined;

    // 3. Save extraction with source metadata
    await this.prisma.memoryExtraction.create({
      data: {
        memoryId,
        who: extracted.who,
        what: extracted.what,
        when: extracted.when ? new Date(extracted.when) : null,
        whereCtx: extracted.where,
        why: extracted.why,
        how: extracted.how,
        topics: extracted.topics,
        rawJson: sourceMetadata,
      },
    });

    // 4. Store extracted entities
    if (extracted.entities && extracted.entities.length > 0) {
      await this.storeEntities(userId, memoryId, extracted.entities);
    }

    // 5. Generate and store embedding
    const embedding = await this.embedding.generate(raw);
    const embeddingId = await this.embedding.store(memoryId, embedding);

    // 6. Update memory with embedding reference
    await this.prisma.memory.update({
      where: { id: memoryId },
      data: { embeddingId },
    });

    // 7. Link to related memories
    await this.linkRelatedMemories(memoryId, embedding, userId);
  }

  /**
   * Store extracted entities and link them to the memory
   */
  private async storeEntities(
    userId: string,
    memoryId: string,
    entities: EntityWithType[],
  ): Promise<void> {
    for (const entity of entities) {
      try {
        // Find or create entity
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

        // Link entity to memory (upsert to handle duplicates)
        await this.prisma.memoryEntity.upsert({
          where: {
            memoryId_entityId: { memoryId, entityId },
          },
          create: { memoryId, entityId },
          update: {}, // No update needed, just ensure link exists
        });
      } catch (error) {
        console.error(`Failed to store entity ${entity.name}:`, error);
      }
    }
  }

  /**
   * Link this memory to related memories based on embedding similarity
   */
  private async linkRelatedMemories(
    memoryId: string,
    embedding: number[],
    userId: string,
  ): Promise<void> {
    try {
      // Search for similar memories
      const similar = await this.embedding.search(userId, embedding, 10);
      
      // Filter to related but not duplicates, excluding self
      const related = similar.filter(
        m => m.id !== memoryId && 
             m.score >= RELATED_SIMILARITY_THRESHOLD && 
             m.score < DEDUP_SIMILARITY_THRESHOLD
      );

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
              confidence: match.score, // Update confidence if link exists
            },
          });
        } catch (error) {
          // Ignore constraint violations (link may already exist)
          console.debug(`Link creation skipped for ${memoryId} -> ${match.id}`);
        }
      }
    } catch (error) {
      console.error('Failed to link related memories:', error);
    }
  }

  private async attachChains(
    memories: MemoryWithExtraction[],
  ): Promise<MemoryWithExtraction[]> {
    // TODO: Implement chain traversal
    // For now, return memories without chains
    return memories;
  }

  private formatContext(
    memories: Memory[],
    maxTokens: number,
  ): { text: string; tokens: number } {
    const lines: string[] = [];
    let estimatedTokens = 0;

    // Group by layer
    const identity = memories.filter((m) => m.layer === MemoryLayer.IDENTITY);
    const project = memories.filter((m) => m.layer === MemoryLayer.PROJECT);
    const session = memories.filter((m) => m.layer === MemoryLayer.SESSION);

    if (identity.length > 0) {
      lines.push('## User Identity');
      for (const m of identity) {
        const line = `- ${m.raw}`;
        const tokens = line.split(/\s+/).length;
        if (estimatedTokens + tokens > maxTokens) break;
        lines.push(line);
        estimatedTokens += tokens;
      }
      lines.push('');
    }

    if (project.length > 0) {
      lines.push('## Current Project');
      for (const m of project) {
        const line = `- ${m.raw}`;
        const tokens = line.split(/\s+/).length;
        if (estimatedTokens + tokens > maxTokens) break;
        lines.push(line);
        estimatedTokens += tokens;
      }
      lines.push('');
    }

    if (session.length > 0) {
      lines.push('## Recent Context');
      for (const m of session) {
        const line = `- ${m.raw}`;
        const tokens = line.split(/\s+/).length;
        if (estimatedTokens + tokens > maxTokens) break;
        lines.push(line);
        estimatedTokens += tokens;
      }
    }

    return {
      text: lines.join('\n'),
      tokens: estimatedTokens,
    };
  }
}
