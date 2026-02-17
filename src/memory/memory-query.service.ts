import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import { TemporalParserService } from './temporal/temporal-parser.service';
import { QueryMemoryDto, LoadContextDto } from './dto/query-memory.dto';
import { MultiQueryService } from '../multi-query/multi-query.service';
import { MemoryPoolService } from '../memory-pool/memory-pool.service';
import { MemoryAccessLogService } from '../memory-access-log/memory-access-log.service';
import {
  MultiQueryMetadataDto,
  ResultExplanationDto,
} from '../multi-query/dto/multi-query.dto';
import { Memory, MemoryLayer, SubjectType } from '@prisma/client';
import {
  MemoryWithExtraction,
  MemoryWithScore,
  QueryResult,
  ContextResult,
} from './memory.service';

@Injectable()
export class MemoryQueryService {
  constructor(
    private prisma: PrismaService,
    private embedding: EmbeddingService,
    private temporalParser: TemporalParserService,
    @Optional() private multiQueryService?: MultiQueryService,
    @Optional() private memoryPoolService?: MemoryPoolService,
    @Optional() private memoryAccessLogService?: MemoryAccessLogService,
  ) {}

  /**
   * Semantic search for memories
   */
  async recall(
    userId: string | string[],
    dto: QueryMemoryDto,
  ): Promise<QueryResult> {
    const startTime = Date.now();
    // Normalize userId for Prisma where clauses
    const userIdFilter = Array.isArray(userId) ? { in: userId } : userId;

    // v0.9: Use explicit poolIds if provided, otherwise resolve from agentSessionKey
    let poolIds: string[] | undefined = dto.poolIds;
    const singleUserId = Array.isArray(userId) ? userId[0] : userId;
    if (!poolIds && dto.agentSessionKey && this.memoryPoolService) {
      try {
        poolIds = await this.memoryPoolService.getAccessiblePoolIds(
          dto.agentSessionKey,
          singleUserId,
        );
      } catch (err) {
        console.warn(
          '[Recall] Failed to resolve pool IDs, proceeding without pool filter:',
          err,
        );
      }
    }

    const useMultiQuery = this.shouldUseMultiQuery(dto);

    if (useMultiQuery) {
      return this.recallWithMultiQuery(userId, dto, startTime, poolIds);
    }

    // 1. Parse temporal intent from query
    const now = new Date();
    const parsed = this.temporalParser.parse(dto.query, now);
    const hasTemporalIntent = parsed.temporalFilter !== null;
    const searchQuery = parsed.semanticQuery;

    if (hasTemporalIntent) {
      console.log('[Recall] Temporal intent detected:', {
        expression: parsed.temporalFilter!.expression,
        start: parsed.temporalFilter!.start.toISOString(),
        end: parsed.temporalFilter!.end.toISOString(),
        semanticQuery: searchQuery,
      });
    }

    // 2. Generate query embedding
    const queryEmbedding = await this.embedding.generate(searchQuery);

    const subjectTypeFilter = this.buildSubjectTypeFilter(dto);
    const limit = dto.limit ?? 10;

    let scoredMemories: MemoryWithScore[];

    if (hasTemporalIntent) {
      // TEMPORAL PATH
      const temporalMemories = await this.prisma.memory.findMany({
        where: {
          userId: userIdFilter,
          deletedAt: null,
          supersededById: null,
          createdAt: {
            gte: parsed.temporalFilter!.start,
            lte: parsed.temporalFilter!.end,
          },
          ...subjectTypeFilter,
        },
        include: { extraction: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });

      console.log(
        '[Recall] Temporal path: found',
        temporalMemories.length,
        'memories in range',
      );

      const vectorResults = await this.embedding.search(
        userId,
        queryEmbedding,
        200,
        dto.layers,
        undefined,
        poolIds,
      );
      const scoreMap = new Map(vectorResults.map((r) => [r.id, r.score]));

      scoredMemories = temporalMemories
        .map((memory) => {
          const semanticScore = scoreMap.get(memory.id) ?? 0.1;
          const temporalScore = this.temporalParser.calculateTemporalRelevance(
            memory.createdAt,
            parsed.temporalFilter,
          );
          const importanceScore =
            memory.effectiveScore ?? memory.importanceScore;

          const blendedScore = this.temporalParser.blendScores(
            semanticScore,
            temporalScore,
            importanceScore,
            true,
          );

          return { ...memory, score: blendedScore } as MemoryWithScore;
        })
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, limit);
    } else {
      // STANDARD PATH
      const vectorResults = await this.embedding.search(
        userId,
        queryEmbedding,
        limit,
        dto.layers,
        undefined,
        poolIds,
      );

      const scoreMap = new Map(vectorResults.map((r) => [r.id, r.score]));
      const memoryIds = vectorResults.map((r) => r.id);

      const memories = await this.prisma.memory.findMany({
        where: {
          id: { in: memoryIds },
          deletedAt: null,
          supersededById: null,
          ...subjectTypeFilter,
        },
        include: { extraction: true },
      });

      scoredMemories = memories
        .map((memory) => {
          const semanticScore = scoreMap.get(memory.id) ?? 0;
          const importanceScore =
            memory.effectiveScore ?? memory.importanceScore;
          const blendedScore = this.temporalParser.blendScores(
            semanticScore,
            0.5,
            importanceScore,
            false,
          );

          return { ...memory, score: blendedScore } as MemoryWithScore;
        })
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    }

    let result: MemoryWithScore[] = scoredMemories;
    if (dto.includeChains) {
      result = (await this.attachChains(scoredMemories)) as MemoryWithScore[];
    }

    const resultIds = result.map((m) => m.id);
    if (resultIds.length > 0) {
      await this.prisma.memory.updateMany({
        where: { id: { in: resultIds } },
        data: {
          retrievalCount: { increment: 1 },
          lastRetrievedAt: new Date(),
        },
      });

      if (dto.agentSessionKey && this.memoryAccessLogService) {
        this.memoryAccessLogService
          .logRecalled(resultIds, dto.agentSessionKey, dto.query)
          .catch(() => {});
      }
    }

    return {
      memories: result,
      queryTokens: dto.query.split(/\s+/).length,
      latencyMs: Date.now() - startTime,
    };
  }

