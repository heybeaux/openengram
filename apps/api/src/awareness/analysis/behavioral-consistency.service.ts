import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LLMService } from '../../llm/llm.service';
import { AwarenessConfig } from '../config/awareness.config';

/**
 * Types of behavioral inconsistencies that can be detected.
 */
export enum InconsistencyType {
  TONE_SHIFT = 'tone_shift',
  CAPABILITY_REGRESSION = 'capability_regression',
  CONTRADICTORY_DECISION = 'contradictory_decision',
  PREFERENCE_DRIFT = 'preference_drift',
  PATTERN_BREAK = 'pattern_break',
}

export interface BehavioralInconsistency {
  type: InconsistencyType;
  description: string;
  confidence: number;
  evidenceMemoryIds: string[];
  severity: 'low' | 'medium' | 'high';
  /** Suggested action or context for resolution */
  suggestion?: string;
}

export interface ConsistencyCheckResult {
  inconsistencies: BehavioralInconsistency[];
  memoriesAnalyzed: number;
  llmCallsUsed: number;
}

/**
 * HEY-175: Behavioral Consistency Detection
 *
 * Detects when an agent's behavior shifts from established patterns by
 * comparing recent actions/memories against historical patterns.
 * Flags inconsistencies like: tone shift, capability regression,
 * contradictory decisions. Results are stored as INSIGHT memories.
 */
@Injectable()
export class BehavioralConsistencyService {
  private readonly logger = new Logger(BehavioralConsistencyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LLMService,
  ) {}

  /**
   * Run behavioral consistency check for a user/agent.
   * Compares recent memories (last 24h) against historical patterns (last 30d).
   */
  async check(
    userId: string,
    options: {
      recentWindowHours?: number;
      historicalWindowDays?: number;
      maxLlmCalls?: number;
      agentId?: string;
    } = {},
  ): Promise<ConsistencyCheckResult> {
    const {
      recentWindowHours = 24,
      historicalWindowDays = 30,
      maxLlmCalls = 2,
      agentId,
    } = options;

    const now = new Date();
    const recentCutoff = new Date(
      now.getTime() - recentWindowHours * 60 * 60 * 1000,
    );
    const historicalCutoff = new Date(
      now.getTime() - historicalWindowDays * 24 * 60 * 60 * 1000,
    );

    // Fetch recent memories (actions/decisions from the recent window)
    const agentFilter = agentId ? { agentId } : {};
    const recentMemories = await this.prisma.memory.findMany({
      where: {
        userId,
        deletedAt: null,
        createdAt: { gte: recentCutoff },
        ...agentFilter,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        raw: true,
        layer: true,
        source: true,
        createdAt: true,
        agentId: true,
        memoryType: true,
      },
    });

    if (recentMemories.length < 3) {
      this.logger.debug(
        `Insufficient recent memories (${recentMemories.length}) for consistency check`,
      );
      return { inconsistencies: [], memoriesAnalyzed: 0, llmCallsUsed: 0 };
    }

    // Fetch historical baseline (older memories for pattern comparison)
    const historicalMemories = await this.prisma.memory.findMany({
      where: {
        userId,
        deletedAt: null,
        createdAt: { gte: historicalCutoff, lt: recentCutoff },
        ...agentFilter,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        raw: true,
        layer: true,
        source: true,
        createdAt: true,
        agentId: true,
        memoryType: true,
      },
    });

    if (historicalMemories.length < 5) {
      this.logger.debug(
        `Insufficient historical memories (${historicalMemories.length}) for baseline`,
      );
      return {
        inconsistencies: [],
        memoriesAnalyzed: recentMemories.length,
        llmCallsUsed: 0,
      };
    }

    // Run heuristic checks first (no LLM cost)
    const heuristicResults = this.runHeuristicChecks(
      recentMemories,
      historicalMemories,
    );

    // Run LLM-based deep analysis if we have budget
    let llmResults: BehavioralInconsistency[] = [];
    let llmCallsUsed = 0;

    if (maxLlmCalls > 0) {
      try {
        const existingInsights = await this.getExistingInsights(userId);
        const llmAnalysis = await this.runLlmAnalysis(
          recentMemories,
          historicalMemories,
          existingInsights,
        );
        llmResults = llmAnalysis.inconsistencies;
        llmCallsUsed = 1;
      } catch (error) {
        this.logger.warn(`LLM consistency analysis failed: ${error.message}`);
      }
    }

    const allInconsistencies = [...heuristicResults, ...llmResults];

    // Deduplicate by type + similar description
    const deduped = this.deduplicateInconsistencies(allInconsistencies);

    this.logger.log(
      `Consistency check: ${deduped.length} inconsistencies found ` +
        `(${recentMemories.length} recent, ${historicalMemories.length} historical)`,
    );

    return {
      inconsistencies: deduped,
      memoriesAnalyzed: recentMemories.length + historicalMemories.length,
      llmCallsUsed,
    };
  }

