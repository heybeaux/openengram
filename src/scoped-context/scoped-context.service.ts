import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AgentSessionService } from '../agent-session/agent-session.service';
import { MemoryPoolService } from '../memory-pool/memory-pool.service';
import { MemoryAccessLogService, MemoryAccessType } from '../memory-access-log/memory-access-log.service';
import { EmbeddingService } from '../memory/embedding.service';
import { ScopedContextRequestDto, ScopedContextResponseDto } from './dto/scoped-context.dto';

interface ScoredMemory {
  id: string;
  raw: string;
  memoryType: string | null;
  effectiveScore: number;
  safetyCritical: boolean;
  priority: number;
  createdAt: Date;
  retrievalCount: number;
  layer: string;
  taskSimilarity: number;
  finalScore: number;
  tokens: number;
}

// In-memory cache for task embeddings (sessionKey -> embedding)
const taskEmbeddingCache = new Map<string, { embedding: number[]; taskDesc: string }>();

@Injectable()
export class ScopedContextService {
  private readonly logger = new Logger(ScopedContextService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentSessionService: AgentSessionService,
    private readonly memoryPoolService: MemoryPoolService,
    private readonly accessLogService: MemoryAccessLogService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async generateScopedContext(dto: ScopedContextRequestDto): Promise<ScopedContextResponseDto> {
    const maxTokens = dto.maxTokens ?? 2000;
    const includeGlobal = dto.includeGlobal ?? true;

    // 1. Resolve task description
    let taskDescription: string | null = dto.taskDescription ?? null;
    if (!taskDescription) {
      const session = await this.agentSessionService.findByKey(dto.agentSessionKey);
      taskDescription = session?.taskDescription ?? null;
    }

    // 2. Generate task embedding
    let taskEmbedding: number[] | null = null;
    if (taskDescription) {
      taskEmbedding = await this.getTaskEmbedding(dto.agentSessionKey, taskDescription);
    }

    // 3. Resolve accessible pools
    const poolIds = await this.resolvePoolIds(dto);

    // 4. Fetch candidate memories from accessible pools
    const candidates = await this.fetchCandidateMemories(dto.userId, poolIds, dto.excludeTypes);

    // 5. Score each memory
    const scored = await this.scoreMemories(candidates, taskEmbedding);

    // 6. Budget allocation and selection
    const { critical, taskRelevant, background } = this.selectByBudget(scored, maxTokens);

    // 7. Format as markdown
    const allSelected = [...critical, ...taskRelevant, ...background];
    const totalTokens = allSelected.reduce((sum, m) => sum + m.tokens, 0);
    const context = this.formatMarkdown(taskDescription, critical, taskRelevant, background, totalTokens);

    // 8. Log access (fire-and-forget)
    if (allSelected.length > 0) {
      this.accessLogService.logInjected(
        allSelected.map((m) => m.id),
        dto.agentSessionKey,
        taskDescription ?? 'scoped-context',
        totalTokens,
      );
    }

    return {
      context,
      tokenCount: totalTokens,
      memoriesIncluded: allSelected.length,
      taskDescription,
      sections: {
        critical: critical.length,
        taskRelevant: taskRelevant.length,
        background: background.length,
      },
    };
  }

  /**
   * Get or generate task embedding, with caching.
   */
  private async getTaskEmbedding(sessionKey: string, taskDescription: string): Promise<number[]> {
    const cached = taskEmbeddingCache.get(sessionKey);
    if (cached && cached.taskDesc === taskDescription) {
      return cached.embedding;
    }

    try {
      const embedding = await this.embeddingService.generate(taskDescription);
      taskEmbeddingCache.set(sessionKey, { embedding, taskDesc: taskDescription });
      return embedding;
    } catch (err) {
      this.logger.warn(`Failed to generate task embedding: ${err.message}`);
      return [] as number[];
    }
  }

  /**
   * Resolve which pool IDs this request should query.
   */
  private async resolvePoolIds(dto: ScopedContextRequestDto): Promise<string[]> {
    const includeGlobal = dto.includeGlobal ?? true;

    // Get pools accessible to this session
    const accessiblePools = await this.memoryPoolService.getAccessiblePoolIds(
      dto.agentSessionKey,
      dto.userId,
    );

    // If additional poolIds specified, merge (but only if accessible)
    const requestedPools = dto.poolIds ?? [];
    const accessibleSet = new Set(accessiblePools);

    const merged = new Set(accessiblePools);
    for (const pid of requestedPools) {
      if (accessibleSet.has(pid)) {
        merged.add(pid);
      }
    }

    return Array.from(merged);
  }

  /**
   * Fetch candidate memories from the given pools.
   */
  private async fetchCandidateMemories(
    userId: string,
    poolIds: string[],
    excludeTypes?: string[],
  ): Promise<any[]> {
    // If no pools resolved, fall back to all user memories (backward compat)
    if (poolIds.length === 0) {
      return this.prisma.memory.findMany({
        where: {
          userId,
          deletedAt: null,
          supersededById: null,
          userHidden: false,
          ...(excludeTypes?.length ? { memoryType: { notIn: excludeTypes as any } } : {}),
        },
        orderBy: { effectiveScore: 'desc' },
        take: 500,
      });
    }

    // Get memory IDs from pool memberships
    const memberships = await (this.prisma as any).memoryPoolMembership.findMany({
      where: { poolId: { in: poolIds } },
      select: { memoryId: true },
    });

    const memoryIds = [...new Set(memberships.map((m: any) => m.memoryId))];
    if (memoryIds.length === 0) return [];

    return this.prisma.memory.findMany({
      where: {
        id: { in: memoryIds as string[] },
        userId,
        deletedAt: null,
        supersededById: null,
        userHidden: false,
        ...(excludeTypes?.length ? { memoryType: { notIn: excludeTypes as any } } : {}),
      },
      orderBy: { effectiveScore: 'desc' },
      take: 500,
    });
  }

  /**
   * Score memories using the task-adaptive algorithm from spec Section 7.2.
   *
   * finalScore = 0.4 * taskSimilarity + 0.3 * effectiveScore + 0.2 * recency + 0.1 * accessFrequency
   */
  async scoreMemories(candidates: any[], taskEmbedding: number[] | null): Promise<ScoredMemory[]> {
    const now = Date.now();

    // If we have a task embedding, compute cosine similarity via raw SQL for each candidate
    let similarityMap = new Map<string, number>();
    if (taskEmbedding && candidates.length > 0) {
      similarityMap = await this.computeTaskSimilarities(
        candidates.map((c) => c.id),
        taskEmbedding,
      );
    }

    return candidates.map((m) => {
      const taskSimilarity = similarityMap.get(m.id) ?? 0;
      const importanceWeight = m.effectiveScore ?? 0.5;
      const daysSinceCreated = (now - new Date(m.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      const recencyWeight = Math.exp(-daysSinceCreated / 30); // 30-day half-life
      const accessWeight = Math.min(1, Math.log(1 + (m.retrievalCount ?? 0)) / 10);

      let finalScore =
        0.4 * taskSimilarity +
        0.3 * importanceWeight +
        0.2 * recencyWeight +
        0.1 * accessWeight;

      // CONSTRAINT/LESSON get 1.5x multiplier
      if (m.memoryType === 'CONSTRAINT' || m.memoryType === 'LESSON') {
        finalScore *= 1.5;
      }

      const tokens = Math.ceil((m.raw?.length ?? 0) / 4);

      return {
        id: m.id,
        raw: m.raw,
        memoryType: m.memoryType,
        effectiveScore: m.effectiveScore ?? 0.5,
        safetyCritical: m.safetyCritical ?? false,
        priority: m.priority ?? 3,
        createdAt: m.createdAt,
        retrievalCount: m.retrievalCount ?? 0,
        layer: m.layer,
        taskSimilarity,
        finalScore,
        tokens,
      };
    });
  }

  /**
   * Compute cosine similarity between task embedding and memory embeddings using pgvector.
   */
  private async computeTaskSimilarities(
    memoryIds: string[],
    taskEmbedding: number[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (memoryIds.length === 0) return map;

    try {
      // Use pgvector's cosine distance operator: 1 - (embedding <=> $vector)
      const vectorStr = `[${taskEmbedding.join(',')}]`;
      const results = await this.prisma.$queryRawUnsafe<Array<{ id: string; similarity: number }>>(
        `SELECT id, 1 - (embedding <=> $1::vector) as similarity
         FROM memories
         WHERE id = ANY($2) AND embedding IS NOT NULL`,
        vectorStr,
        memoryIds,
      );

      for (const row of results) {
        // Clamp to 0-1 range
        map.set(row.id, Math.max(0, Math.min(1, Number(row.similarity))));
      }
    } catch (err) {
      this.logger.warn(`Failed to compute task similarities: ${err.message}`);
    }

    return map;
  }

  /**
   * Select memories by budget allocation (Section 5.3):
   * - CONSTRAINTS/LESSONS: 20% reserved, always included
   * - Task-relevant: 50%
   * - Global context (identity): 20%
   * - Recent (last 24h): 10%
   */
  selectByBudget(
    scored: ScoredMemory[],
    maxTokens: number,
  ): { critical: ScoredMemory[]; taskRelevant: ScoredMemory[]; background: ScoredMemory[] } {
    const criticalBudget = Math.floor(maxTokens * 0.2);
    const taskBudget = Math.floor(maxTokens * 0.5);
    const globalBudget = Math.floor(maxTokens * 0.2);
    const recentBudget = Math.floor(maxTokens * 0.1);

    const critical: ScoredMemory[] = [];
    const taskRelevant: ScoredMemory[] = [];
    const background: ScoredMemory[] = [];
    const used = new Set<string>();

    let criticalTokens = 0;
    let taskTokens = 0;
    let backgroundTokens = 0;

    // Phase 0: Safety-critical always included (no eviction)
    for (const m of scored) {
      if (m.safetyCritical) {
        critical.push(m);
        criticalTokens += m.tokens;
        used.add(m.id);
      }
    }

    // Phase 1: CONSTRAINT/LESSON into critical bucket
    const constraintLessons = scored
      .filter((m) => !used.has(m.id) && (m.memoryType === 'CONSTRAINT' || m.memoryType === 'LESSON'))
      .sort((a, b) => b.finalScore - a.finalScore);

    for (const m of constraintLessons) {
      if (criticalTokens + m.tokens <= criticalBudget + Math.floor(maxTokens * 0.1)) {
        // Allow 10% overflow for critical
        critical.push(m);
        criticalTokens += m.tokens;
        used.add(m.id);
      }
    }

    // Phase 2: Task-relevant (sorted by finalScore)
    const taskCandidates = scored
      .filter((m) => !used.has(m.id))
      .sort((a, b) => b.finalScore - a.finalScore);

    for (const m of taskCandidates) {
      if (taskTokens + m.tokens <= taskBudget) {
        taskRelevant.push(m);
        taskTokens += m.tokens;
        used.add(m.id);
      }
    }

    // Phase 3: Background - identity memories + recent (last 24h)
    const bgBudget = globalBudget + recentBudget;
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    // Prefer identity layer and recent memories for background
    const bgCandidates = scored
      .filter((m) => !used.has(m.id))
      .sort((a, b) => {
        // Boost identity layer and recent memories
        const aBoost = (a.layer === 'IDENTITY' ? 0.3 : 0) + (new Date(a.createdAt).getTime() > oneDayAgo ? 0.2 : 0);
        const bBoost = (b.layer === 'IDENTITY' ? 0.3 : 0) + (new Date(b.createdAt).getTime() > oneDayAgo ? 0.2 : 0);
        return (b.finalScore + bBoost) - (a.finalScore + aBoost);
      });

    for (const m of bgCandidates) {
      if (backgroundTokens + m.tokens <= bgBudget) {
        background.push(m);
        backgroundTokens += m.tokens;
        used.add(m.id);
      }
    }

    return { critical, taskRelevant, background };
  }

  /**
   * Format selected memories as markdown (Section 7.3).
   */
  formatMarkdown(
    taskDescription: string | null,
    critical: ScoredMemory[],
    taskRelevant: ScoredMemory[],
    background: ScoredMemory[],
    totalTokens: number,
  ): string {
    const total = critical.length + taskRelevant.length + background.length;
    const lines: string[] = [];

    lines.push('# Task Context (via Engram)');
    if (taskDescription) {
      lines.push(`*Task: ${taskDescription}*`);
    }
    lines.push(`*${total} memories loaded, ${totalTokens} tokens*`);
    lines.push('');

    if (critical.length > 0) {
      lines.push('## Critical (always included)');
      for (const m of critical) {
        lines.push(`- ${m.raw}`);
      }
      lines.push('');
    }

    if (taskRelevant.length > 0) {
      lines.push('## Task-Relevant');
      for (const m of taskRelevant) {
        lines.push(`- ${m.raw}`);
      }
      lines.push('');
    }

    if (background.length > 0) {
      lines.push('## Background');
      for (const m of background) {
        lines.push(`- ${m.raw}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
