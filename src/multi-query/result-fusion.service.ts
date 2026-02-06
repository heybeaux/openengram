import { Injectable } from '@nestjs/common';
import { FusionStrategy } from './dto/multi-query.dto';
import { QueryExpansionResult } from './query-expansion.service';

/**
 * Search result from a single query
 */
export interface QuerySearchResult {
  query: string;
  queryIndex: number;
  matches: Array<{
    id: string;
    score: number;
    metadata?: Record<string, any>;
  }>;
  searchTimeMs: number;
}

/**
 * Query match information for a fused result
 */
export interface QueryMatch {
  queryIndex: number;
  query: string;
  rank: number;
  score: number;
}

/**
 * Fused result combining signals from multiple queries
 */
export interface FusedResult {
  memoryId: string;
  score: number;           // Final normalized score
  rrfScore: number;        // Raw RRF score
  queryCount: number;      // Number of queries that matched
  bestRank: number;        // Best rank across all queries
  avgScore: number;        // Average similarity score
  metadata?: Record<string, any>;
  queryMatches: QueryMatch[];
}

/**
 * Configuration for RRF fusion
 */
export interface RRFConfig {
  k: number;               // Damping constant (default: 60)
  normalizeScores: boolean;
  minQueries: number;      // Minimum queries a result must appear in
}

/**
 * Configuration for weighted RRF fusion
 */
export interface WeightedFusionConfig {
  originalWeight: number;    // Weight for original query
  ruleVariantWeight: number; // Weight for rule-based variants
  llmVariantWeight: number;  // Weight for LLM variants
  baseRRFk: number;          // Base RRF k value
}

const DEFAULT_RRF_CONFIG: RRFConfig = {
  k: 60,
  normalizeScores: true,
  minQueries: 1,
};

const DEFAULT_WEIGHTED_CONFIG: WeightedFusionConfig = {
  originalWeight: 2.0,
  ruleVariantWeight: 1.0,
  llmVariantWeight: 0.8,
  baseRRFk: 60,
};

/**
 * Result Fusion Service
 * 
 * Combines and re-ranks results from multiple query variants using
 * various fusion strategies (RRF, frequency-based, weighted).
 */
@Injectable()
export class ResultFusionService {
  /**
   * Fuse results using the specified strategy
   */
  fuse(
    searchResults: QuerySearchResult[],
    strategy: FusionStrategy,
    expansion?: QueryExpansionResult,
  ): FusedResult[] {
    switch (strategy) {
      case FusionStrategy.RRF:
        return this.fuseWithRRF(searchResults);
      case FusionStrategy.FREQUENCY:
        return this.fuseWithFrequency(searchResults);
      case FusionStrategy.WEIGHTED:
        return this.fuseWithWeightedRRF(searchResults, expansion);
      case FusionStrategy.MAX_SCORE:
        return this.fuseWithMaxScore(searchResults);
      default:
        return this.fuseWithRRF(searchResults);
    }
  }

  /**
   * Reciprocal Rank Fusion (RRF)
   * 
   * Score = Σ 1/(k + rank) across all queries where the document appears
   * 
   * Well-studied fusion method that works well without tuning.
   * The k parameter dampens the impact of high ranks (default: 60).
   */
  fuseWithRRF(
    searchResults: QuerySearchResult[],
    config: RRFConfig = DEFAULT_RRF_CONFIG,
  ): FusedResult[] {
    const memoryMap = new Map<string, FusedResult>();

    for (const queryResult of searchResults) {
      for (let rank = 0; rank < queryResult.matches.length; rank++) {
        const match = queryResult.matches[rank];
        const memoryId = match.id;

        let entry = memoryMap.get(memoryId);
        if (!entry) {
          entry = this.createEmptyResult(memoryId, match.metadata);
          memoryMap.set(memoryId, entry);
        }

        // RRF contribution: 1/(k + rank + 1), rank is 0-indexed so add 1
        const rrfContribution = 1 / (config.k + rank + 1);
        entry.rrfScore += rrfContribution;
        entry.queryCount++;
        entry.bestRank = Math.min(entry.bestRank, rank + 1);

        // Update average score incrementally
        entry.avgScore = (entry.avgScore * (entry.queryCount - 1) + match.score) / entry.queryCount;

        entry.queryMatches.push({
          queryIndex: queryResult.queryIndex,
          query: queryResult.query,
          rank: rank + 1,
          score: match.score,
        });
      }
    }

    // Filter by minimum query count
    let results = Array.from(memoryMap.values())
      .filter(r => r.queryCount >= config.minQueries);

    // Sort by RRF score (descending)
    results.sort((a, b) => b.rrfScore - a.rrfScore);

    // Normalize scores
    if (config.normalizeScores && results.length > 0) {
      const maxRRF = results[0].rrfScore;
      for (const result of results) {
        result.score = maxRRF > 0 ? result.rrfScore / maxRRF : 0;
      }
    } else {
      for (const result of results) {
        result.score = result.rrfScore;
      }
    }

    return results;
  }

