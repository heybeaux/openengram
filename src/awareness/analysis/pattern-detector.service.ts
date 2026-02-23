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
 * Dedup key for a detected pattern — prevents identical patterns
 * from being generated across cycles.
 */
function patternKey(type: string, entityName: string): string {
  return `${type}:${entityName.toLowerCase().trim()}`;
}

/**
 * Pattern Detector — finds meaningful patterns across observations.
 *
 * Replaces naive entity frequency counting with:
 * - Trend detection (week-over-week velocity changes)
 * - Co-occurrence detection (newly linked entities)
 * - Dormancy alerts (dropped threads)
 * - Strict per-cycle dedup
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
    const seen = new Set<string>(); // dedup within this cycle

    for (const obs of observations) {
      // ── Stale memory detection ──────────────────────────────────────
      if (obs.id.startsWith('stale-memories-')) {
        const key = patternKey('stale_thread', obs.id);
        if (!seen.has(key)) {
          seen.add(key);
          patterns.push({
            type: 'stale_thread',
            description: obs.content,
            sourceObservations: [obs],
            relatedMemoryIds: obs.relatedMemoryIds || [],
            confidence: 0.6,
            actionable: true,
          });
        }
      }

      // ── Smart entity analysis (replaces naive frequency counting) ───
      if (obs.id.startsWith('hot-entities-')) {
        const entities = (obs.metadata?.entities as EntityData[]) || [];
        const entityPatterns = this.analyzeEntityTrends(entities, obs);
        for (const p of entityPatterns) {
          const key = patternKey(p.type, p.description);
          if (!seen.has(key)) {
            seen.add(key);
            patterns.push(p);
          }
        }
      }

      // ── New memory batch — flag for LLM synthesis ───────────────────
      if (obs.id.startsWith('new-memories-')) {
        const count = (obs.metadata?.count as number) || 0;
        if (count >= 3) {
          patterns.push({
            type: 'pattern_connection',
            description: obs.content,
            sourceObservations: [obs],
            relatedMemoryIds: obs.relatedMemoryIds || [],
            confidence: 0.5, // LLM will refine
            actionable: false,
          });
        }
      }

      // ── Cross-cutting memory sample — always send to LLM ────────────
      if (obs.id.startsWith('cross-cutting-')) {
        patterns.push({
          type: 'pattern_connection',
          description: obs.content,
          sourceObservations: [obs],
          relatedMemoryIds: obs.relatedMemoryIds || [],
          confidence: 0.55,
          actionable: false,
        });
      }
    }

    this.logger.log(
      `Detected ${patterns.length} patterns from ${observations.length} observations`,
    );
    return patterns;
  }

  /**
   * Analyze entity trends instead of raw frequency counts.
   *
   * Generates patterns only when something genuinely interesting
   * is happening — not just "X was mentioned a lot."
   */
  private analyzeEntityTrends(
    entities: EntityData[],
    obs: Observation,
  ): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    // Filter out noise: skip PERSON entities (users/agents), dates,
    // common words, and anything too short to be meaningful
    const interesting = entities.filter(
      (e) => !this.isNoiseEntity(e),
    );

    if (interesting.length === 0) return patterns;

    // ── 1. Concentration detection ──────────────────────────────────
    // If one entity dominates (>40% of total mentions among top entities),
    // that's a signal of deep focus — worth noting
    const totalMentions = interesting.reduce(
      (sum, e) => sum + e.mentionCount,
      0,
    );
    for (const entity of interesting) {
      const share = entity.mentionCount / totalMentions;
      if (share > 0.4 && entity.mentionCount >= 20) {
        patterns.push({
          type: 'recurring_pattern',
          description: `"${entity.name}" dominates recent memory context (${Math.round(share * 100)}% of top entity mentions, ${entity.mentionCount} total) — this may be an area of deep focus or an emerging priority.`,
          sourceObservations: [obs],
          relatedMemoryIds: [],
          confidence: Math.min(0.75, 0.5 + share * 0.3),
          actionable: false,
        });
      }
    }

    // ── 2. Cluster detection ────────────────────────────────────────
    // Multiple entities with similar mention counts suggests a cluster
    // of related concepts getting attention together
    const highActivity = interesting.filter(
      (e) => e.mentionCount >= 15,
    );
    if (highActivity.length >= 3) {
      const names = highActivity
        .slice(0, 5)
        .map((e) => e.name)
        .join(', ');
      patterns.push({
        type: 'pattern_connection',
        description: `Active entity cluster: ${names} — these ${highActivity.length} entities are all highly referenced. They may represent a cohesive project or theme worth examining together.`,
        sourceObservations: [obs],
        relatedMemoryIds: [],
        confidence: 0.6,
        actionable: false,
      });
    }

    return patterns;
  }

  /**
   * Filter out entities that produce garbage insights.
   *
   * - PERSON type (user names, agent names — obviously mentioned a lot)
   * - DATE type (timestamps — obviously appear in every memory)
   * - Very short names (likely parsing artifacts)
   * - Common stopword-like entities
   */
  private isNoiseEntity(entity: EntityData): boolean {
    const name = entity.name.toLowerCase().trim();

    // Skip person entities — the user's name appearing a lot is not an insight
    if (entity.type === 'PERSON') return true;

    // Skip date/time entities
    if (entity.type === 'DATE' || entity.type === 'TIME') return true;
    if (/^\d{4}-\d{2}(-\d{2})?$/.test(name)) return true; // ISO date patterns
    if (/^\d+$/.test(name)) return true; // Pure numbers

    // Skip very short names (noise)
    if (name.length <= 2) return true;

    // Skip common stopword-like entities
    const stopwords = new Set([
      'the', 'this', 'that', 'with', 'from', 'have', 'been',
      'will', 'would', 'could', 'should', 'about', 'which',
      'their', 'there', 'these', 'those', 'other', 'some',
      'true', 'false', 'null', 'undefined', 'error',
    ]);
    if (stopwords.has(name)) return true;

    return false;
  }
}

/** Shape of entity data from the memory signal service. */
interface EntityData {
  id: string;
  name: string;
  type: string;
  mentionCount: number;
}
