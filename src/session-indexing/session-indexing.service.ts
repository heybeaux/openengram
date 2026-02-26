import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryService } from '../memory/memory.service';
import { EmbeddingService as GlobalEmbeddingService } from '../embedding/embedding.service';
import { IndexSessionDto, FlushMemoriesDto } from './dto/session-indexing.dto';
import { MemoryLayer, ImportanceHint, MemorySource } from '@prisma/client';

/**
 * Chunk a transcript into overlapping segments at sentence boundaries.
 */
function chunkTranscript(
  transcript: string,
  chunkSize: number = 1500,
  overlap: number = 200,
): string[] {
  const chunks: string[] = [];
  const sentences = transcript.split(/(?<=[.!?\n])\s+/);
  let current = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length > chunkSize && current.length > 0) {
      chunks.push(current.trim());
      // Keep overlap from end of current chunk
      const overlapText = current.slice(-overlap);
      current = overlapText + ' ' + sentence;
    } else {
      current += (current ? ' ' : '') + sentence;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

@Injectable()
export class SessionIndexingService {
  private readonly logger = new Logger(SessionIndexingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memoryService: MemoryService,
    private readonly embeddingService: GlobalEmbeddingService,
  ) {}

  /**
   * HEY-326: Index a conversation transcript into searchable memory chunks.
   *
   * Splits the transcript into meaningful chunks, embeds each, and stores
   * as memories with SESSION layer linked to the session ID.
   */
  async indexSession(
    userId: string,
    dto: IndexSessionDto,
  ): Promise<{
    sessionId: string;
    chunksCreated: number;
    memoryIds: string[];
  }> {
    const { sessionId, transcript, agentId } = dto;
    const chunkSize = dto.chunkSize ?? 1500;
    const chunkOverlap = dto.chunkOverlap ?? 200;

    this.logger.log(
      `[SessionIndexing] Indexing session ${sessionId} (${transcript.length} chars)`,
    );

    const chunks = chunkTranscript(transcript, chunkSize, chunkOverlap);
    this.logger.log(`[SessionIndexing] Split into ${chunks.length} chunks`);

    const memoryIds: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        const result = await this.memoryService.remember(userId, {
          raw: chunk,
          layer: MemoryLayer.SESSION,
          source: MemorySource.AGENT_OBSERVATION,
          context: { sessionId },
          agentId,
          importanceHint: ImportanceHint.MEDIUM,
        });
        memoryIds.push(result.id);
      } catch (err) {
        this.logger.warn(
          `[SessionIndexing] Failed to store chunk ${i + 1}/${chunks.length}: ${err.message}`,
        );
      }
    }

    this.logger.log(
      `[SessionIndexing] Indexed ${memoryIds.length}/${chunks.length} chunks for session ${sessionId}`,
    );

    return {
      sessionId,
      chunksCreated: memoryIds.length,
      memoryIds,
    };
  }

  /**
   * HEY-326: Retrieve all memories linked to a session.
   */
  async getSessionMemories(
    userId: string,
    sessionId: string,
    limit: number = 100,
    offset: number = 0,
  ): Promise<{
    sessionId: string;
    memories: any[];
    total: number;
  }> {
    // Resolve the internal session record
    const session = await this.prisma.session.findFirst({
      where: {
        OR: [{ id: sessionId }, { externalId: sessionId }],
      },
    });

    const effectiveSessionId = session?.id;

    if (!effectiveSessionId) {
      return { sessionId, memories: [], total: 0 };
    }

    const where = {
      userId,
      sessionId: effectiveSessionId,
      deletedAt: null,
    };

    const [memories, total] = await Promise.all([
      this.prisma.memory.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: limit,
        skip: offset,
        include: { extraction: true },
      }),
      this.prisma.memory.count({ where }),
    ]);

    return { sessionId, memories, total };
  }

  /**
   * HEY-327: Pre-compaction memory flush.
   *
   * Stores a batch of memories urgently before context compaction.
   * Memories are tagged with COMPACTION source and high importance
   * to ensure they survive consolidation cycles.
   */
  async flushMemories(
    userId: string,
    dto: FlushMemoriesDto,
  ): Promise<{
    flushed: number;
    failed: number;
    memoryIds: string[];
    reason: string;
  }> {
    const reason = dto.reason ?? 'pre_compaction';
    this.logger.log(
      `[Flush] Flushing ${dto.memories.length} memories (reason: ${reason})`,
    );

    const memoryIds: string[] = [];
    let failed = 0;

    for (const item of dto.memories) {
      try {
        const layer = this.resolveLayer(item.layer);
        const importanceHint = this.resolveImportance(item.importance);

        const result = await this.memoryService.remember(userId, {
          raw: `[pre-compaction] ${item.content}`,
          layer,
          importanceHint,
          source: MemorySource.AGENT_OBSERVATION,
          context: {
            sessionId: item.sessionId ?? dto.sessionId,
          },
          agentId: item.agentId ?? dto.agentId,
        });
        memoryIds.push(result.id);
      } catch (err) {
        this.logger.warn(`[Flush] Failed to flush memory: ${err.message}`);
        failed++;
      }
    }

    this.logger.log(
      `[Flush] Flushed ${memoryIds.length}/${dto.memories.length} memories`,
    );

    return {
      flushed: memoryIds.length,
      failed,
      memoryIds,
      reason,
    };
  }

  private resolveLayer(layer?: string): MemoryLayer {
    if (!layer) return MemoryLayer.SESSION;
    const upper = layer.toUpperCase();
    if (Object.values(MemoryLayer).includes(upper as MemoryLayer)) {
      return upper as MemoryLayer;
    }
    return MemoryLayer.SESSION;
  }

  private resolveImportance(hint?: string): ImportanceHint {
    if (!hint) return ImportanceHint.HIGH;
    const upper = hint.toUpperCase();
    if (Object.values(ImportanceHint).includes(upper as ImportanceHint)) {
      return upper as ImportanceHint;
    }
    return ImportanceHint.HIGH;
  }
}
