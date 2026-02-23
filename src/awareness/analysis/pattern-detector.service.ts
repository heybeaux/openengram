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

      // Recurring entity detection — skip obvious/useless entities
      if (obs.id.startsWith('hot-entities-')) {
        const entities = (obs.metadata?.entities as any[]) || [];
        // Filter out: user names, dates, common words, very high-frequency noise
        const SKIP_PATTERNS = [
          /^\d{4}-\d{2}-\d{2}/, // dates
          /^\d+$/, // pure numbers
          /^(the|a|an|is|was|has|been|this|that|with|for|from|are|not|but|have|will|can|all|just|more|also|very|much|many|some|any|each|every|both|few|most|own|other|same|such|only|than|too|now|then|here|there|where|when|how|what|which|who|whom|why)$/i,
        ];
        const skipNames = new Set(
          ((obs.metadata?.skipNames as string[]) || []).map(n => n.toLowerCase()),
        );
        // Also skip the user's own name and agent names — they're always frequent
        for (const entity of entities.filter(e => {
          if (e.mentionCount < 20) return false; // raise threshold
          const name = (e.name || '').trim();
          if (name.length < 3) return false;
          if (skipNames.has(name.toLowerCase())) return false;
          if (SKIP_PATTERNS.some(p => p.test(name))) return false;
          // Skip if entity type is a person/user — their name appearing a lot is obvious
          if (e.type === 'person' || e.type === 'user' || e.type === 'agent') return false;
          return true;
        })) {
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
        if (count >= 3) {
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

      // Cross-cutting memory sample — always send to LLM for deep analysis
      if (obs.id.startsWith('cross-cutting-')) {
        patterns.push({
          type: 'pattern_connection',
          description: obs.content,
          sourceObservations: [obs],
          relatedMemoryIds: obs.relatedMemoryIds || [],
          confidence: 0.55, // slightly above threshold, LLM will refine
          actionable: false,
        });
      }
    }

    this.logger.log(`Detected ${patterns.length} patterns from ${observations.length} observations`);
    return patterns;
  }
}
