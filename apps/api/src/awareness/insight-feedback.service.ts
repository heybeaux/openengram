import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InsightFeedbackAction } from './dto/insight-feedback.dto';

/**
 * HEY-151: Insight Feedback Loop
 *
 * Tracks user feedback on insights and adjusts confidence scoring
 * for similar patterns. When insights are dismissed, lower confidence
 * for similar insight types. When acted on or marked helpful, boost them.
 */
@Injectable()
export class InsightFeedbackService {
  private readonly logger = new Logger(InsightFeedbackService.name);

  /**
   * Confidence adjustment multipliers per feedback action.
   * Applied to similar future insights (same insightType).
   */
  private static readonly ADJUSTMENTS: Record<InsightFeedbackAction, number> = {
    [InsightFeedbackAction.DISMISSED]: -0.1,
    [InsightFeedbackAction.ACTED_ON]: 0.15,
    [InsightFeedbackAction.HELPFUL]: 0.1,
  };

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record feedback on an insight and adjust confidence for similar patterns.
   */
  async recordFeedback(
    insightId: string,
    action: InsightFeedbackAction,
    comment?: string,
  ): Promise<{
    insightId: string;
    action: InsightFeedbackAction;
    previousConfidence: number;
    newConfidence: number;
    similarInsightsAdjusted: number;
  }> {
    // 1. Find the insight memory
    const insight = await this.prisma.memory.findUnique({
      where: { id: insightId },
    });

    if (!insight || insight.layer !== 'INSIGHT') {
      throw new NotFoundException(`Insight ${insightId} not found`);
    }

    const metadata = (insight.metadata as Record<string, any>) || {};
    const insightType = metadata.insightType || 'unknown';
    const previousConfidence = insight.confidence;

    // 2. Store feedback in metadata
    const feedbackHistory = metadata.feedbackHistory || [];
    feedbackHistory.push({
      action,
      comment: comment || null,
      timestamp: new Date().toISOString(),
    });

    // 3. Calculate new confidence based on direct feedback
    const adjustment = InsightFeedbackService.ADJUSTMENTS[action];
    const newConfidence = Math.max(
      0,
      Math.min(1, previousConfidence + adjustment),
    );

    // 4. Update the insight
    await this.prisma.memory.update({
      where: { id: insightId },
      data: {
        confidence: newConfidence,
        metadata: {
          ...metadata,
          feedbackHistory,
          acknowledged: true,
          lastFeedbackAction: action,
          lastFeedbackAt: new Date().toISOString(),
        },
      },
    });

    // 5. Adjust confidence for similar unacknowledged insights (same type)
    const similarInsights = await this.prisma.memory.findMany({
      where: {
        id: { not: insightId },
        layer: 'INSIGHT',
        deletedAt: null,
        userId: insight.userId,
      },
    });

    let similarAdjusted = 0;
    const halfAdjustment = adjustment * 0.5; // Reduced effect on similar insights

    for (const similar of similarInsights) {
      const simMeta = (similar.metadata as Record<string, any>) || {};
      if (simMeta.insightType !== insightType) continue;
      if (simMeta.acknowledged) continue; // Don't retroactively adjust acknowledged ones

      const adjusted = Math.max(
        0,
        Math.min(1, similar.confidence + halfAdjustment),
      );
      await this.prisma.memory.update({
        where: { id: similar.id },
        data: { confidence: adjusted },
      });
      similarAdjusted++;
    }

    this.logger.log(
      `Feedback '${action}' on insight ${insightId}: confidence ${previousConfidence.toFixed(2)} → ${newConfidence.toFixed(2)}, ` +
        `${similarAdjusted} similar insights adjusted`,
    );

    return {
      insightId,
      action,
      previousConfidence,
      newConfidence,
      similarInsightsAdjusted: similarAdjusted,
    };
  }

  /**
   * Get aggregated feedback stats for an insight type.
   * Used by the confidence scorer to adjust future scoring.
   */
  async getFeedbackStats(
    userId: string,
    insightType: string,
  ): Promise<{
    totalFeedback: number;
    dismissed: number;
    actedOn: number;
    helpful: number;
    avgConfidenceAdjustment: number;
  }> {
    const insights = await this.prisma.memory.findMany({
      where: {
        userId,
        layer: 'INSIGHT',
        deletedAt: null,
      },
    });

    let dismissed = 0;
    let actedOn = 0;
    let helpful = 0;

    for (const insight of insights) {
      const meta = (insight.metadata as Record<string, any>) || {};
      if (meta.insightType !== insightType) continue;

      const history = meta.feedbackHistory || [];
      for (const fb of history) {
        switch (fb.action) {
          case InsightFeedbackAction.DISMISSED:
            dismissed++;
            break;
          case InsightFeedbackAction.ACTED_ON:
            actedOn++;
            break;
          case InsightFeedbackAction.HELPFUL:
            helpful++;
            break;
        }
      }
    }

    const total = dismissed + actedOn + helpful;
    const avgAdjustment =
      total > 0
        ? (actedOn * 0.15 + helpful * 0.1 - dismissed * 0.1) / total
        : 0;

    return {
      totalFeedback: total,
      dismissed,
      actedOn,
      helpful,
      avgConfidenceAdjustment: avgAdjustment,
    };
  }
}
