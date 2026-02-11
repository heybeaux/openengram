import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import {
  ContextualRecallDto,
  ContextualRecallResponseDto,
} from './dto/contextual-recall.dto';
import { MemoryPoolService } from '../memory-pool/memory-pool.service';
import { MemoryAccessLogService } from '../memory-access-log/memory-access-log.service';

interface SessionState {
  recentEmbeddings: number[][]; // last N message embeddings
  recalledIds: Set<string>;
  lastRecallAt: number;
  recallCount: number;
}

@Injectable()
export class ContextualRecallService {
  private sessions = new Map<string, SessionState>();

  // Cosine distance threshold for topic shift detection
  private readonly TOPIC_SHIFT_THRESHOLD = 0.4;
  // Max recent embeddings to keep per session
  private readonly MAX_RECENT_EMBEDDINGS = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
    @Optional() private readonly memoryPoolService?: MemoryPoolService,
    @Optional()
    private readonly memoryAccessLogService?: MemoryAccessLogService,
  ) {}

  async recall(
    userId: string,
    dto: ContextualRecallDto,
  ): Promise<ContextualRecallResponseDto> {
    const startTime = Date.now();
    const session = this.getOrCreateSession(dto.sessionKey);

    // 1. Generate embedding for the incoming text
    const queryEmbedding = await this.embedding.generate(dto.text);

    // 2. Detect topic shift
    const topicShift = this.detectTopicShift(queryEmbedding, session);

    // Store this embedding for future comparisons
    session.recentEmbeddings.push(queryEmbedding);
    if (session.recentEmbeddings.length > this.MAX_RECENT_EMBEDDINGS) {
      session.recentEmbeddings.shift();
    }

    // 3. If no topic shift, return empty (no recall needed)
    if (!topicShift) {
      return {
        memories: [],
        topicShift: false,
        tokenCount: 0,
        latencyMs: Date.now() - startTime,
      };
    }

    // v0.7: Resolve accessible pool IDs
    let poolIds: string[] | undefined;
    if (dto.agentSessionKey && this.memoryPoolService) {
      try {
        poolIds = await this.memoryPoolService.getAccessiblePoolIds(
          dto.agentSessionKey,
          userId,
        );
      } catch (err) {
        console.warn('[ContextualRecall] Failed to resolve pool IDs:', err);
      }
    }

    // 4. Semantic search
    const limit = dto.maxResults ?? 5;
    const minScore = dto.minScore ?? 0.65;
    const excludeSet = new Set([
      ...(dto.excludeIds ?? []),
      ...session.recalledIds,
    ]);

    const vectorResults = await this.embedding.search(
      userId,
      queryEmbedding,
      limit + excludeSet.size, // over-fetch to account for filtering
      undefined,
      undefined,
      poolIds,
    );

    // 5. Filter: exclude already-known IDs, apply score threshold
    console.log(
      `[ContextualRecall] vectorResults: ${vectorResults.length}, scores: [${vectorResults
        .slice(0, 5)
        .map((r) => r.score.toFixed(3))
        .join(', ')}], minScore: ${minScore}`,
    );
    const filteredIds = vectorResults
      .filter((r) => r.score >= minScore && !excludeSet.has(r.id))
      .slice(0, limit)
      .map((r) => ({ id: r.id, score: r.score }));

    if (filteredIds.length === 0) {
      return {
        memories: [],
        topicShift: true,
        tokenCount: 0,
        latencyMs: Date.now() - startTime,
      };
    }

    // 6. Fetch full memory records
    const scoreMap = new Map(filteredIds.map((r) => [r.id, r.score]));
    const memories = await this.prisma.memory.findMany({
      where: {
        id: { in: filteredIds.map((r) => r.id) },
        deletedAt: null,
        supersededById: null,
      },
      include: {
        extraction: true,
      },
    });

    // 7. Build response, respecting token budget
    const maxTokens = dto.maxTokens ?? 500;
    let tokenCount = 0;
    const result: ContextualRecallResponseDto['memories'] = [];

    // Sort by score descending
    const sorted = memories.sort(
      (a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0),
    );

    for (const memory of sorted) {
      const rawText = memory.raw;
      const approxTokens = Math.ceil(rawText.length / 4); // rough estimate
      if (tokenCount + approxTokens > maxTokens && result.length > 0) break;

      result.push({
        id: memory.id,
        raw: rawText,
        layer: memory.layer,
        score: scoreMap.get(memory.id) ?? 0,
        topics: memory.extraction?.topics ?? [],
      });
      tokenCount += approxTokens;
      session.recalledIds.add(memory.id);
    }

    // Update session state
    session.lastRecallAt = Date.now();
    session.recallCount++;

    // Update retrieval counts
    const resultIds = result.map((m) => m.id);
    if (resultIds.length > 0) {
      await this.prisma.memory.updateMany({
        where: { id: { in: resultIds } },
        data: {
          retrievalCount: { increment: 1 },
          lastRetrievedAt: new Date(),
        },
      });

      // v0.7: Log recalled memories (fire-and-forget)
      if (dto.agentSessionKey && this.memoryAccessLogService) {
        this.memoryAccessLogService
          .logRecalled(resultIds, dto.agentSessionKey, dto.text)
          .catch(() => {});
      }
    }

    return {
      memories: result,
      topicShift: true,
      tokenCount,
      latencyMs: Date.now() - startTime,
    };
  }

  /**
   * Detect topic shift by comparing current embedding against recent embeddings.
   * Returns true if cosine distance > threshold (meaning topics diverged).
   */
  private detectTopicShift(
    currentEmbedding: number[],
    session: SessionState,
  ): boolean {
    if (session.recentEmbeddings.length === 0) {
      // First message in session — treat as topic shift to seed context
      return true;
    }

    // Compare against the most recent embedding
    const lastEmbedding =
      session.recentEmbeddings[session.recentEmbeddings.length - 1];
    const similarity = this.cosineSimilarity(currentEmbedding, lastEmbedding);
    const distance = 1 - similarity;

    return distance > this.TOPIC_SHIFT_THRESHOLD;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  private getOrCreateSession(sessionKey: string): SessionState {
    let session = this.sessions.get(sessionKey);
    if (!session) {
      session = {
        recentEmbeddings: [],
        recalledIds: new Set(),
        lastRecallAt: 0,
        recallCount: 0,
      };
      this.sessions.set(sessionKey, session);
    }
    return session;
  }

  /**
   * Clean up session state (call on session end)
   */
  clearSession(sessionKey: string): void {
    this.sessions.delete(sessionKey);
  }
}