  /**
   * Frequency-based fusion
   * 
   * Boosts results that appear in more queries.
   * Score = (queryCount / numQueries) * 0.4 + maxScore * 0.6
   */
  fuseWithFrequency(searchResults: QuerySearchResult[]): FusedResult[] {
    const memoryMap = new Map<string, FusedResult>();
    const numQueries = searchResults.length;

    for (const queryResult of searchResults) {
      for (let rank = 0; rank < queryResult.matches.length; rank++) {
        const match = queryResult.matches[rank];
        const memoryId = match.id;

        let entry = memoryMap.get(memoryId);
        if (!entry) {
          entry = this.createEmptyResult(memoryId, match.metadata);
          memoryMap.set(memoryId, entry);
        }

        entry.queryCount++;
        entry.avgScore = Math.max(entry.avgScore, match.score); // Track max score
        entry.bestRank = Math.min(entry.bestRank, rank + 1);
        
        entry.queryMatches.push({
          queryIndex: queryResult.queryIndex,
          query: queryResult.query,
          rank: rank + 1,
          score: match.score,
        });
      }
    }

    // Calculate combined score
    for (const entry of memoryMap.values()) {
      const frequencyBoost = entry.queryCount / numQueries; // 0-1
      entry.score = frequencyBoost * 0.4 + entry.avgScore * 0.6;
      entry.rrfScore = frequencyBoost; // Store frequency as "rrf" for consistency
    }

    const results = Array.from(memoryMap.values());
    results.sort((a, b) => b.score - a.score);

    return results;
  }

  /**
   * Weighted RRF fusion
   * 
   * Weights the original query higher than expanded variants.
   * This respects user intent while still benefiting from recall improvement.
   */
  fuseWithWeightedRRF(
    searchResults: QuerySearchResult[],
    expansion?: QueryExpansionResult,
    config: WeightedFusionConfig = DEFAULT_WEIGHTED_CONFIG,
  ): FusedResult[] {
    const memoryMap = new Map<string, FusedResult>();

    for (const queryResult of searchResults) {
      // Determine weight for this query
      let weight: number = config.ruleVariantWeight;
      
      if (expansion?.sources) {
        const querySource = expansion.sources[queryResult.query];
        switch (querySource) {
          case 'original':
            weight = config.originalWeight;
            break;
          case 'rules':
            weight = config.ruleVariantWeight;
            break;
          case 'llm':
            weight = config.llmVariantWeight;
            break;
        }
      } else if (queryResult.queryIndex === 0) {
        // First query is likely the original
        weight = config.originalWeight;
      }

      for (let rank = 0; rank < queryResult.matches.length; rank++) {
        const match = queryResult.matches[rank];
        const memoryId = match.id;

        let entry = memoryMap.get(memoryId);
        if (!entry) {
          entry = this.createEmptyResult(memoryId, match.metadata);
          memoryMap.set(memoryId, entry);
        }

        // Weighted RRF contribution
        const rrfContribution = weight / (config.baseRRFk + rank + 1);
        entry.rrfScore += rrfContribution;
        entry.queryCount++;
        entry.bestRank = Math.min(entry.bestRank, rank + 1);

        // Update average score
        entry.avgScore = (entry.avgScore * (entry.queryCount - 1) + match.score) / entry.queryCount;

        entry.queryMatches.push({
          queryIndex: queryResult.queryIndex,
          query: queryResult.query,
          rank: rank + 1,
          score: match.score,
        });
      }
    }

    const results = Array.from(memoryMap.values());
    results.sort((a, b) => b.rrfScore - a.rrfScore);

    // Normalize scores
    if (results.length > 0) {
      const maxRRF = results[0].rrfScore;
      for (const result of results) {
        result.score = maxRRF > 0 ? result.rrfScore / maxRRF : 0;
      }
    }

    return results;
  }

  /**
   * Max score fusion
   * 
   * Takes the maximum similarity score across all queries.
   * Preserves original similarity scores but adds multi-query signal.
   */
  fuseWithMaxScore(searchResults: QuerySearchResult[]): FusedResult[] {
    const memoryMap = new Map<string, FusedResult>();

    for (const queryResult of searchResults) {
      for (let rank = 0; rank < queryResult.matches.length; rank++) {
        const match = queryResult.matches[rank];
        const memoryId = match.id;

        let entry = memoryMap.get(memoryId);
        if (!entry) {
          entry = this.createEmptyResult(memoryId, match.metadata);
          entry.avgScore = 0;
          memoryMap.set(memoryId, entry);
        }

        entry.queryCount++;
        entry.avgScore = Math.max(entry.avgScore, match.score);
        entry.bestRank = Math.min(entry.bestRank, rank + 1);

        entry.queryMatches.push({
          queryIndex: queryResult.queryIndex,
          query: queryResult.query,
          rank: rank + 1,
          score: match.score,
        });
      }
    }

    // Use max score as final score, with small boost for multi-query presence
    for (const entry of memoryMap.values()) {
      const multiQueryBoost = Math.min(0.1, entry.queryCount * 0.02);
      entry.score = Math.min(1.0, entry.avgScore + multiQueryBoost);
      entry.rrfScore = entry.avgScore;
    }

    const results = Array.from(memoryMap.values());
    results.sort((a, b) => b.score - a.score);

    return results;
  }

  /**
   * Deduplicate results based on memory ID
   * Already handled in fusion (memoryMap keyed by ID)
   */
  deduplicate(results: FusedResult[]): FusedResult[] {
    // Results are already deduplicated by construction
    return results;
  }

  /**
   * Create empty result entry
   */
  private createEmptyResult(memoryId: string, metadata?: Record<string, any>): FusedResult {
    return {
      memoryId,
      score: 0,
      rrfScore: 0,
      queryCount: 0,
      bestRank: Infinity,
      avgScore: 0,
      metadata,
      queryMatches: [],
    };
  }
}
