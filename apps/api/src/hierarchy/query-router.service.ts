import { Injectable } from '@nestjs/common';

/**
 * Hierarchy level type
 */
export type HierarchyLevel = 'L0' | 'L1' | 'L2' | 'L3';

/**
 * Query analysis result
 */
export interface QueryAnalysis {
  query: string;
  suggestedLevels: HierarchyLevel[];
  confidence: number;
  reasoning: string;
}

/**
 * Query Router Service
 *
 * Analyzes queries to determine optimal hierarchy levels to search.
 * Uses pattern matching to detect query intent and route accordingly.
 *
 * Level indicators:
 * - L0 (Sentence): Specific facts, quotes, exact values, commands
 * - L1 (Paragraph): Explanations, reasoning, comparisons
 * - L2 (Session): Meeting overviews, conversation summaries (Phase 2)
 * - L3 (Theme): Patterns, preferences, recurring behaviors (Phase 2)
 */
@Injectable()
export class QueryRouterService {
  /**
   * Pattern definitions for level detection
   * Maps regex patterns to their suggested levels
   */
  private readonly patterns: Array<{
    pattern: RegExp;
    levels: HierarchyLevel[];
    description: string;
  }> = [
    // L0 indicators - specific facts
    {
      pattern: /\b(exact|specific|precisely|quote|verbatim)\b/i,
      levels: ['L0'],
      description: 'Exact/specific query',
    },
    {
      pattern: /\bwhat (was|is|are) the\b/i,
      levels: ['L0', 'L1'],
      description: 'Factual question',
    },
    {
      pattern: /\b(error code|command|syntax|api endpoint|url|path|value)\b/i,
      levels: ['L0'],
      description: 'Technical specifics',
    },
    {
      pattern: /\b(said|told|mentioned|stated)\b/i,
      levels: ['L0'],
      description: 'Quote request',
    },

    // L1 indicators - explanations
    {
      pattern: /\b(explain|how does|why did|reasoning|because|reason for)\b/i,
      levels: ['L1'],
      description: 'Explanation request',
    },
    {
      pattern: /\b(relationship between|compare|difference|versus|vs\.?)\b/i,
      levels: ['L1'],
      description: 'Comparison/relationship',
    },
    {
      pattern: /\b(context|background|overview)\b/i,
      levels: ['L1', 'L0'],
      description: 'Context request',
    },
    {
      pattern: /\b(steps|process|procedure|how to)\b/i,
      levels: ['L1'],
      description: 'Process/steps query',
    },

    // L2 indicators - session/conversation scope (Phase 2)
    {
      pattern: /\bwhat did we (discuss|talk about|cover)\b/i,
      levels: ['L2', 'L1'],
      description: 'Session content query',
    },
    {
      pattern: /\b(last|that|the) (session|conversation|meeting|call)\b/i,
      levels: ['L2'],
      description: 'Session reference',
    },
    {
      pattern: /\b(summary of|summarize|recap)\b/i,
      levels: ['L2', 'L1'],
      description: 'Summary request',
    },

    // L3 indicators - patterns/preferences (Phase 2)
    {
      pattern: /\b(usually|always|never|tend to|prefer|habit)\b/i,
      levels: ['L3', 'L1'],
      description: 'Preference/habit query',
    },
    {
      pattern: /\bwhat (do|does) .* (think about|feel about|prefer)\b/i,
      levels: ['L3'],
      description: 'Opinion/preference query',
    },
    {
      pattern: /\b(philosophy|approach|style|pattern|theme)\b/i,
      levels: ['L3', 'L1'],
      description: 'Pattern/style query',
    },
    {
      pattern: /\b(recurring|consistent|over time|historically)\b/i,
      levels: ['L3'],
      description: 'Historical pattern query',
    },
  ];

  /**
   * Analyze a query to determine optimal levels to search
   */
  analyze(query: string): QueryAnalysis {
    const matchedPatterns: Array<{
      levels: HierarchyLevel[];
      description: string;
    }> = [];

    for (const { pattern, levels, description } of this.patterns) {
      if (pattern.test(query)) {
        matchedPatterns.push({ levels, description });
      }
    }

    // No patterns matched - use default multi-level search
    if (matchedPatterns.length === 0) {
      return {
        query,
        suggestedLevels: ['L0', 'L1'], // MVP: only L0 and L1
        confidence: 0.5,
        reasoning: 'No strong level indicators; using multi-level search',
      };
    }

    // Collect all suggested levels, counting frequency
    const levelCounts = new Map<HierarchyLevel, number>();
    for (const { levels } of matchedPatterns) {
      for (const level of levels) {
        levelCounts.set(level, (levelCounts.get(level) || 0) + 1);
      }
    }

    // Sort levels by frequency (most suggested first)
    const sortedLevels = Array.from(levelCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([level]) => level);

    // For MVP, filter to only L0 and L1
    const mvpLevels = sortedLevels.filter(
      (l) => l === 'L0' || l === 'L1',
    ) as HierarchyLevel[];

    // If no MVP levels found but we have L2/L3, fall back to L1
    const finalLevels =
      mvpLevels.length > 0 ? mvpLevels : (['L1'] as HierarchyLevel[]);

    // Calculate confidence based on pattern agreement
    const maxCount = Math.max(...levelCounts.values());
    const totalPatterns = matchedPatterns.length;
    const confidence = Math.min(0.95, 0.6 + (maxCount / totalPatterns) * 0.35);

    return {
      query,
      suggestedLevels: finalLevels,
      confidence,
      reasoning: `Pattern matches: ${matchedPatterns.map((p) => p.description).join(', ')}`,
    };
  }

  /**
   * Get default levels for a given routing mode
   */
  getDefaultLevels(mode: 'precise' | 'balanced' | 'broad'): HierarchyLevel[] {
    switch (mode) {
      case 'precise':
        return ['L0'];
      case 'balanced':
        return ['L0', 'L1'];
      case 'broad':
        return ['L0', 'L1']; // Would include L2, L3 in Phase 2
      default:
        return ['L0', 'L1'];
    }
  }

  /**
   * Get level weights for result aggregation
   */
  getLevelWeights(
    queryType: 'factual' | 'contextual' | 'thematic' | 'balanced',
  ): Record<HierarchyLevel, number> {
    switch (queryType) {
      case 'factual':
        return { L0: 1.2, L1: 1.0, L2: 0.8, L3: 0.6 };
      case 'contextual':
        return { L0: 0.8, L1: 1.2, L2: 1.0, L3: 0.8 };
      case 'thematic':
        return { L0: 0.6, L1: 0.8, L2: 1.0, L3: 1.2 };
      case 'balanced':
      default:
        return { L0: 1.0, L1: 1.0, L2: 1.0, L3: 1.0 };
    }
  }
}
