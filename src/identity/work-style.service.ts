import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkStyleDimensionDto } from './dto/identity.dto';

/**
 * HEY-181: Preference & Work Style Tracking
 *
 * Tracks agent work style patterns: response time, verbosity,
 * tool usage patterns, collaboration style.
 * Extracted from behavioral data in memories and task outcomes.
 */
@Injectable()
export class WorkStyleService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get all work style dimensions for an agent
   */
  async getWorkStyle(
    agentId: string,
    userId: string,
  ): Promise<WorkStyleDimensionDto[]> {
    const styles = await this.prisma.agentWorkStyle.findMany({
      where: { agentId, userId },
      orderBy: { dimension: 'asc' },
    });

    return styles.map((s) => ({
      dimension: s.dimension,
      value: s.value,
      sampleCount: s.sampleCount,
      trend: s.trend ?? undefined,
    }));
  }

  /**
   * Update a work style dimension with a new observation.
   * Uses incremental aggregation for numeric values and frequency counting for categorical.
   */
  async recordObservation(
    agentId: string,
    userId: string,
    dimension: string,
    observation: any,
  ): Promise<void> {
    const normalized = dimension.toLowerCase().trim();

    const existing = await this.prisma.agentWorkStyle.findUnique({
      where: {
        agentId_userId_dimension: {
          agentId,
          userId,
          dimension: normalized,
        },
      },
    });

    if (existing) {
      const currentValue = existing.value as any;
      const newSampleCount = existing.sampleCount + 1;

      let newValue: any;
      let trend: string | null = null;

      if (typeof observation === 'number' && typeof currentValue?.avg === 'number') {
        // Numeric dimension: update running average + min/max
        const newAvg =
          (currentValue.avg * existing.sampleCount + observation) /
          newSampleCount;
        trend =
          newAvg > currentValue.avg * 1.05
            ? 'increasing'
            : newAvg < currentValue.avg * 0.95
              ? 'decreasing'
              : 'stable';
        newValue = {
          avg: newAvg,
          min: Math.min(currentValue.min ?? observation, observation),
          max: Math.max(currentValue.max ?? observation, observation),
          latest: observation,
        };
      } else if (typeof observation === 'number') {
        // First numeric for this dimension
        newValue = { avg: observation, min: observation, max: observation, latest: observation };
        trend = 'stable';
      } else if (typeof observation === 'string') {
        // Categorical: frequency map
        const freq = currentValue?.frequencies ?? {};
        freq[observation] = (freq[observation] ?? 0) + 1;
        newValue = { frequencies: freq, latest: observation };
      } else {
        // Object: just store latest
        newValue = { latest: observation, previous: currentValue?.latest };
      }

      await this.prisma.agentWorkStyle.update({
        where: { id: existing.id },
        data: {
          value: newValue,
          sampleCount: newSampleCount,
          trend,
        },
      });
    } else {
      let value: any;
      if (typeof observation === 'number') {
        value = { avg: observation, min: observation, max: observation, latest: observation };
      } else if (typeof observation === 'string') {
        value = { frequencies: { [observation]: 1 }, latest: observation };
      } else {
        value = { latest: observation };
      }

      await this.prisma.agentWorkStyle.create({
        data: {
          agentId,
          userId,
          dimension: normalized,
          value,
          sampleCount: 1,
          trend: 'stable',
        },
      });
    }
  }

  /**
   * Extract work style observations from a task outcome.
   * Called when a TASK_OUTCOME memory is created.
   */
  async extractFromTaskOutcome(
    agentId: string,
    userId: string,
    outcome: {
      durationMs?: number;
      capabilitiesUsed?: string[];
      outcome: string;
    },
  ): Promise<void> {
    // Track response/task duration
    if (outcome.durationMs != null) {
      await this.recordObservation(
        agentId,
        userId,
        'task_duration',
        outcome.durationMs,
      );
    }

    // Track tool/capability usage breadth
    if (outcome.capabilitiesUsed?.length) {
      await this.recordObservation(
        agentId,
        userId,
        'capability_breadth',
        outcome.capabilitiesUsed.length,
      );

      // Track individual tool usage frequency
      for (const cap of outcome.capabilitiesUsed) {
        await this.recordObservation(
          agentId,
          userId,
          'tool_usage',
          cap.toLowerCase().trim(),
        );
      }
    }

    // Track outcome distribution
    await this.recordObservation(
      agentId,
      userId,
      'outcome_distribution',
      outcome.outcome,
    );
  }
}