  /**
   * Check if multi-query retrieval should be used
   */
  shouldUseMultiQuery(dto: QueryMemoryDto): boolean {
    if (!this.multiQueryService) return false;
    if (dto.multiQuery?.enabled === false) return false;
    if (dto.multiQuery?.enabled === true) return true;
    return this.multiQueryService.isEnabled();
  }

  /**
   * Perform recall using multi-query retrieval
   */
  private async recallWithMultiQuery(
    userId: string | string[],
    dto: QueryMemoryDto,
    startTime: number,
    poolIds?: string[],
  ): Promise<QueryResult> {
    const now = new Date();
    const parsed = this.temporalParser.parse(dto.query, now);
    const hasTemporalIntent = parsed.temporalFilter !== null;

    if (hasTemporalIntent) {
      console.log(
        '[Recall] Temporal intent detected, falling back to standard search',
      );
      const dtoWithoutMultiQuery = { ...dto, multiQuery: { enabled: false } };
      return this.recall(userId, dtoWithoutMultiQuery);
    }

    const multiQueryResult = await this.multiQueryService!.search(
      dto.query,
      userId,
      {
        topK: dto.limit ?? 10,
        layers: dto.layers,
        projectId: dto.projectId,
        multiQuery: dto.multiQuery,
        poolIds,
      },
    );

    const memoryIds = multiQueryResult.results.map((r) => r.memoryId);
    const subjectTypeFilter = this.buildSubjectTypeFilter(dto);

    const memories = await this.prisma.memory.findMany({
      where: {
        id: { in: memoryIds },
        deletedAt: null,
        supersededById: null,
        ...subjectTypeFilter,
      },
      include: { extraction: true },
    });

    const scoreMap = new Map(
      multiQueryResult.results.map((r) => [r.memoryId, r.score]),
    );

    const scoredMemories: MemoryWithScore[] = memories
      .map((memory) => {
        const multiQueryScore = scoreMap.get(memory.id) ?? 0;
        const importanceScore = memory.effectiveScore ?? memory.importanceScore;
        const blendedScore = multiQueryScore * 0.8 + importanceScore * 0.2;

        return { ...memory, score: blendedScore } as MemoryWithScore;
      })
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    let result: MemoryWithScore[] = scoredMemories;
    if (dto.includeChains) {
      result = (await this.attachChains(scoredMemories)) as MemoryWithScore[];
    }

    const resultIds = result.map((m) => m.id);
    if (resultIds.length > 0) {
      await this.prisma.memory.updateMany({
        where: { id: { in: resultIds } },
        data: {
          retrievalCount: { increment: 1 },
          lastRetrievedAt: new Date(),
        },
      });

      if (dto.agentSessionKey && this.memoryAccessLogService) {
        this.memoryAccessLogService
          .logRecalled(resultIds, dto.agentSessionKey, dto.query)
          .catch(() => {});
      }
    }

    const multiQueryMetadata = this.multiQueryService!.generateMetadata(
      multiQueryResult,
      dto.multiQuery,
    );

    let explanations: Record<string, ResultExplanationDto> | undefined;
    if (dto.multiQuery?.includeExplanations) {
      explanations = this.multiQueryService!.generateExplanations(
        multiQueryResult.results,
        multiQueryResult.expansion,
      );
    }

    return {
      memories: result,
      queryTokens: dto.query.split(/\s+/).length,
      latencyMs: Date.now() - startTime,
      multiQuery: multiQueryMetadata,
      explanations,
    };
  }