  /**
   * Heuristic checks that don't require LLM calls.
   * Detects: source distribution shifts, layer distribution shifts,
   * activity pattern changes.
   */
  private runHeuristicChecks(
    recent: Array<{
      id: string;
      raw: string;
      layer: string;
      source: string;
      createdAt: Date;
    }>,
    historical: Array<{
      id: string;
      raw: string;
      layer: string;
      source: string;
      createdAt: Date;
    }>,
  ): BehavioralInconsistency[] {
    const inconsistencies: BehavioralInconsistency[] = [];

    // Check 1: Layer distribution shift
    const recentLayers = this.distribution(recent.map((m) => m.layer));
    const historicalLayers = this.distribution(historical.map((m) => m.layer));
    const layerDrift = this.distributionDrift(recentLayers, historicalLayers);

    if (layerDrift > 0.4) {
      inconsistencies.push({
        type: InconsistencyType.PATTERN_BREAK,
        description:
          `Memory layer distribution has shifted significantly (drift: ${layerDrift.toFixed(2)}). ` +
          `Recent: ${JSON.stringify(recentLayers)}, Historical: ${JSON.stringify(historicalLayers)}`,
        confidence: Math.min(0.8, layerDrift),
        evidenceMemoryIds: recent.slice(0, 5).map((m) => m.id),
        severity: layerDrift > 0.6 ? 'high' : 'medium',
      });
    }

    // Check 2: Source distribution shift
    const recentSources = this.distribution(recent.map((m) => m.source));
    const historicalSources = this.distribution(
      historical.map((m) => m.source),
    );
    const sourceDrift = this.distributionDrift(
      recentSources,
      historicalSources,
    );

    if (sourceDrift > 0.4) {
      inconsistencies.push({
        type: InconsistencyType.PATTERN_BREAK,
        description:
          `Memory source distribution shifted (drift: ${sourceDrift.toFixed(2)}). ` +
          `This may indicate a change in how the agent is being used.`,
        confidence: Math.min(0.7, sourceDrift),
        evidenceMemoryIds: recent.slice(0, 5).map((m) => m.id),
        severity: 'medium',
      });
    }

    // Check 3: Average content length shift (proxy for tone/style)
    const recentAvgLen =
      recent.reduce((s, m) => s + m.raw.length, 0) / recent.length;
    const historicalAvgLen =
      historical.reduce((s, m) => s + m.raw.length, 0) / historical.length;
    const lenRatio =
      Math.max(recentAvgLen, historicalAvgLen) /
      Math.max(1, Math.min(recentAvgLen, historicalAvgLen));

    if (lenRatio > 2.5) {
      inconsistencies.push({
        type: InconsistencyType.TONE_SHIFT,
        description:
          `Content length has shifted significantly ` +
          `(recent avg: ${Math.round(recentAvgLen)} chars, historical avg: ${Math.round(historicalAvgLen)} chars). ` +
          `This may indicate a tone or verbosity change.`,
        confidence: Math.min(0.6, (lenRatio - 2) / 5),
        evidenceMemoryIds: recent.slice(0, 3).map((m) => m.id),
        severity: 'low',
      });
    }

    return inconsistencies;
  }

