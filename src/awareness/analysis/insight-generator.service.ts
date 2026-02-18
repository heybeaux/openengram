import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LLMService } from '../../llm/llm.service';
import { DetectedPattern } from './pattern-detector.service';
import { AwarenessConfig } from '../config/awareness.config';

export interface GeneratedInsight {
  content: string;
  insightType: string;
  confidence: number;
  sourceMemoryIds: string[];
  signalSource: string;
  actionable: boolean;
}

interface LLMInsightResponse {
  insights: Array<{
    content: string;
    confidence: number;
    actionable: boolean;
    type: string;
  }>;
}

/**
 * Insight Generator — transforms detected patterns into INSIGHT memories.
 *
 * Uses LLM to synthesize patterns into natural-language insights,
 * then validates source memory IDs exist before returning.
 */
@Injectable()
export class InsightGeneratorService {
  private readonly logger = new Logger(InsightGeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LLMService,
  ) {}

  /**
   * Generate insights from detected patterns using LLM synthesis.
   * Respects budget constraints for LLM calls and max insights.
   */
  async generate(
    patterns: DetectedPattern[],
    budget: { maxLlmCalls: number; maxInsights: number },
  ): Promise<GeneratedInsight[]> {
    const insights: GeneratedInsight[] = [];
    let llmCallsUsed = 0;

    // Sort patterns by confidence (highest first)
    const sorted = [...patterns].sort((a, b) => b.confidence - a.confidence);

    // Batch patterns for a single LLM call when possible
    const patternsForLlm: DetectedPattern[] = [];
    const passthrough: DetectedPattern[] = [];

    for (const pattern of sorted) {
      if (pattern.confidence < AwarenessConfig.minConfidence) continue;
      if (pattern.type === 'pattern_connection' && llmCallsUsed < budget.maxLlmCalls) {
        patternsForLlm.push(pattern);
      } else {
        passthrough.push(pattern);
      }
    }

    // ── LLM synthesis for pattern_connection types ─────────────────────
    if (patternsForLlm.length > 0 && llmCallsUsed < budget.maxLlmCalls) {
      try {
        const synthesized = await this.synthesizeWithLlm(patternsForLlm);
        llmCallsUsed++;

        for (const synth of synthesized) {
          if (insights.length >= budget.maxInsights) break;

          const sourceMemoryIds = patternsForLlm.flatMap(p => p.relatedMemoryIds);
          const validMemoryIds = await this.validateSources(sourceMemoryIds);

          insights.push({
            content: synth.content,
            insightType: synth.type || 'pattern_connection',
            confidence: synth.confidence,
            sourceMemoryIds: validMemoryIds,
            signalSource: patternsForLlm[0]?.sourceObservations.map(o => o.source).join('+') || 'memory',
            actionable: synth.actionable,
          });
        }
      } catch (error) {
        this.logger.warn(`LLM synthesis failed, falling back to passthrough: ${error.message}`);
        // On LLM failure, treat as passthrough
        passthrough.push(...patternsForLlm);
      }
    }

    // ── Passthrough for non-LLM patterns ──────────────────────────────
    for (const pattern of passthrough) {
      if (insights.length >= budget.maxInsights) break;

      const validMemoryIds = await this.validateSources(pattern.relatedMemoryIds);

      insights.push({
        content: pattern.description,
        insightType: pattern.type,
        confidence: pattern.confidence,
        sourceMemoryIds: validMemoryIds,
        signalSource: pattern.sourceObservations.map(o => o.source).join('+'),
        actionable: pattern.actionable,
      });
    }

    this.logger.log(
      `Generated ${insights.length} insights from ${patterns.length} patterns (${llmCallsUsed} LLM calls)`,
    );

    return insights;
  }

