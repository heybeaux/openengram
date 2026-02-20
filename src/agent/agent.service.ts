import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LLMService } from '../llm/llm.service';
import { EmbeddingService } from '../memory/embedding.service';
import { MemoryLayer, MemorySource, SubjectType } from '@prisma/client';
import {
  AGENT_REFLECTION_SYSTEM_PROMPT,
  AGENT_REFLECTION_USER_PROMPT,
  ReflectionResponse,
  ReflectionInsight,
  ReflectionCategory,
} from './reflection.prompts';
import { ReflectDto, ReflectionResultDto } from './dto/reflect.dto';

/**
 * Service for agent self-memory operations
 *
 * Enables agents to create memories about themselves through reflection
 * on recent conversations.
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  constructor(
    private prisma: PrismaService,
    private llm: LLMService,
    private embedding: EmbeddingService,
  ) {}

  /**
   * Perform agent self-reflection on recent conversation turns
   *
   * Analyzes the conversation to extract self-knowledge and creates
   * memories with subjectType=AGENT.
   */
  async reflect(
    agentId: string,
    dto: ReflectDto,
  ): Promise<ReflectionResultDto> {
    const minImportance = dto.minImportance ?? 0.5;
    const maxMemories = dto.maxMemories ?? 5;

    this.logger.log('[AgentService] Starting reflection:', {
      agentId,
      turnCount: dto.recentTurns.length,
      agentName: dto.agentName,
      minImportance,
      maxMemories,
    });

    // 1. Call LLM to extract self-knowledge
    const insights = await this.extractInsights(dto.recentTurns, dto.agentName);

    this.logger.log('[AgentService] Extracted insights:', {
      agentId,
      totalInsights: insights.length,
      categories: this.countCategories(insights),
    });

    // 2. Filter by importance threshold
    const filteredInsights = insights
      .filter((i) => i.importance >= minImportance)
      .slice(0, maxMemories);

    this.logger.log('[AgentService] After filtering:', {
      agentId,
      filteredCount: filteredInsights.length,
      threshold: minImportance,
    });

    // 3. Create memories for each insight
    const createdMemoryIds: string[] = [];
    const categories = {
      identity: 0,
      lessons: 0,
      preferences: 0,
      workingStyle: 0,
    };

    for (const insight of filteredInsights) {
      try {
        // Check for duplicate (semantic dedup)
        const isDuplicate = await this.checkDuplicate(agentId, insight.content);
        if (isDuplicate) {
          this.logger.log(
            '[AgentService] Skipping duplicate insight:',
            insight.content.substring(0, 50),
          );
          continue;
        }

        // Create the memory
        const memory = await this.createAgentMemory(
          agentId,
          insight,
          dto.agentName,
        );
        createdMemoryIds.push(memory.id);
        categories[insight.category]++;

        this.logger.log('[AgentService] Created memory:', {
          memoryId: memory.id,
          category: insight.category,
          importance: insight.importance,
          contentPreview: insight.content.substring(0, 50),
        });
      } catch (error) {
        this.logger.error('[AgentService] Failed to create memory:', {
          agentId,
          insight: insight.content.substring(0, 50),
          error: error.message,
        });
      }
    }

    return {
      memoriesCreated: createdMemoryIds,
      insightsExtracted: insights.length,
      categories,
    };
  }

  /**
   * Get all self-memories for an agent
   */
  async getAgentMemories(
    agentId: string,
    options: { layer?: MemoryLayer; limit?: number } = {},
  ) {
    return this.prisma.memory.findMany({
      where: {
        subjectType: SubjectType.AGENT,
        agentId,
        deletedAt: null,
        ...(options.layer && { layer: options.layer }),
      },
      include: {
        extraction: true,
      },
      orderBy: [{ importanceScore: 'desc' }, { createdAt: 'desc' }],
      take: options.limit ?? 100,
    });
  }

  /**
   * Get agent memory context formatted for system prompt injection
   */
  async getAgentContext(
    agentId: string,
    maxTokens: number = 2000,
  ): Promise<{ context: string; memoriesIncluded: number }> {
    const memories = await this.getAgentMemories(agentId, { limit: 50 });

    const lines: string[] = [];
    let estimatedTokens = 0;

    if (memories.length > 0) {
      lines.push('## Agent Self-Knowledge');

      for (const memory of memories) {
        const line = `- ${memory.raw}`;
        const tokens = line.split(/\s+/).length;

        if (estimatedTokens + tokens > maxTokens) break;

        lines.push(line);
        estimatedTokens += tokens;
      }
    }

    return {
      context: lines.join('\n'),
      memoriesIncluded: memories.length,
    };
  }

  // =========================================================================
  // PRIVATE HELPERS
  // =========================================================================

  /**
   * Call LLM to extract self-knowledge insights from conversation
   */
  private async extractInsights(
    turns: { role: string; content: string }[],
    agentName?: string,
  ): Promise<ReflectionInsight[]> {
    try {
      const systemPrompt = AGENT_REFLECTION_SYSTEM_PROMPT(agentName);
      const userPrompt = AGENT_REFLECTION_USER_PROMPT(turns);

      const rawResult = await this.llm.json<Record<string, any>>(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        undefined,
        { temperature: 0.3 },
      );

      // Normalize keys to lowercase (LLM may return uppercase)
      const result: ReflectionResponse = { insights: [] };

      const insightsKey = Object.keys(rawResult).find(
        (k) => k.toLowerCase() === 'insights',
      );

      if (insightsKey && Array.isArray(rawResult[insightsKey])) {
        result.insights = rawResult[insightsKey].map((item: any) => {
          // Normalize each insight's keys
          const normalized: ReflectionInsight = {
            content: '',
            category: 'workingStyle',
            importance: 0.5,
            reasoning: '',
          };

          for (const [key, value] of Object.entries(item)) {
            const lowerKey = key.toLowerCase();
            if (lowerKey === 'content') normalized.content = String(value);
            if (lowerKey === 'category')
              normalized.category = this.normalizeCategory(String(value));
            if (lowerKey === 'importance')
              normalized.importance = Number(value) || 0.5;
            if (lowerKey === 'reasoning') normalized.reasoning = String(value);
          }

          return normalized;
        });
      }

      return result.insights;
    } catch (error) {
      this.logger.error('[AgentService] LLM extraction failed:', error);
      return [];
    }
  }

  /**
   * Normalize category string to valid ReflectionCategory
   */
  private normalizeCategory(category: string): ReflectionCategory {
    const lower = category.toLowerCase().replace(/[_-]/g, '');

    if (lower === 'identity') return 'identity';
    if (lower === 'lessons' || lower === 'lessonslearned') return 'lessons';
    if (lower === 'preferences' || lower === 'userpreferences')
      return 'preferences';
    if (lower === 'workingstyle' || lower === 'style') return 'workingStyle';

    return 'workingStyle'; // Default fallback
  }

  /**
   * Check if a similar agent memory already exists (semantic deduplication)
   */
  private async checkDuplicate(
    agentId: string,
    content: string,
    threshold: number = 0.9,
  ): Promise<boolean> {
    try {
      // Generate embedding for comparison
      const embedding = await this.embedding.generate(content);

      // Search for similar memories using agentId as userId (workaround)
      // Since agent memories use agentId in the userId field
      const similar = await this.embedding.search(agentId, embedding, 3);

      return similar.some((m) => m.score >= threshold);
    } catch (error) {
      this.logger.error('[AgentService] Duplicate check failed:', error);
      return false; // Fail open - allow creation
    }
  }

  /**
   * Create an agent self-memory
   */
  private async createAgentMemory(
    agentId: string,
    insight: ReflectionInsight,
    agentName?: string,
  ) {
    // Determine layer based on category
    const layer = this.categoryToLayer(insight.category);

    // Create memory with agent subject type
    const memory = await this.prisma.memory.create({
      data: {
        // Note: userId is required by schema, but for agent memories we use a placeholder
        // This should be addressed by making userId optional or having a system user
        userId: agentId, // Using agentId as userId for now (workaround)
        raw: insight.content,
        layer,
        source: MemorySource.AGENT_REFLECTION,
        subjectType: SubjectType.AGENT,
        subjectId: agentId,
        agentId,
        importanceScore: insight.importance,
        confidence: 0.9, // High confidence for self-reflection
      },
    });

    // Create extraction record
    await this.prisma.memoryExtraction.create({
      data: {
        memoryId: memory.id,
        who: agentName || agentId,
        what: insight.content,
        topics: [insight.category],
        rawJson: {
          category: insight.category,
          reasoning: insight.reasoning,
          source: 'agent_reflection',
        },
      },
    });

    // Generate and store embedding
    try {
      const embedding = await this.embedding.generate(insight.content);
      const embeddingId = await this.embedding.store(memory.id, embedding);

      await this.prisma.memory.update({
        where: { id: memory.id },
        data: { embeddingId },
      });
    } catch (error) {
      this.logger.error('[AgentService] Failed to store embedding:', error);
    }

    return memory;
  }

  /**
   * Map reflection category to memory layer
   */
  private categoryToLayer(category: ReflectionCategory): MemoryLayer {
    switch (category) {
      case 'identity':
        return MemoryLayer.IDENTITY;
      case 'lessons':
        return MemoryLayer.IDENTITY; // Lessons are core identity knowledge
      case 'preferences':
        return MemoryLayer.PROJECT; // User preferences are project-level
      case 'workingStyle':
        return MemoryLayer.IDENTITY;
      default:
        return MemoryLayer.SESSION;
    }
  }

  /**
   * Count insights by category
   */
  private countCategories(
    insights: ReflectionInsight[],
  ): Record<string, number> {
    const counts: Record<string, number> = {
      identity: 0,
      lessons: 0,
      preferences: 0,
      workingStyle: 0,
    };

    for (const insight of insights) {
      if (counts[insight.category] !== undefined) {
        counts[insight.category]++;
      }
    }

    return counts;
  }
}
