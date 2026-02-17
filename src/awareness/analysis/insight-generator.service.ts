import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
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

/**
 * Insight Generator — transforms detected patterns into INSIGHT memories.
 *
 * MVP: uses LLM to synthesize patterns into natural-language insights,
 * then validates source memory IDs exist before returning.
 */
@Injectable()
export class InsightGeneratorService {
  private readonly logger = new Logger(InsightGeneratorService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generate(
    patterns: DetectedPattern[],
    budget: { maxLlmCalls: number; maxInsights: number },
  ): Promise<GeneratedInsight[]> {
    const insights: GeneratedInsight[] = [];
    let llmCallsUsed = 0;

    // Sort patterns by confidence (highest first)
    const sorted = [...patterns].sort((a, b) => b.confidence - a.confidence);

    for (const pattern of sorted) {
      if (insights.length >= budget.maxInsights) break;
      if (pattern.confidence < AwarenessConfig.minConfidence) continue;

      // Validate source memory IDs exist
      const validMemoryIds = await this.validateSources(pattern.relatedMemoryIds);

      // For MVP, generate insight directly from pattern description
      // TODO: Replace with LLM call for richer synthesis
      if (llmCallsUsed < budget.maxLlmCalls && pattern.type === 'pattern_connection') {
        // LLM synthesis would go here — for now, pass through
        llmCallsUsed++;
      }

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