  /**
   * Fetch recent existing INSIGHT memories to provide as context for dedup.
   */
  private async getExistingInsights(userId: string): Promise<string[]> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const existing = await this.prisma.memory.findMany({
      where: {
        userId,
        layer: 'INSIGHT',
        deletedAt: null,
        createdAt: { gte: sevenDaysAgo },
      },
      select: { raw: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return existing.map((m) => m.raw);
  }

  /**
   * LLM-based deep analysis for semantic inconsistencies.
   */
  private async runLlmAnalysis(
    recent: Array<{
      id: string;
      raw: string;
      layer: string;
      createdAt: Date;
      userId?: string;
    }>,
    historical: Array<{
      id: string;
      raw: string;
      layer: string;
      createdAt: Date;
    }>,
    existingInsights: string[] = [],
  ): Promise<{ inconsistencies: BehavioralInconsistency[] }> {
    const recentSummary = recent
      .slice(0, 20)
      .map(
        (m) =>
          `[${m.layer}] (${m.createdAt.toISOString().slice(0, 10)}): ${m.raw.slice(0, 150)}`,
      )
      .join('\n');

    const historicalSummary = historical
      .slice(0, 30)
      .map(
        (m) =>
          `[${m.layer}] (${m.createdAt.toISOString().slice(0, 10)}): ${m.raw.slice(0, 150)}`,
      )
      .join('\n');

    const response = await this.llmService.chat(
      [
        {
          role: 'system',
          content: `You are a behavioral consistency analyzer for an AI memory system. Compare recent agent behavior against historical patterns and identify meaningful inconsistencies.

Look for:
1. TONE_SHIFT: Changes in communication style, formality, or emotional register
2. CAPABILITY_REGRESSION: Things the agent used to do well but now does poorly
3. CONTRADICTORY_DECISION: Recent decisions that contradict earlier established preferences or rules
4. PREFERENCE_DRIFT: Gradual shift in what the agent values or prioritizes
5. PATTERN_BREAK: Departure from established behavioral patterns

CRITICAL RULES:
- Only flag genuinely concerning shifts, not normal variation. Be specific about evidence.
- Do NOT repeat or rephrase observations that already exist in the EXISTING INSIGHTS section below. If a similar insight already exists, skip it entirely.
- Each insight must describe a DIFFERENT phenomenon. If you'd describe it the same way as an existing insight (even with different words), it's a duplicate — skip it.
- Return empty array rather than restating known observations.

Respond in JSON:
{
  "inconsistencies": [
    {
      "type": "tone_shift|capability_regression|contradictory_decision|preference_drift|pattern_break",
      "description": "Specific description with evidence references",
      "confidence": 0.0-1.0,
      "severity": "low|medium|high",
      "suggestion": "What to investigate or do about it"
    }
  ]
}

Return empty array if no meaningful inconsistencies detected OR if all observations duplicate existing insights. Quality over quantity.`,
        },
        {
          role: 'user',
          content:
            `HISTORICAL BASELINE (established patterns):\n${historicalSummary}\n\nRECENT BEHAVIOR:\n${recentSummary}` +
            (existingInsights.length > 0
              ? `\n\nEXISTING INSIGHTS (do NOT repeat these — skip any observation that overlaps):\n${existingInsights.map((i) => `- ${i.slice(0, 150)}`).join('\n')}`
              : '') +
            `\n\nAre there meaningful behavioral inconsistencies that are NOT already captured above?`,
        },
      ],
      {
        provider: 'openai',
        model: AwarenessConfig.llmModel,
        temperature: 0.3,
        maxTokens: 1000,
      },
    );

    try {
      const parsed = this.parseJsonResponse(response.content);
      return {
        inconsistencies: (parsed.inconsistencies || []).map((inc: any) => ({
          type: this.mapInconsistencyType(inc.type),
          description: inc.description,
          confidence: Math.min(1, Math.max(0, inc.confidence ?? 0.5)),
          evidenceMemoryIds: [
            ...recent.slice(0, 3).map((m) => m.id),
            ...historical.slice(0, 2).map((m) => m.id),
          ],
          severity: inc.severity || 'medium',
          suggestion: inc.suggestion,
        })),
      };
    } catch {
      this.logger.warn('Failed to parse LLM consistency response');
      return { inconsistencies: [] };
    }
  }

  private parseJsonResponse(content: string): any {
    try {
      return JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }
      throw new Error('Could not parse JSON from response');
    }
  }

  private mapInconsistencyType(type: string): InconsistencyType {
    const map: Record<string, InconsistencyType> = {
      tone_shift: InconsistencyType.TONE_SHIFT,
      capability_regression: InconsistencyType.CAPABILITY_REGRESSION,
      contradictory_decision: InconsistencyType.CONTRADICTORY_DECISION,
      preference_drift: InconsistencyType.PREFERENCE_DRIFT,
      pattern_break: InconsistencyType.PATTERN_BREAK,
    };
    return map[type] || InconsistencyType.PATTERN_BREAK;
  }

  private distribution(values: string[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const v of values) {
      counts[v] = (counts[v] || 0) + 1;
    }
    const total = values.length;
    const dist: Record<string, number> = {};
    for (const [k, c] of Object.entries(counts)) {
      dist[k] = Math.round((c / total) * 100) / 100;
    }
    return dist;
  }

  /**
   * Jensen-Shannon-like divergence between two distributions.
   * Returns 0 (identical) to 1 (completely different).
   */
  private distributionDrift(
    a: Record<string, number>,
    b: Record<string, number>,
  ): number {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    let totalDiff = 0;
    for (const key of keys) {
      totalDiff += Math.abs((a[key] || 0) - (b[key] || 0));
    }
    return Math.min(1, totalDiff / 2);
  }

  private deduplicateInconsistencies(
    items: BehavioralInconsistency[],
  ): BehavioralInconsistency[] {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = `${item.type}:${item.description.slice(0, 50)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