  /**
   * Load context for session start
   */
  async loadContext(
    userId: string,
    dto: LoadContextDto,
  ): Promise<ContextResult> {
    const layers: ContextResult['layers'] = {
      identity: 0,
      project: 0,
      session: 0,
    };
    const memories: Memory[] = [];
    const evictions: Array<{ id: string; reason: string }> = [];

    const LAYER_BUDGETS = {
      identity: dto.maxTokens ? Math.floor(dto.maxTokens * 0.44) : 800,
      project: dto.maxTokens ? Math.floor(dto.maxTokens * 0.33) : 600,
      session: dto.maxTokens ? Math.floor(dto.maxTokens * 0.22) : 400,
    };
    const CONSTRAINT_RESERVE = Math.min(
      200,
      Math.floor(LAYER_BUDGETS.identity * 0.25),
    );

    // 1. Load IDENTITY layer
    const identityCandidates = await this.prisma.memory.findMany({
      where: {
        userId,
        layer: MemoryLayer.IDENTITY,
        subjectType: SubjectType.USER,
        deletedAt: null,
        supersededById: null,
        userHidden: false,
      },
      orderBy: [
        { effectiveScore: 'desc' },
        { confidence: 'desc' },
        { priority: 'asc' },
        { userPinned: 'desc' },
        { createdAt: 'desc' },
      ],
      take: 200,
    });

    const { selected: identityMemories, evicted: identityEvicted } =
      this.selectMemoriesForBudget(
        identityCandidates,
        LAYER_BUDGETS.identity,
        CONSTRAINT_RESERVE,
      );
    memories.push(...identityMemories);
    layers.identity = identityMemories.length;
    evictions.push(
      ...identityEvicted.map((m) => ({ id: m.id, reason: 'identity_budget' })),
    );

    // 2. Load PROJECT layer
    if (dto.projectId) {
      const projectCandidates = await this.prisma.memory.findMany({
        where: {
          userId,
          projectId: dto.projectId,
          layer: MemoryLayer.PROJECT,
          deletedAt: null,
          supersededById: null,
          userHidden: false,
        },
        orderBy: [
          { effectiveScore: 'desc' },
          { confidence: 'desc' },
          { priority: 'asc' },
          { userPinned: 'desc' },
          { createdAt: 'desc' },
        ],
        take: 100,
      });

      const { selected: projectMemories, evicted: projectEvicted } =
        this.selectMemoriesForBudget(
          projectCandidates,
          LAYER_BUDGETS.project,
          0,
        );
      memories.push(...projectMemories);
      layers.project = projectMemories.length;
      evictions.push(
        ...projectEvicted.map((m) => ({ id: m.id, reason: 'project_budget' })),
      );
    }

    // 3. Load SESSION layer
    const sessionCandidates = await this.prisma.memory.findMany({
      where: {
        userId,
        layer: MemoryLayer.SESSION,
        deletedAt: null,
        supersededById: null,
        userHidden: false,
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      orderBy: [
        { effectiveScore: 'desc' },
        { confidence: 'desc' },
        { priority: 'asc' },
        { createdAt: 'desc' },
      ],
      take: 100,
    });

    const { selected: sessionMemories, evicted: sessionEvicted } =
      this.selectMemoriesForBudget(sessionCandidates, LAYER_BUDGETS.session, 0);
    memories.push(...sessionMemories);
    layers.session = sessionMemories.length;
    evictions.push(
      ...sessionEvicted.map((m) => ({ id: m.id, reason: 'session_budget' })),
    );

    // 4. Load agent self-memories
    if (dto.agentId) {
      const agentMemories = await this.prisma.memory.findMany({
        where: {
          agentId: dto.agentId,
          subjectType: SubjectType.AGENT,
          deletedAt: null,
          supersededById: null,
          userHidden: false,
        },
        orderBy: [
          { effectiveScore: 'desc' },
          { priority: 'asc' },
          { createdAt: 'desc' },
        ],
        take: 20,
      });
      memories.push(...agentMemories);
      layers.agent = agentMemories.length;
    }

    // 5. Format
    const context = this.formatContext(memories, dto.maxTokens ?? 4000);

    if (evictions.length > 0) {
      console.log('[Memory] Context evictions:', {
        userId,
        totalEvicted: evictions.length,
        byReason: evictions.reduce(
          (acc, e) => {
            acc[e.reason] = (acc[e.reason] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        ),
      });
    }

    return {
      context: context.text,
      tokenCount: context.tokens,
      memoriesIncluded: memories.length,
      layers,
    };
  }

  /**
   * Select memories that fit within a token budget
   */
  selectMemoriesForBudget(
    candidates: Memory[],
    budget: number,
    constraintReserve: number,
  ): { selected: Memory[]; evicted: Memory[] } {
    const selected: Memory[] = [];
    const evicted: Memory[] = [];
    let usedTokens = 0;

    const estimateTokens = (m: Memory) => Math.ceil(m.raw.length / 4);

    // Phase 0: Safety-critical
    const safetyCritical = candidates.filter((m) => m.safetyCritical);
    for (const memory of safetyCritical) {
      const tokens = estimateTokens(memory);
      selected.push(memory);
      usedTokens += tokens;
    }

    // Phase 1: CONSTRAINTS
    const constraints = candidates.filter(
      (m) => m.priority === 1 && !m.safetyCritical,
    );
    let constraintTokens = 0;

    for (const memory of constraints) {
      const tokens = estimateTokens(memory);
      if (
        constraintTokens + tokens <= constraintReserve ||
        constraintReserve === 0
      ) {
        selected.push(memory);
        constraintTokens += tokens;
        usedTokens += tokens;
      } else if (usedTokens + tokens <= budget) {
        selected.push(memory);
        usedTokens += tokens;
      } else {
        evicted.push(memory);
      }
    }

    // Phase 2: Fill remaining
    for (const memory of candidates) {
      if (selected.includes(memory)) continue;
      const tokens = estimateTokens(memory);
      if (usedTokens + tokens <= budget) {
        selected.push(memory);
        usedTokens += tokens;
      } else {
        evicted.push(memory);
      }
    }

    return { selected, evicted };
  }

  /**
   * Build subject type filter for queries
   */
  buildSubjectTypeFilter(dto: QueryMemoryDto): Record<string, any> {
    const filter: Record<string, any> = {};

    if (dto.subjectType) {
      filter.subjectType = dto.subjectType;
    }

    if (dto.agentId) {
      filter.agentId = dto.agentId;
    }

    if (
      dto.includeUserMemories === false &&
      dto.includeAgentMemories === false
    ) {
      filter.subjectType = 'IMPOSSIBLE' as any;
    } else if (dto.includeUserMemories === false) {
      filter.subjectType = SubjectType.AGENT;
    } else if (dto.includeAgentMemories === false) {
      filter.subjectType = SubjectType.USER;
    }

    return filter;
  }

  private async attachChains(
    memories: MemoryWithExtraction[],
    maxDepth: number = 3,
  ): Promise<MemoryWithExtraction[]> {
    const memoryIds = memories.map((m) => m.id);
    if (memoryIds.length === 0) return memories;

    const chainLinks = await this.prisma.memoryChainLink.findMany({
      where: {
        OR: [{ sourceId: { in: memoryIds } }, { targetId: { in: memoryIds } }],
      },
      include: {
        source: true,
        target: true,
      },
    });

    if (chainLinks.length === 0) return memories;

    // Build chain map per memory
    const chainMap = new Map<
      string,
      Array<{ memory: any; linkType: string; confidence: number }>
    >();

    for (const link of chainLinks) {
      for (const memoryId of memoryIds) {
        if (link.sourceId === memoryId) {
          const arr = chainMap.get(memoryId) ?? [];
          arr.push({
            memory: link.target,
            linkType: link.linkType,
            confidence: link.confidence,
          });
          chainMap.set(memoryId, arr);
        }
        if (link.targetId === memoryId) {
          const arr = chainMap.get(memoryId) ?? [];
          arr.push({
            memory: link.source,
            linkType: link.linkType,
            confidence: link.confidence,
          });
          chainMap.set(memoryId, arr);
        }
      }
    }

    return memories.map((m) => ({
      ...m,
      chainedMemories: chainMap.get(m.id) ?? [],
    }));
  }

  formatContext(
    memories: Memory[],
    maxTokens: number,
  ): { text: string; tokens: number } {
    const lines: string[] = [];
    let estimatedTokens = 0;

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
