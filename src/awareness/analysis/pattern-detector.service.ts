import { Injectable, Logger } from '@nestjs/common';
import { Observation } from '../signals/signal.interface';

/**
 * Detected pattern ready for insight generation.
 */
export interface DetectedPattern {
  /** Type of pattern found. */
  type:
    | 'pattern_connection'
    | 'velocity_shift'
    | 'stale_thread'
    | 'knowledge_gap'
    | 'recurring_pattern'
    | 'team_signal';
  /** Human-readable description of the pattern. */
  description: string;
  /** Observations that contributed to this pattern. */
  sourceObservations: Observation[];
  /** Memory IDs related to this pattern. */
  relatedMemoryIds: string[];
  /** Raw confidence estimate (0–1). */
  confidence: number;
  /** Is this pattern actionable? */
  actionable: boolean;
}

/**
 * Pattern Detector — finds meaningful patterns across observations.
 *
 * MVP uses simple heuristics. Future versions can use LLM-based
 * pattern detection or graph traversal.
 */
@Injectable()
export class PatternDetectorService {
  private readonly logger = new Logger(PatternDetectorService.name);

  /**
   * Detect patterns across a set of observations.
   * Returns patterns sorted by type with heuristic confidence scores.
   */
  detect(observations: Observation[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    for (const obs of observations) {
      // Stale memory detection
      if (obs.id.startsWith('stale-memories-')) {
        patterns.push({
          type: 'stale_thread',
          description: obs.content,
          sourceObservations: [obs],
          relatedMemoryIds: obs.relatedMemoryIds || [],
          confidence: 0.6,
          actionable: true,
        });
      }

      // Recurring entity detection
      if (obs.id.startsWith('hot-entities-')) {
        const entities = (obs.metadata?.entities as any[]) || [];
        for (const entity of entities.filter(e => e.mentionCount >= 10)) {
          patterns.push({
            type: 'recurring_pattern',
            description: `"${entity.name}" has been mentioned ${entity.mentionCount} times — this is a recurring theme.`,
            sourceObservations: [obs],
            relatedMemoryIds: [],
            confidence: Math.min(0.9, 0.5 + entity.mentionCount * 0.02),
            actionable: false,
          });
        }
      }

      // New memory batch — flag for LLM synthesis
      if (obs.id.startsWith('new-memories-')) {
        const count = (obs.metadata?.count as number) || 0;
        if (count >= 5) {
          patterns.push({
            type: 'pattern_connection',
            description: obs.content,
            sourceObservations: [obs],
            relatedMemoryIds: obs.relatedMemoryIds || [],
            confidence: 0.5, // LLM will refine this
            actionable: false,
          });
        }
      }
    }

    this.logger.log(`Detected ${patterns.length} patterns from ${observations.length} observations`);
    return patterns;
  }
}
