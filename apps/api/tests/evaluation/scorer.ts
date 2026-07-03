/**
 * Engram Memory System - Scoring Functions
 * 
 * Provides automated scoring for memory quality evaluation.
 */

export interface MemorySample {
  id: string;
  raw: string;
  extraction: {
    who: string | null;
    what: string | null;
    when: string | null;
    where: string | null;
    why: string | null;
    how: string | null;
    topics: string[];
  } | null;
  entities: Array<{ name: string; type: string }>;
  linkCount: number;
}

export interface ScenarioResult {
  name: string;
  passed: boolean;
  score: number;
  maxScore: number;
  details: string;
  duration?: number;
}

/**
 * Score 5W1H completion (0-6 points)
 * 1 point for each non-null field
 */
export function score5W1H(sample: MemorySample): number {
  if (!sample.extraction) return 0;
  
  let score = 0;
  if (sample.extraction.who) score++;
  if (sample.extraction.what) score++;
  if (sample.extraction.when) score++;
  if (sample.extraction.where) score++;
  if (sample.extraction.why) score++;
  if (sample.extraction.how) score++;
  
  return score;
}

/**
 * Score entity extraction quality
 * Based on expected entities in raw text vs extracted entities
 */
export function scoreEntityExtraction(sample: MemorySample): number {
  // Extract potential entities from raw text (capitalized words that could be names)
  const potentialEntities = extractPotentialEntities(sample.raw);
  
  if (potentialEntities.length === 0) {
    // No expected entities, so any extraction is considered good
    return sample.entities.length > 0 ? 1 : 0.5;
  }
  
  // Calculate overlap
  const extractedNames = new Set(sample.entities.map(e => e.name.toLowerCase()));
  let matched = 0;
  
  for (const expected of potentialEntities) {
    if (extractedNames.has(expected.toLowerCase())) {
      matched++;
    }
  }
  
  // Precision and recall
  const recall = potentialEntities.length > 0 ? matched / potentialEntities.length : 0;
  const precision = sample.entities.length > 0 ? matched / sample.entities.length : 0;
  
  // F1 score
  if (precision + recall === 0) return 0;
  return 2 * (precision * recall) / (precision + recall);
}

/**
 * Extract potential entities from raw text
 */
function extractPotentialEntities(raw: string): string[] {
  const entities: Set<string> = new Set();
  
  // Look for capitalized words (potential names)
  const pattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
  const matches = raw.match(pattern);
  
  if (matches) {
    const commonWords = new Set([
      'The', 'This', 'That', 'I', 'We', 'They', 'It', 'He', 'She',
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
      'User', 'Assistant', 'None', 'True', 'False',
    ]);
    
    for (const match of matches) {
      if (!commonWords.has(match)) {
        entities.add(match);
      }
    }
  }
  
  return Array.from(entities);
}

/**
 * Score link density (normalized)
 */
export function scoreLinkDensity(sample: MemorySample): number {
  // Normalize to 0-1 scale (assume 3+ links is optimal)
  return Math.min(sample.linkCount / 3, 1);
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same length');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  
  return dotProduct / denominator;
}

/**
 * Score query relevance (0-1)
 * Returns 1 if expected answer is in top-k results
 */
export function scoreQueryRelevance(
  results: Array<{ id: string; score: number }>,
  expectedId: string,
  topK: number = 3,
): number {
  const topResults = results.slice(0, topK);
  const position = topResults.findIndex(r => r.id === expectedId);
  
  if (position === -1) return 0;
  
  // Higher score for earlier positions
  return 1 - (position / topK);
}

/**
 * Calculate aggregate quality score for a memory
 */
export function calculateMemoryQualityScore(sample: MemorySample): {
  overall: number;
  breakdown: {
    fiveW1H: number;
    entities: number;
    links: number;
  };
} {
  const fiveW1H = score5W1H(sample) / 6; // Normalize to 0-1
  const entities = scoreEntityExtraction(sample);
  const links = scoreLinkDensity(sample);
  
  // Weighted average (5W1H is most important)
  const overall = (fiveW1H * 0.5) + (entities * 0.3) + (links * 0.2);
  
  return {
    overall,
    breakdown: {
      fiveW1H,
      entities,
      links,
    },
  };
}

/**
 * Generate summary statistics from an array of scores
 */
export function summarizeScores(scores: number[]): {
  mean: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
} {
  if (scores.length === 0) {
    return { mean: 0, median: 0, min: 0, max: 0, stdDev: 0 };
  }
  
  const sorted = [...scores].sort((a, b) => a - b);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
  const stdDev = Math.sqrt(variance);
  
  return { mean, median, min, max, stdDev };
}
