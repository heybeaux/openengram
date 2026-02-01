import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExtractionService } from './extraction.service';
import { EmbeddingService } from './embedding.service';
import { ImportanceService } from './importance.service';
import { CreateMemoryDto, CreateMemoryBatchDto } from './dto/create-memory.dto';
import { QueryMemoryDto, LoadContextDto } from './dto/query-memory.dto';
import { Memory, MemoryLayer, MemorySource } from '@prisma/client';

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
   * - Extracts structure (5W1H)
   * - Generates embedding
   * - Calculates importance score
   */
  async remember(
    userId: string,
    dto: CreateMemoryDto,
  ): Promise<MemoryWithExtraction> {
    // 1. Calculate initial importance score
    const importanceScore = this.importance.calculate({
      hint: dto.importanceHint,
      layer: dto.layer,
    });

    // 2. Resolve sessionId - auto-create session if needed
    const sessionId = await this.resolveSessionId(userId, dto.context?.sessionId);

    // 3. Create memory record
    const memory = await this.prisma.memory.create({
      data: {
        userId,
        raw: dto.raw,
        layer: dto.layer ?? MemoryLayer.SESSION,
        source: MemorySource.EXPLICIT_STATEMENT,
        importanceHint: dto.importanceHint,
        importanceScore,
        projectId: dto.context?.projectId,
        sessionId,
      },
    });

    // 4. Extract structure asynchronously (don't block response)
    this.extractAndEmbed(memory.id, dto.raw).catch((err) => {
      console.error(`Extraction failed for memory ${memory.id}:`, err);
    });

    return memory;
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

  private async extractAndEmbed(memoryId: string, raw: string): Promise<void> {
    // 1. Extract 5W1H structure
    const extracted = await this.extraction.extract(raw);

    // 2. Save extraction
    await this.prisma.memoryExtraction.create({
      data: {
        memoryId,
        who: extracted.who,
        what: extracted.what,
        when: extracted.when,
        whereCtx: extracted.where,
        why: extracted.why,
        how: extracted.how,
        topics: extracted.topics,
      },
    });

    // 3. Generate and store embedding
    const embedding = await this.embedding.generate(raw);
    const embeddingId = await this.embedding.store(memoryId, embedding);

    // 4. Update memory with embedding reference
    await this.prisma.memory.update({
      where: { id: memoryId },
      data: { embeddingId },
    });
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