  /**
   * Use LLM to synthesize raw pattern observations into meaningful insights.
   * Fetches source memories for full context and asks the model to find
   * non-obvious connections, gaps, and actionable observations.
   */
  private async synthesizeWithLlm(
    patterns: DetectedPattern[],
  ): Promise<Array<{ content: string; confidence: number; actionable: boolean; type: string }>> {
    // Fetch the actual memory content for richer context
    const allMemoryIds = [...new Set(patterns.flatMap(p => p.relatedMemoryIds))];
    const memories = allMemoryIds.length > 0
      ? await this.prisma.memory.findMany({
          where: { id: { in: allMemoryIds.slice(0, 30) }, deletedAt: null },
          select: { id: true, raw: true, layer: true, createdAt: true, agentId: true },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    const memoryContext = memories
      .map(m => `[${m.layer}${m.agentId ? ` by ${m.agentId}` : ''}] (${m.createdAt.toISOString().slice(0, 10)}): ${m.raw.slice(0, 200)}`)
      .join('\n');

    const patternSummary = patterns
      .map(p => `- [${p.type}] ${p.description}`)
      .join('\n');

    const response = await this.llmService.chat(
      [
        {
          role: 'system',
          content: `You are an insight engine for Engram, an AI memory system. Analyze memory patterns and surface connections that humans and agents would miss on their own.

QUALITY BAR — every insight MUST:
1. Name specific memories, PRs, entities, or events (not "improve documentation")
2. Connect two or more things that weren't explicitly linked ("X from 3 days ago + Y today suggests Z")
3. Be something the reader couldn't have noticed without seeing the full memory graph
4. Be falsifiable — someone could check if it's true or act on it

BAD (too generic): "The team could benefit from better CI/CD practices"
GOOD (specific + surprising): "The deploy failure in PR #6 touched the same vector cast code that caused the 9s latency issue last week — these are the same root cause"

BAD: "Documentation could be improved"  
GOOD: "Beaux asked about API key scoping 3 times across different sessions but no IDENTITY memory captures the policy — this will keep coming up"

CONFIDENCE SCORING — be honest and varied:
- 0.4-0.5: interesting hunch, weak evidence
- 0.6-0.7: clear pattern, moderate evidence
- 0.8-0.9: strong evidence from multiple memories
- 1.0: never (you're an AI analyzing incomplete data)

Respond in JSON:
{
  "insights": [
    {
      "content": "Specific insight referencing concrete memories/events",
      "confidence": 0.65,
      "actionable": true,
      "type": "pattern_connection|velocity_shift|stale_thread|knowledge_gap|recurring_pattern|team_signal"
    }
  ]
}

Return at most 3 insights. If nothing genuinely surprising stands out, return an empty array. An empty array is better than generic observations.`,
        },
        {
          role: 'user',
          content: `Here are recent patterns detected in the memory system:

${patternSummary}

And here are the actual memories referenced:

${memoryContext}

What non-obvious insights do you see?`,
        },
      ],
      {
        provider: 'openai',
        model: AwarenessConfig.llmModel,
        temperature: 0.7,
        maxTokens: 1000,
      },
    );

    try {
      const parsed = JSON.parse(response.content) as LLMInsightResponse;
      return parsed.insights || [];
    } catch {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = response.content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]) as LLMInsightResponse;
        return parsed.insights || [];
      }
      this.logger.warn('Failed to parse LLM response as JSON');
      return [];
    }
  }

  /**
   * Validate that referenced memory IDs actually exist.
   * Drops any that have been deleted or deduped.
   */
  private async validateSources(memoryIds: string[]): Promise<string[]> {
    if (memoryIds.length === 0) return [];

    const existing = await this.prisma.memory.findMany({
      where: {
        id: { in: memoryIds },
        deletedAt: null,
      },
      select: { id: true },
    });

    const validIds = new Set(existing.map(m => m.id));
    const dropped = memoryIds.filter(id => !validIds.has(id));

    if (dropped.length > 0) {
      this.logger.warn(
        `Dropped ${dropped.length} invalid source memory IDs: ${dropped.join(', ')}`,
      );
    }

    return [...validIds];
  }
}
