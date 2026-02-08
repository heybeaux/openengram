import { Injectable, Inject, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExtractionService, ExtractionContext, EntityWithType } from './extraction.service';
import { EmbeddingService } from './embedding.service';
import { ImportanceService } from './importance.service';
import { TemporalParserService } from './temporal/temporal-parser.service';
import { CreateMemoryDto, CreateMemoryBatchDto } from './dto/create-memory.dto';
import { QueryMemoryDto, LoadContextDto } from './dto/query-memory.dto';
import { UpdateMemoryDto, CorrectMemoryDto } from './dto/update-memory.dto';
import { Memory, MemoryLayer, MemorySource, Entity, SubjectType } from '@prisma/client';
import { parseFlexibleDate } from '../utils/date-parser';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { MultiQueryService } from '../multi-query/multi-query.service';
import { MultiQueryMetadataDto, ResultExplanationDto } from '../multi-query/dto/multi-query.dto';

// Three-tier dedup thresholds (v2)
const DEDUP_AUTO_MERGE_THRESHOLD = 0.93;   // Auto-merge: combine content, boost confidence
const DEDUP_REINFORCE_THRESHOLD = 0.85;     // Reinforce: increment counts, update timestamps
const DEDUP_REVIEW_THRESHOLD = 0.78;        // Flag for review: add to MergeCandidate
// Legacy constant kept for related links
const DEDUP_SIMILARITY_THRESHOLD = DEDUP_AUTO_MERGE_THRESHOLD;
// Similarity threshold for creating RELATED links (0.65 = moderately related)
const RELATED_SIMILARITY_THRESHOLD = 0.65;

// Source-based confidence mapping
const SOURCE_CONFIDENCE: Record<string, number> = {
  EXPLICIT_STATEMENT: 1.0,
  CORRECTION: 1.0,
  AGENT_OBSERVATION: 0.7,
  AGENT_REFLECTION: 0.65,
  PATTERN_DETECTED: 0.65,
  SYSTEM: 0.8,
};

