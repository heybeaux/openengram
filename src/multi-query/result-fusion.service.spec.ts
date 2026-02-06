import { Test, TestingModule } from '@nestjs/testing';
import { ResultFusionService, QuerySearchResult, FusedResult } from './result-fusion.service';
import { FusionStrategy } from './dto/multi-query.dto';
import { QueryExpansionResult } from './query-expansion.service';

describe('ResultFusionService', () => {
  let service: ResultFusionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ResultFusionService],
    }).compile();

    service = module.get<ResultFusionService>(ResultFusionService);
  });

  // Helper to create mock search results
  const createSearchResults = (data: Array<{
    query: string;
    queryIndex: number;
    matches: Array<{ id: string; score: number }>;
  }>): QuerySearchResult[] => {
    return data.map(d => ({
      query: d.query,
      queryIndex: d.queryIndex,
      matches: d.matches.map(m => ({ id: m.id, score: m.score })),
      searchTimeMs: 50,
    }));
  };

  describe('fuse', () => {
    it('should route to correct strategy', () => {
      const searchResults = createSearchResults([
        { query: 'q1', queryIndex: 0, matches: [{ id: 'A', score: 0.9 }] },
      ]);

      // Should not throw for any strategy
      expect(() => service.fuse(searchResults, FusionStrategy.RRF)).not.toThrow();
      expect(() => service.fuse(searchResults, FusionStrategy.FREQUENCY)).not.toThrow();
      expect(() => service.fuse(searchResults, FusionStrategy.WEIGHTED)).not.toThrow();
      expect(() => service.fuse(searchResults, FusionStrategy.MAX_SCORE)).not.toThrow();
    });
  });

  describe('fuseWithRRF', () => {
    it('should rank memory appearing in both queries higher', () => {
      const searchResults = createSearchResults([
        { query: 'q1', queryIndex: 0, matches: [
          { id: 'A', score: 0.9 },
          { id: 'B', score: 0.8 },
          { id: 'C', score: 0.7 },
        ]},
        { query: 'q2', queryIndex: 1, matches: [
          { id: 'B', score: 0.95 },
          { id: 'A', score: 0.85 },
          { id: 'D', score: 0.75 },
        ]},
      ]);

      const results = service.fuseWithRRF(searchResults);

      // A and B appear in both, should be top 2
      const topIds = results.slice(0, 2).map(r => r.memoryId);
      expect(topIds).toContain('A');
      expect(topIds).toContain('B');
    });

    it('should calculate correct RRF scores', () => {
      const searchResults = createSearchResults([
        { query: 'q1', queryIndex: 0, matches: [
          { id: 'A', score: 0.9 },  // rank 1
          { id: 'B', score: 0.8 },  // rank 2
        ]},
        { query: 'q2', queryIndex: 1, matches: [
          { id: 'A', score: 0.85 }, // rank 1
        ]},
      ]);

      const results = service.fuseWithRRF(searchResults, { k: 60, normalizeScores: false, minQueries: 1 });

      const memA = results.find(r => r.memoryId === 'A');
      // A is rank 1 in both queries
      // RRF = 1/(60+1) + 1/(60+1) = 0.0164 + 0.0164 = 0.0328
      expect(memA).toBeDefined();
      expect(memA!.rrfScore).toBeCloseTo(0.0328, 3);
    });

    it('should respect minQueries filter', () => {
      const searchResults = createSearchResults([
        { query: 'q1', queryIndex: 0, matches: [
          { id: 'A', score: 0.9 },
          { id: 'B', score: 0.8 },
        ]},
        { query: 'q2', queryIndex: 1, matches: [
          { id: 'A', score: 0.85 },
          { id: 'C', score: 0.75 },
        ]},
      ]);

      const results = service.fuseWithRRF(searchResults, { k: 60, normalizeScores: true, minQueries: 2 });

      // Only A appears in both queries
      expect(results.length).toBe(1);
      expect(results[0].memoryId).toBe('A');
    });

    it('should normalize scores when requested', () => {
      const searchResults = createSearchResults([
        { query: 'q1', queryIndex: 0, matches: [
          { id: 'A', score: 0.9 },
          { id: 'B', score: 0.8 },
        ]},
      ]);

      const results = service.fuseWithRRF(searchResults, { k: 60, normalizeScores: true, minQueries: 1 });

      // Top result should have score 1.0 after normalization
      expect(results[0].score).toBeCloseTo(1.0, 5);
    });

    it('should track query matches correctly', () => {
      const searchResults = createSearchResults([
        { query: 'query 1', queryIndex: 0, matches: [{ id: 'A', score: 0.9 }] },
        { query: 'query 2', queryIndex: 1, matches: [{ id: 'A', score: 0.85 }] },
      ]);

      const results = service.fuseWithRRF(searchResults);
      const memA = results.find(r => r.memoryId === 'A');

      expect(memA).toBeDefined();
      expect(memA!.queryCount).toBe(2);
      expect(memA!.queryMatches.length).toBe(2);
      expect(memA!.queryMatches[0].query).toBe('query 1');
      expect(memA!.queryMatches[1].query).toBe('query 2');
    });

    it('should calculate bestRank correctly', () => {
      const searchResults = createSearchResults([
        { query: 'q1', queryIndex: 0, matches: [
          { id: 'A', score: 0.9 },  // rank 1
          { id: 'B', score: 0.8 },  // rank 2
        ]},
        { query: 'q2', queryIndex: 1, matches: [
          { id: 'B', score: 0.95 }, // rank 1
          { id: 'A', score: 0.85 }, // rank 2
        ]},
      ]);

      const results = service.fuseWithRRF(searchResults);
      const memA = results.find(r => r.memoryId === 'A');
      const memB = results.find(r => r.memoryId === 'B');

      expect(memA!.bestRank).toBe(1);  // Rank 1 in q1
      expect(memB!.bestRank).toBe(1);  // Rank 1 in q2
    });

    it('should handle empty results gracefully', () => {
      const searchResults = createSearchResults([
        { query: 'q1', queryIndex: 0, matches: [] },
        { query: 'q2', queryIndex: 1, matches: [] },
      ]);

      const results = service.fuseWithRRF(searchResults);
      expect(results).toEqual([]);
    });

    it('should handle single query', () => {
      const searchResults = createSearchResults([
        { query: 'q1', queryIndex: 0, matches: [
          { id: 'A', score: 0.9 },
          { id: 'B', score: 0.8 },
        ]},
      ]);

      const results = service.fuseWithRRF(searchResults);
      expect(results.length).toBe(2);
      expect(results[0].memoryId).toBe('A');
    });
  });

  describe('fuseWithFrequency', () => {
    it('should boost memories appearing in more queries', () => {
      const searchResults = createSearchResults([
        { query: 'q1', queryIndex: 0, matches: [
          { id: 'A', score: 0.7 },
          { id: 'B', score: 0.9 },
        ]},
        { query: 'q2', queryIndex: 1, matches: [
          { id: 'A', score: 0.75 },
          { id: 'C', score: 0.95 },
        ]},
        { query: 'q3', queryIndex: 2, matches: [
          { id: 'A', score: 0.72 },
        ]},
      ]);

      const results = service.fuseWithFrequency(searchResults);
      const memA = results.find(r => r.memoryId === 'A');

      expect(memA).toBeDefined();
      expect(memA!.queryCount).toBe(3);
      // A appears in all 3 queries, should be ranked higher despite lower individual scores
    });

    it('should blend frequency with max score', () => {
      const searchResults = createSearchResults([
        { query: 'q1', queryIndex: 0, matches: [
          { id: 'A', score: 0.5 },  // Low score
        ]},
        { query: 'q2', queryIndex: 1, matches: [
          { id: 'B', score: 0.99 }, // Very high score, but only in one query
        ]},
      ]);

      const results = service.fuseWithFrequency(searchResults);

      // Both should be present
      expect(results.length).toBe(2);
    });

    it('should track average/max score correctly', () => {
      const searchResults = createSearchResults([
        { query: 'q1', queryIndex: 0, matches: [{ id: 'A', score: 0.8 }] },
        { query: 'q2', queryIndex: 1, matches: [{ id: 'A', score: 0.9 }] },
      ]);

      const results = service.fuseWithFrequency(searchResults);
      const memA = results.find(r => r.memoryId === 'A');

      expect(memA!.avgScore).toBe(0.9);  // Max score in frequency fusion
    });
  });

  describe('fuseWithWeightedRRF', () => {
    it('should weight original query higher', () => {
      const searchResults = createSearchResults([
        { query: 'original query', queryIndex: 0, matches: [
          { id: 'A', score: 0.9 },
        ]},
        { query: 'rule variant', queryIndex: 1, matches: [
          { id: 'B', score: 0.9 },
        ]},
      ]);

      const expansion: QueryExpansionResult = {
        original: 'original query',
        variants: ['original query', 'rule variant'],
        sources: {
          'original query': 'original',
          'rule variant': 'rules',
        },
        timings: { rulesMs: 5, llmMs: 0, totalMs: 5 },
        llmUsed: false,
      };

      const results = service.fuseWithWeightedRRF(searchResults, expansion, {
        originalWeight: 2.0,
        ruleVariantWeight: 1.0,
        llmVariantWeight: 0.8,
        baseRRFk: 60,
      });

      const memA = results.find(r => r.memoryId === 'A');
      const memB = results.find(r => r.memoryId === 'B');

      // A should have higher RRF score because original is weighted 2x
      expect(memA!.rrfScore).toBeGreaterThan(memB!.rrfScore);
    });

    it('should handle LLM variants with lower weight', () => {
      const searchResults = createSearchResults([
        { query: 'llm variant', queryIndex: 0, matches: [
          { id: 'A', score: 0.9 },
        ]},
        { query: 'rule variant', queryIndex: 1, matches: [
          { id: 'B', score: 0.9 },
        ]},
      ]);

      const expansion: QueryExpansionResult = {
        original: 'original',
        variants: ['original', 'llm variant', 'rule variant'],
        sources: {
          'original': 'original',
          'llm variant': 'llm',
          'rule variant': 'rules',
        },
        timings: { rulesMs: 5, llmMs: 100, totalMs: 105 },
        llmUsed: true,
      };

      const results = service.fuseWithWeightedRRF(searchResults, expansion, {
        originalWeight: 2.0,
        ruleVariantWeight: 1.0,
        llmVariantWeight: 0.8,
        baseRRFk: 60,
      });

      const memA = results.find(r => r.memoryId === 'A'); // From LLM (0.8 weight)
      const memB = results.find(r => r.memoryId === 'B'); // From rules (1.0 weight)

      // B should have higher score due to higher rule weight
      expect(memB!.rrfScore).toBeGreaterThan(memA!.rrfScore);
    });

    it('should fall back to index-based weighting without expansion', () => {
      const searchResults = createSearchResults([
        { query: 'q1', queryIndex: 0, matches: [{ id: 'A', score: 0.9 }] },
        { query: 'q2', queryIndex: 1, matches: [{ id: 'B', score: 0.9 }] },
      ]);

      const results = service.fuseWithWeightedRRF(searchResults, undefined, {
        originalWeight: 2.0,
        ruleVariantWeight: 1.0,
        llmVariantWeight: 0.8,
        baseRRFk: 60,
      });

      const memA = results.find(r => r.memoryId === 'A');
      const memB = results.find(r => r.memoryId === 'B');

      // A should have higher score (queryIndex 0 treated as original)
      expect(memA!.rrfScore).toBeGreaterThan(memB!.rrfScore);
    });
  });

  describe('fuseWithMaxScore', () => {
    it('should use maximum similarity score', () => {
      const searchResults = createSearchResults([
        { query: 'q1', queryIndex: 0, matches: [
          { id: 'A', score: 0.7 },
        ]},
        { query: 'q2', queryIndex: 1, matches: [
          { id: 'A', score: 0.95 },
        ]},
      ]);

      const results = service.fuseWithMaxScore(searchResults);
      const memA = results.find(r => r.memoryId === 'A');

      expect(memA!.avgScore).toBe(0.95);  // Max score
    });

    it('should add small multi-query boost', () => {
      const searchResults = createSearchResults([
        { query: 'q1', queryIndex: 0, matches: [{ id: 'A', score: 0.9 }] },
        { query: 'q2', queryIndex: 1, matches: [{ id: 'A', score: 0.9 }] },
        { query: 'q3', queryIndex: 2, matches: [{ id: 'B', score: 0.9 }] },
      ]);

      const results = service.fuseWithMaxScore(searchResults);
      const memA = results.find(r => r.memoryId === 'A');
      const memB = results.find(r => r.memoryId === 'B');

      // A appears in 2 queries, B in 1
      // A should have slightly higher score due to multi-query boost
      expect(memA!.score).toBeGreaterThan(memB!.score);
    });

    it('should cap score at 1.0', () => {
      const searchResults = createSearchResults([
        { query: 'q1', queryIndex: 0, matches: [{ id: 'A', score: 0.99 }] },
        { query: 'q2', queryIndex: 1, matches: [{ id: 'A', score: 0.99 }] },
        { query: 'q3', queryIndex: 2, matches: [{ id: 'A', score: 0.99 }] },
        { query: 'q4', queryIndex: 3, matches: [{ id: 'A', score: 0.99 }] },
        { query: 'q5', queryIndex: 4, matches: [{ id: 'A', score: 0.99 }] },
      ]);

      const results = service.fuseWithMaxScore(searchResults);
      const memA = results.find(r => r.memoryId === 'A');

      expect(memA!.score).toBeLessThanOrEqual(1.0);
    });
  });

  describe('deduplicate', () => {
    it('should return results as-is (already deduplicated by construction)', () => {
      const results: FusedResult[] = [
        {
          memoryId: 'A',
          score: 0.9,
          rrfScore: 0.05,
          queryCount: 2,
          bestRank: 1,
          avgScore: 0.85,
          queryMatches: [],
        },
        {
          memoryId: 'B',
          score: 0.8,
          rrfScore: 0.04,
          queryCount: 1,
          bestRank: 2,
          avgScore: 0.8,
          queryMatches: [],
        },
      ];

      const deduplicated = service.deduplicate(results);
      expect(deduplicated).toEqual(results);
    });
  });
});