// Dedup action result
interface DedupResult {
  action: 'create' | 'reinforced' | 'merged' | 'queued_review';
  existingMemory?: Memory;
  similarityScore?: number;
}

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
  // Multi-query metadata (when enabled)
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
    @Optional() private hierarchyService?: HierarchyService,
    @Optional() private multiQueryService?: MultiQueryService,
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

    // 2. Determine source type
    const source = dto.source ?? MemorySource.EXPLICIT_STATEMENT;

    // 3. Check for duplicates BEFORE creating (three-tier dedup v2)
    const dedupResult = await this.findDuplicateV2(userId, rawContent);
    if (dedupResult.action !== 'create' && dedupResult.existingMemory) {
      if (dedupResult.action === 'merged') {
        // Auto-merge: combine content, boost confidence
        await this.autoMergeMemory(dedupResult.existingMemory.id, rawContent, source);
      } else if (dedupResult.action === 'reinforced') {
        // Reinforce existing memory
        await this.reinforceMemory(dedupResult.existingMemory.id, dto.context?.sessionId);
      }
      // For 'queued_review', the MergeCandidate was already created in findDuplicateV2
      return this.getById(dedupResult.existingMemory.id) as Promise<MemoryWithExtraction>;
    }

    // 4. Calculate initial importance score
    const importanceScore = this.importance.calculate({
      hint: dto.importanceHint,
      layer: dto.layer,
    });

    // 5. Set confidence based on source type
    const confidence = SOURCE_CONFIDENCE[source] ?? 1.0;

    // 6. Resolve sessionId - auto-create session if needed
    const sessionId = await this.resolveSessionId(userId, dto.context?.sessionId);

    // 7a. Determine layer - use smart classification if not explicitly specified
    // P5-003: Intelligent Layer Classification
    let layer = dto.layer;
    if (!layer) {
      // Run quick extraction to help with classification
      // Note: Full extraction happens async, this is just for layer classification
      layer = this.extraction.classifyLayer(rawContent);
      console.log('[Memory] Smart layer classification:', { rawPreview: rawContent.substring(0, 50), layer });
    }

    // 7b. Determine subject fields
    // Default: memory is about the user (USER subject type)
    const subjectType = dto.subjectType ?? SubjectType.USER;
    const subjectId = dto.subjectId ?? (subjectType === SubjectType.USER ? userId : dto.agentId);

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
        // Subject fields for agent self-memories
        subjectType,
        subjectId,
        agentId: dto.agentId,
      },
    });

    // 8. Build extraction context
    const extractionContext: ExtractionContext = {
      userId,
      userName: user?.externalId, // Use externalId as user's name/identifier
      timestamp: dto.sourceTimestamp,
      turnIndex: dto.sourceTurnIndex,
      conversationId: dto.context?.sessionId,
    };

    // 9. Extract structure asynchronously (don't block response)
    this.extractAndEmbed(memory.id, rawContent, userId, extractionContext).catch((err) => {
      console.error(`Extraction failed for memory ${memory.id}:`, err);
    });

    return memory;
  }

  /**
   * Check if a similar memory already exists (semantic deduplication)
   * Legacy method kept for linkRelatedMemories compatibility
   */
  private async findDuplicate(
    userId: string,
    text: string,
    threshold: number = DEDUP_SIMILARITY_THRESHOLD,
  ): Promise<Memory | null> {
    const result = await this.findDuplicateV2(userId, text);
    return result.existingMemory ?? null;
  }

  /**
   * Three-tier semantic deduplication (v2)
   * - ≥0.93: auto-merge (combine content, boost confidence)
   * - ≥0.85: reinforce (increment accessCount, update lastAccessedAt)
   * - ≥0.78: flag for review (add to MergeCandidate table)
   */
  private async findDuplicateV2(
    userId: string,
    text: string,
  ): Promise<DedupResult> {
    try {
      const embedding = await this.embedding.generate(text);
      const similar = await this.embedding.search(userId, embedding, 5);

      // Find best match
      const bestMatch = similar.length > 0 ? similar[0] : null;
      if (!bestMatch) return { action: 'create' };

      const existingMemory = await this.prisma.memory.findUnique({
        where: { id: bestMatch.id },
      });
      if (!existingMemory || existingMemory.deletedAt) return { action: 'create' };

      if (bestMatch.score >= DEDUP_AUTO_MERGE_THRESHOLD) {
        console.log(`[Dedup] Auto-merge: score=${bestMatch.score.toFixed(3)} memory=${bestMatch.id}`);
        return { action: 'merged', existingMemory, similarityScore: bestMatch.score };
      }

      if (bestMatch.score >= DEDUP_REINFORCE_THRESHOLD) {
        console.log(`[Dedup] Reinforce: score=${bestMatch.score.toFixed(3)} memory=${bestMatch.id}`);
        return { action: 'reinforced', existingMemory, similarityScore: bestMatch.score };
      }

      if (bestMatch.score >= DEDUP_REVIEW_THRESHOLD) {
        console.log(`[Dedup] Queue for review: score=${bestMatch.score.toFixed(3)} memory=${bestMatch.id}`);
        // Create MergeCandidate for review
        try {
          await this.prisma.mergeCandidate.create({
            data: {
              userId,
              memoryIds: [existingMemory.id],
              similarity: bestMatch.score,
              suggestedStrategy: 'SEMANTIC_SIMILAR',
              suggestedSurvivorId: existingMemory.id,
              status: 'PENDING',
            },
          });
        } catch (err) {
          console.error('[Dedup] Failed to create MergeCandidate:', err);
        }
        // Still allow creation — just flagged for review
        return { action: 'create' };
      }

      return { action: 'create' };
    } catch (error) {
      console.error('Duplicate check failed:', error);
      return { action: 'create' };
    }
  }

  /**
   * Auto-merge: combine content from new memory into existing, boost confidence
   */
  private async autoMergeMemory(
    existingId: string,
    newContent: string,
    newSource: MemorySource,
  ): Promise<void> {
    const existing = await this.prisma.memory.findUnique({ where: { id: existingId } });
    if (!existing) return;

    // Boost confidence: take the max of existing and new source confidence
    const newConfidence = SOURCE_CONFIDENCE[newSource] ?? 1.0;
    const boostedConfidence = Math.min(1.0, Math.max(existing.confidence, newConfidence) + 0.05);

    await this.prisma.memory.update({
      where: { id: existingId },
      data: {
        confidence: boostedConfidence,
        usedCount: { increment: 1 },
        lastUsedAt: new Date(),
        importanceScore: Math.min(1.0, existing.importanceScore + 0.05),
      },
    });
  }

  /**
   * Reinforce an existing memory (boost importance, track sessions)
   */
  private async reinforceMemory(memoryId: string, sessionId?: string): Promise<void> {
    const updateData: any = {
      usedCount: { increment: 1 },
      lastUsedAt: new Date(),
      importanceScore: { increment: 0.05 },
    };

    await this.prisma.memory.update({
      where: { id: memoryId },
      data: updateData,
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

    // Check if multi-query is enabled and should be used
    const useMultiQuery = this.shouldUseMultiQuery(dto);
    
    if (useMultiQuery) {
      return this.recallWithMultiQuery(userId, dto, startTime);
    }

    // 1. Parse temporal intent from query (P6-006)
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

    // 2. Generate query embedding (using semantic query with temporal parts stripped)
    const queryEmbedding = await this.embedding.generate(searchQuery);

    // Build subject type filter
    const subjectTypeFilter = this.buildSubjectTypeFilter(dto);
    const limit = dto.limit ?? 10;

    let scoredMemories: MemoryWithScore[];

    if (hasTemporalIntent) {
      // =====================================================================
      // TEMPORAL PATH: Time range is the PRIMARY filter.
      // Fetch ALL memories in the time range, then rank by semantic similarity.
      // This avoids the problem where vector search returns mostly older
      // memories that get filtered out by the temporal constraint.
      // =====================================================================

      // 3a. Fetch all memories in the temporal range
      const temporalMemories = await this.prisma.memory.findMany({
        where: {
          userId,
          deletedAt: null,
          createdAt: {
            gte: parsed.temporalFilter!.start,
            lte: parsed.temporalFilter!.end,
          },
          ...subjectTypeFilter,
        },
        include: {
          extraction: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 200, // Cap to avoid loading thousands
      });

      console.log('[Recall] Temporal path: found', temporalMemories.length, 'memories in range');

      // 3b. Also get vector similarity scores for the semantic query
      // (search broadly to get scores for as many memories as possible)
      const vectorResults = await this.embedding.search(
        userId,
        queryEmbedding,
        200, // Large search to overlap with temporal results
        dto.layers,
      );
      const scoreMap = new Map(vectorResults.map((r) => [r.id, r.score]));

      // 3c. Score temporal memories by blending semantic + temporal + importance
      scoredMemories = temporalMemories
        .map((memory) => {
          const semanticScore = scoreMap.get(memory.id) ?? 0.1; // Low default if not in vector results
          const temporalScore = this.temporalParser.calculateTemporalRelevance(
            memory.createdAt,
            parsed.temporalFilter,
          );
          const importanceScore = memory.effectiveScore ?? memory.importanceScore;

          const blendedScore = this.temporalParser.blendScores(
            semanticScore,
            temporalScore,
            importanceScore,
            true,
          );

          return {
            ...memory,
            score: blendedScore,
          } as MemoryWithScore;
        })
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, limit);

    } else {
      // =====================================================================
      // STANDARD PATH: Vector similarity is the PRIMARY filter.
      // No temporal intent — use the normal vector search pipeline.
      // =====================================================================

      // 3. Search vector store for similar memories
      const vectorResults = await this.embedding.search(
        userId,
        queryEmbedding,
        limit,
        dto.layers,
      );

      const scoreMap = new Map(vectorResults.map((r) => [r.id, r.score]));
      const memoryIds = vectorResults.map((r) => r.id);

      // 4. Fetch full memory records from Postgres
      const memories = await this.prisma.memory.findMany({
        where: {
          id: { in: memoryIds },
          deletedAt: null,
          ...subjectTypeFilter,
        },
        include: {
          extraction: true,
        },
      });

      // 5. Score and rank (standard: semantic + importance only)
      scoredMemories = memories
        .map((memory) => {
          const semanticScore = scoreMap.get(memory.id) ?? 0;
          const importanceScore = memory.effectiveScore ?? memory.importanceScore;
          const blendedScore = this.temporalParser.blendScores(
            semanticScore,
            0.5, // Neutral temporal
            importanceScore,
            false,
          );

          return {
            ...memory,
            score: blendedScore,
          } as MemoryWithScore;
        })
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    }

    // 6. Optionally include reasoning chains
    let result: MemoryWithScore[] = scoredMemories;
    if (dto.includeChains) {
      result = await this.attachChains(scoredMemories) as MemoryWithScore[];
    }

    // 9. Update retrieval counts
    const resultIds = result.map(m => m.id);
    if (resultIds.length > 0) {
      await this.prisma.memory.updateMany({
        where: { id: { in: resultIds } },
        data: {
          retrievalCount: { increment: 1 },
          lastRetrievedAt: new Date(),
        },
      });
    }

    return {
      memories: result,
      queryTokens: dto.query.split(/\s+/).length, // Rough estimate
      latencyMs: Date.now() - startTime,
    };
  }

  /**
   * Check if multi-query retrieval should be used for this request
   */
  private shouldUseMultiQuery(dto: QueryMemoryDto): boolean {
    // Check if multi-query service is available
    if (!this.multiQueryService) {
      return false;
    }

    // Check if explicitly disabled in request
    if (dto.multiQuery?.enabled === false) {
      return false;
    }

    // Check if explicitly enabled in request
    if (dto.multiQuery?.enabled === true) {
      return true;
    }

    // Check global setting
    return this.multiQueryService.isEnabled();
  }

  /**
   * Perform recall using multi-query retrieval
   */
  private async recallWithMultiQuery(
    userId: string,
    dto: QueryMemoryDto,
    startTime: number,
  ): Promise<QueryResult> {
    // 1. Parse temporal intent - multi-query doesn't work well with temporal queries
    // because it's designed for semantic expansion, not temporal constraints
    const now = new Date();
    const parsed = this.temporalParser.parse(dto.query, now);
    const hasTemporalIntent = parsed.temporalFilter !== null;

    if (hasTemporalIntent) {
      // For temporal queries, fall back to standard recall
      console.log('[Recall] Temporal intent detected, falling back to standard search');
      // Reset multi-query option and recursively call recall
      const dtoWithoutMultiQuery = { ...dto, multiQuery: { enabled: false } };
      return this.recall(userId, dtoWithoutMultiQuery);
    }

    // 2. Perform multi-query search
    const multiQueryResult = await this.multiQueryService!.search(
      dto.query,
      userId,
      {
        topK: dto.limit ?? 10,
        layers: dto.layers,
        projectId: dto.projectId,
        multiQuery: dto.multiQuery,
      },
    );

    // 3. Fetch full memory records for the fused results
    const memoryIds = multiQueryResult.results.map(r => r.memoryId);
    const subjectTypeFilter = this.buildSubjectTypeFilter(dto);

    const memories = await this.prisma.memory.findMany({
      where: {
        id: { in: memoryIds },
        deletedAt: null,
        ...subjectTypeFilter,
      },
      include: {
        extraction: true,
      },
    });

    // 4. Create score map from multi-query results
    const scoreMap = new Map(
      multiQueryResult.results.map(r => [r.memoryId, r.score])
    );

    // 5. Score and rank memories using multi-query scores
    const scoredMemories: MemoryWithScore[] = memories
      .map((memory) => {
        const multiQueryScore = scoreMap.get(memory.id) ?? 0;
        const importanceScore = memory.effectiveScore ?? memory.importanceScore;
        
        // Blend multi-query score with importance (weighted towards multi-query)
        const blendedScore = multiQueryScore * 0.8 + importanceScore * 0.2;

        return {
          ...memory,
          score: blendedScore,
        } as MemoryWithScore;
      })
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    // 6. Optionally include reasoning chains
    let result: MemoryWithScore[] = scoredMemories;
    if (dto.includeChains) {
      result = await this.attachChains(scoredMemories) as MemoryWithScore[];
    }

    // 7. Update retrieval counts
    const resultIds = result.map(m => m.id);
    if (resultIds.length > 0) {
      await this.prisma.memory.updateMany({
        where: { id: { in: resultIds } },
        data: {
          retrievalCount: { increment: 1 },
          lastRetrievedAt: new Date(),
        },
      });
    }

    // 8. Generate metadata and explanations
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
   * Returns formatted string ready for system prompt injection
   * 
   * Memory Intelligence v2: Priority-based retrieval
   * - Layer determines WHERE: IDENTITY (800 tokens), PROJECT (600), SESSION (400)
   * - Type determines PRIORITY: CONSTRAINT (1) > PREFERENCE/TASK (2) > FACT (3) > EVENT (4)
   * - CONSTRAINTS have a protected reserve (200 tokens in IDENTITY)
   */
  async loadContext(userId: string, dto: LoadContextDto): Promise<ContextResult> {
    const layers: ContextResult['layers'] = { identity: 0, project: 0, session: 0 };
    const memories: Memory[] = [];
    const evictions: Array<{ id: string; reason: string }> = [];

    // Layer budgets (in tokens, roughly 4 chars/token)
    const LAYER_BUDGETS = {
      identity: dto.maxTokens ? Math.floor(dto.maxTokens * 0.44) : 800, // ~44%
      project: dto.maxTokens ? Math.floor(dto.maxTokens * 0.33) : 600,  // ~33%
      session: dto.maxTokens ? Math.floor(dto.maxTokens * 0.22) : 400,  // ~22%
    };
    const CONSTRAINT_RESERVE = Math.min(200, Math.floor(LAYER_BUDGETS.identity * 0.25));

    // 1. Load IDENTITY layer with effectiveScore-based selection
    const identityCandidates = await this.prisma.memory.findMany({
      where: {
        userId,
        layer: MemoryLayer.IDENTITY,
        subjectType: SubjectType.USER,
        deletedAt: null,
        userHidden: false, // Memory Intelligence: respect user hiding
      },
      orderBy: [
        { effectiveScore: 'desc' }, // Memory Intelligence v2: unified score (includes safety floor, decay, boosts)
        { confidence: 'desc' },     // Quality v2: prefer higher-confidence memories
        { priority: 'asc' },        // Tie-breaker: lower = higher priority (1=CONSTRAINT first)
        { userPinned: 'desc' },     // Then pinned items
        { createdAt: 'desc' },      // Finally recency
      ],
      take: 200, // Get enough candidates to select from
    });
    
    const { selected: identityMemories, evicted: identityEvicted } = this.selectMemoriesForBudget(
      identityCandidates,
      LAYER_BUDGETS.identity,
      CONSTRAINT_RESERVE,
    );
    memories.push(...identityMemories);
    layers.identity = identityMemories.length;
    evictions.push(...identityEvicted.map(m => ({ id: m.id, reason: 'identity_budget' })));

    // 2. Load PROJECT layer if specified
    if (dto.projectId) {
      const projectCandidates = await this.prisma.memory.findMany({
        where: {
          userId,
          projectId: dto.projectId,
          layer: MemoryLayer.PROJECT,
          deletedAt: null,
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
      
      const { selected: projectMemories, evicted: projectEvicted } = this.selectMemoriesForBudget(
        projectCandidates,
        LAYER_BUDGETS.project,
        0, // No CONSTRAINT reserve for PROJECT layer
      );
      memories.push(...projectMemories);
      layers.project = projectMemories.length;
      evictions.push(...projectEvicted.map(m => ({ id: m.id, reason: 'project_budget' })));
    }

    // 3. Load SESSION layer (recent memories)
    const sessionCandidates = await this.prisma.memory.findMany({
      where: {
        userId,
        layer: MemoryLayer.SESSION,
        deletedAt: null,
        userHidden: false,
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // Last 7 days
      },
      orderBy: [
        { effectiveScore: 'desc' },
        { confidence: 'desc' },
        { priority: 'asc' },
        { createdAt: 'desc' },
      ],
      take: 100,
    });
    
    const { selected: sessionMemories, evicted: sessionEvicted } = this.selectMemoriesForBudget(
      sessionCandidates,
      LAYER_BUDGETS.session,
      0,
    );
    memories.push(...sessionMemories);
    layers.session = sessionMemories.length;
    evictions.push(...sessionEvicted.map(m => ({ id: m.id, reason: 'session_budget' })));

    // 4. Load agent self-memories if agentId is specified
    if (dto.agentId) {
      const agentMemories = await this.prisma.memory.findMany({
        where: {
          agentId: dto.agentId,
          subjectType: SubjectType.AGENT,
          deletedAt: null,
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

    // 5. Format as context string
    const context = this.formatContext(memories, dto.maxTokens ?? 4000);

    // Log evictions for monitoring
    if (evictions.length > 0) {
      console.log('[Memory] Context evictions:', {
        userId,
        totalEvicted: evictions.length,
        byReason: evictions.reduce((acc, e) => {
          acc[e.reason] = (acc[e.reason] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
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
   * Memory Intelligence: Select memories that fit within a token budget
   * Uses priority-based eviction with CONSTRAINT protection
   */
  private selectMemoriesForBudget(
    candidates: Memory[],
    budget: number,
    constraintReserve: number,
  ): { selected: Memory[]; evicted: Memory[] } {
    const selected: Memory[] = [];
    const evicted: Memory[] = [];
    let usedTokens = 0;
    
    // Rough token estimation: ~4 characters per token
    const estimateTokens = (m: Memory) => Math.ceil(m.raw.length / 4);

    // Phase 0: Safety-critical memories ALWAYS get included (never evicted)
    const safetyCritical = candidates.filter(m => m.safetyCritical);
    for (const memory of safetyCritical) {
      const tokens = estimateTokens(memory);
      selected.push(memory);
      usedTokens += tokens;
    }

    // Phase 1: Add CONSTRAINTS (priority 1) up to reserve
    const constraints = candidates.filter(m => m.priority === 1 && !m.safetyCritical);
    let constraintTokens = 0;
    
    for (const memory of constraints) {
      const tokens = estimateTokens(memory);
      if (constraintTokens + tokens <= constraintReserve || constraintReserve === 0) {
        selected.push(memory);
        constraintTokens += tokens;
        usedTokens += tokens;
      } else if (usedTokens + tokens <= budget) {
        // If reserve is full but budget has room, still add
        selected.push(memory);
        usedTokens += tokens;
      } else {
        evicted.push(memory);
      }
    }

    // Phase 2: Fill remaining budget by effectiveScore order (already sorted)
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

  /**
   * Update an existing memory (P5-001)
   * 
   * Allows editing raw content, layer, importance, and extraction fields.
   * If raw content changes, the memory is re-embedded for accurate search.
   * 
   * @throws Error if memory not found or user doesn't own it
   */
  async update(
    userId: string,
    memoryId: string,
    dto: UpdateMemoryDto,
  ): Promise<MemoryWithExtraction> {
    // 1. Fetch memory and verify ownership
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      include: { extraction: true, user: { select: { id: true, externalId: true } } },
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

    // 2. Check if content changed (need to re-embed)
    const contentChanged = dto.raw && dto.raw !== memory.raw;

    // 3. Update memory record
    const updateData: any = {
      ...(dto.raw && { raw: dto.raw }),
      ...(dto.layer && { layer: dto.layer }),
      ...(dto.importanceHint && { importanceHint: dto.importanceHint }),
      ...(dto.importanceScore !== undefined && { importanceScore: dto.importanceScore }),
    };

    // Recalculate importance if hint changed but score not explicitly set
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

    // 4. Update extraction fields if provided
    if (dto.extraction && memory.extraction) {
      const extractionUpdate: any = {};
      
      if (dto.extraction.who !== undefined) extractionUpdate.who = dto.extraction.who;
      if (dto.extraction.what !== undefined) extractionUpdate.what = dto.extraction.what;
      if (dto.extraction.where !== undefined) extractionUpdate.whereCtx = dto.extraction.where;
      if (dto.extraction.why !== undefined) extractionUpdate.why = dto.extraction.why;
      if (dto.extraction.how !== undefined) extractionUpdate.how = dto.extraction.how;
      if (dto.extraction.topics !== undefined) extractionUpdate.topics = dto.extraction.topics;
      
      // Handle 'when' field - parse if string provided
      if (dto.extraction.when !== undefined) {
        if (dto.extraction.when === null) {
          extractionUpdate.when = null;
        } else {
          extractionUpdate.when = parseFlexibleDate(dto.extraction.when, new Date());
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
      
      // Generate new embedding
      const embedding = await this.embedding.generate(dto.raw);
      await this.embedding.store(memoryId, embedding, {
        userId,
        layer: updated.layer,
        importance: updated.importanceScore,
      });

      // Re-link related memories with new embedding
      await this.linkRelatedMemories(memoryId, embedding, userId);

      // Optionally re-extract (background)
      const context: ExtractionContext = {
        userId,
        userName: memory.user?.externalId,
      };
      this.extraction.extract(dto.raw, context).then(async (extracted) => {
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
            // Memory Intelligence: update classification
            memoryType: extracted.memoryType,
            typeConfidence: extracted.typeConfidence,
            // Field-level confidence scores
            whoConfidence: extracted.confidence.whoConfidence,
            whatConfidence: extracted.confidence.whatConfidence,
            whenConfidence: extracted.confidence.whenConfidence,
            whereConfidence: extracted.confidence.whereConfidence,
            whyConfidence: extracted.confidence.whyConfidence,
            howConfidence: extracted.confidence.howConfidence,
          },
        });
        // Memory Intelligence: Update memory record with type and priority
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
        }
      }).catch((err) => {
        console.error(`[Memory] Re-extraction failed for ${memoryId}:`, err);
      });
    }

    // 6. Return updated memory with extraction
    return this.getById(memoryId) as Promise<MemoryWithExtraction>;
  }

  /**
   * Correct a memory with contradiction tracking (P5-001)
   * 
   * Creates a new "correction" memory that supersedes the original.
   * - Original memory is marked as superseded (preserved for history)
   * - New correction memory is created with CORRECTION source
   * - CONTRADICTS link is created between them
   * 
   * @returns The new correction memory
   */
  async correctMemory(
    userId: string,
    memoryId: string,
    dto: CorrectMemoryDto,
  ): Promise<MemoryWithExtraction> {
    // 1. Fetch original memory and verify ownership
    const original = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      include: { user: { select: { id: true, externalId: true } } },
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
      throw new Error(`Memory already superseded by: ${original.supersededById}`);
    }

    // 2. Calculate importance for correction (at least as important as original)
    const correctionImportance = dto.importanceHint
      ? this.importance.calculate({ hint: dto.importanceHint, layer: dto.layer ?? original.layer })
      : Math.min(1.0, original.importanceScore + 0.1); // Slightly boost importance

    // 3. Create the correction memory
    const correction = await this.prisma.memory.create({
      data: {
        userId,
        raw: dto.correctedContent,
        layer: dto.layer ?? original.layer,
        source: MemorySource.CORRECTION,
        importanceHint: dto.importanceHint ?? original.importanceHint ?? undefined,
        importanceScore: correctionImportance,
        projectId: original.projectId,
        sessionId: original.sessionId,
      },
    });

    // 4. Mark original as superseded
    await this.prisma.memory.update({
      where: { id: memoryId },
      data: {
        supersededById: correction.id,
        supersededAt: new Date(),
      },
    });

    // 5. Create CONTRADICTS link
    await this.prisma.memoryChainLink.create({
      data: {
        sourceId: correction.id,
        targetId: memoryId,
        linkType: 'CONTRADICTS',
        confidence: 1.0,
        createdBy: dto.reason ? `user:${dto.reason}` : 'user:correction',
      },
    });

    // 6. Extract and embed the correction (async)
    const context: ExtractionContext = {
      userId,
      userName: original.user?.externalId,
    };
    this.extractAndEmbed(correction.id, dto.correctedContent, userId, context).catch((err) => {
      console.error(`[Memory] Extraction failed for correction ${correction.id}:`, err);
    });

    console.log(`[Memory] Created correction: ${correction.id} supersedes ${memoryId}`);

    return correction;
  }

  /**
   * Get graph data for visualization
   */
  async getGraphData(
    userId: string,
    limit: number = 500,
    includeAgent: boolean = false,
  ): Promise<{
    nodes: any[];
    edges: any[];
    entities: any[];
    stats?: { human: number; agent: number };
  }> {
    // Build list of user IDs to fetch
    const userIds = [userId];
    let agentUserId: string | null = null;
    
    if (includeAgent) {
      // Find the agent user (externalId = 'rook') in the same agent
      const currentUser = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      
      if (currentUser) {
        const agentUser = await this.prisma.user.findFirst({
          where: {
            agentId: currentUser.agentId,
            externalId: 'rook', // Agent's self-reflection user
            deletedAt: null,
          },
        });
        
        if (agentUser) {
          userIds.push(agentUser.id);
          agentUserId = agentUser.id;
        }
      }
    }

    // Fetch memories with entities and extraction
    const memories = await this.prisma.memory.findMany({
      where: {
        userId: { in: userIds },
        deletedAt: null,
      },
      include: {
        extraction: true,
        entities: {
          include: {
            entity: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // Fetch chain links between these memories
    const memoryIds = memories.map(m => m.id);
    const chainLinks = await this.prisma.memoryChainLink.findMany({
      where: {
        OR: [
          { sourceId: { in: memoryIds } },
          { targetId: { in: memoryIds } },
        ],
      },
    });

    // Collect unique entities
    const entityMap = new Map<string, any>();
    for (const memory of memories) {
      for (const me of memory.entities) {
        if (!entityMap.has(me.entity.id)) {
          entityMap.set(me.entity.id, {
            id: me.entity.id,
            name: me.entity.name,
            type: me.entity.type,
            normalizedName: me.entity.normalizedName,
          });
        }
      }
    }

    // Transform to graph nodes
    const nodes = memories.map(m => ({
      id: m.id,
      raw: m.raw,
      layer: m.layer,
      source: m.source,
      // Tag memory source for merged view visualization
      memorySource: agentUserId && m.userId === agentUserId ? 'agent' : 'human',
      importanceScore: m.importanceScore,
      effectiveScore: m.effectiveScore, // Memory Intelligence v2
      safetyCritical: m.safetyCritical, // Memory Intelligence v2
      consolidated: m.consolidated,
      userPinned: m.userPinned,
      confidence: m.confidence,
      createdAt: m.createdAt.toISOString(),
      extraction: m.extraction ? {
        who: m.extraction.who,
        what: m.extraction.what,
        when: m.extraction.when?.toISOString(),
        where: m.extraction.whereCtx,
        why: m.extraction.why,
        how: m.extraction.how,
        topics: m.extraction.topics,
        memoryType: m.extraction.memoryType, // Type classification
        // Field-level confidence scores
        whoConfidence: m.extraction.whoConfidence,
        whatConfidence: m.extraction.whatConfidence,
        whenConfidence: m.extraction.whenConfidence,
        whereConfidence: m.extraction.whereConfidence,
        whyConfidence: m.extraction.whyConfidence,
        howConfidence: m.extraction.howConfidence,
      } : null,
      entities: m.entities.map(me => ({
        id: me.entity.id,
        name: me.entity.name,
        type: me.entity.type,
      })),
      // Determine primary entity type for coloring
      primaryEntityType: m.entities.length > 0 
        ? m.entities[0].entity.type.toLowerCase()
        : 'other',
    }));
    
    // Calculate stats for merged view
    const humanCount = nodes.filter(n => n.memorySource === 'human').length;
    const agentCount = nodes.filter(n => n.memorySource === 'agent').length;

    // Transform to graph edges
    const edges = chainLinks
      .filter(link => memoryIds.includes(link.sourceId) && memoryIds.includes(link.targetId))
      .map(link => ({
        id: link.id,
        source: link.sourceId,
        target: link.targetId,
        linkType: link.linkType,
        confidence: link.confidence,
        createdAt: link.createdAt.toISOString(),
      }));

    return {
      nodes,
      edges,
      entities: Array.from(entityMap.values()),
      ...(includeAgent && { stats: { human: humanCount, agent: agentCount } }),
    };
  }

  /**
   * Promote a LESSON memory to CONSTRAINT
   * Used for critical lessons that should be treated as hard rules
   */
  private async promoteToConstraint(memoryId: string): Promise<void> {
    await this.prisma.memory.update({
      where: { id: memoryId },
      data: {
        memoryType: 'CONSTRAINT',
        priority: 1,
        promotedFrom: memoryId, // Self-reference to track lineage
      },
    });
    console.log(`[LESSON→CONSTRAINT] Auto-promoted critical lesson: ${memoryId}`);
  }

  // =========================================================================
  // PRIVATE HELPERS
  // =========================================================================

  /**
   * Build subject type filter for queries
   * Supports filtering by explicit subjectType, agentId, or convenience flags
   */
  private buildSubjectTypeFilter(dto: QueryMemoryDto): Record<string, any> {
    const filter: Record<string, any> = {};

    // If explicit subjectType is provided, use it
    if (dto.subjectType) {
      filter.subjectType = dto.subjectType;
    }
    
    // If agentId is provided, filter to that agent's memories
    if (dto.agentId) {
      filter.agentId = dto.agentId;
    }
    
    // Handle includeUserMemories and includeAgentMemories flags
    // These are convenience flags for common use cases
    if (dto.includeUserMemories === false && dto.includeAgentMemories === false) {
      // Neither included - return empty result by filtering to impossible value
      filter.subjectType = 'IMPOSSIBLE' as any;
    } else if (dto.includeUserMemories === false) {
      // Only agent memories
      filter.subjectType = SubjectType.AGENT;
    } else if (dto.includeAgentMemories === false) {
      // Only user memories (default behavior)
      filter.subjectType = SubjectType.USER;
    }
    // If both are true (default), no subjectType filter needed - return all
    
    return filter;
  }

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
      entities: extracted.entities.map(e => ({ name: e.name, type: e.type })),
    });

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
    // Use parseFlexibleDate for robust handling of:
    // - ISO dates: "2026-02-01"
    // - Relative: "yesterday", "last week", "2 days ago"
    // - Natural language: "February 1st, 2026"
    const parsedWhen = parseFlexibleDate(extracted.when, context?.timestamp ?? new Date());
    
    if (extracted.when && !parsedWhen) {
      console.warn('[Memory] Could not parse date:', {
        memoryId,
        rawWhen: extracted.when,
        contextTimestamp: context?.timestamp?.toISOString(),
      });
    }

    // Merge source metadata with lesson fields for rawJson storage
    const rawJsonData = {
      ...sourceMetadata,
      ...(extracted.lesson ? { lesson: JSON.parse(JSON.stringify(extracted.lesson)) } : {}),
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
        rawJson: Object.keys(rawJsonData).length > 0 ? (rawJsonData as any) : undefined,
        // Memory Intelligence: classification from LLM
        memoryType: extracted.memoryType,
        typeConfidence: extracted.typeConfidence,
        // Field-level confidence scores
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

    // Memory Intelligence: Update memory record with type and priority
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
      console.log('[Memory] Memory Intelligence updated:', { memoryId, memoryType: extracted.memoryType, priority });

      // LESSON auto-promotion: critical lessons become constraints
      if (extracted.memoryType === 'LESSON' && extracted.lesson?.lessonSeverity === 'critical') {
        await this.promoteToConstraint(memoryId);
      }
    }

    // 4. Store extracted entities
    if (extracted.entities && extracted.entities.length > 0) {
      console.log('[Memory] Storing entities:', {
        memoryId,
        count: extracted.entities.length,
        entities: extracted.entities.map(e => `${e.name}:${e.type}`),
      });
      await this.storeEntities(userId, memoryId, extracted.entities);
      console.log('[Memory] Entities stored successfully for:', memoryId);
    } else {
      console.log('[Memory] No entities to store for:', memoryId);
    }

    // 5. Generate and store embedding
    const embedding = await this.embedding.generate(raw);
    const embeddingId = await this.embedding.store(memoryId, embedding);
    console.log('[Memory] Embedding stored:', { memoryId, embeddingId });

    // 6. Update memory with embedding reference
    await this.prisma.memory.update({
      where: { id: memoryId },
      data: { embeddingId },
    });

    // 7. Link to related memories
    await this.linkRelatedMemories(memoryId, embedding, userId);
    
    console.log('[Memory] extractAndEmbed complete:', memoryId);

    // 8. Process hierarchical embeddings (async, non-blocking)
    // This creates L0 (sentence) and L1 (paragraph) level embeddings
    if (this.hierarchyService?.isEnabled()) {
      this.hierarchyService.processMemory(memoryId, raw, userId).catch((err) => {
        console.error(`[Memory] Hierarchy processing failed for ${memoryId}:`, err);
      });
    }
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

      if (related.length > 0) {
        console.debug(`[linkRelatedMemories] Memory ${memoryId}: found ${related.length} linkable memories (scores: ${related.map(r => r.score.toFixed(3)).join(', ')})`);
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
              confidence: match.score, // Update confidence if link exists
            },
          });
          linksCreated++;
        } catch (error) {
          // Ignore constraint violations (link may already exist)
          console.debug(`[linkRelatedMemories] Link skipped (may exist): ${memoryId} -> ${match.id}`);
        }
      }
      
      if (linksCreated > 0) {
        console.debug(`[linkRelatedMemories] Memory ${memoryId}: created ${linksCreated} links`);
      }
    } catch (error) {
      console.error('[linkRelatedMemories] Failed to link related memories:', error);
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
