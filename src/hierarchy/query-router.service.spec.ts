import { Test, TestingModule } from '@nestjs/testing';
import { QueryRouterService, HierarchyLevel, QueryAnalysis } from './query-router.service';

describe('QueryRouterService', () => {
  let service: QueryRouterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [QueryRouterService],
    }).compile();

    service = module.get<QueryRouterService>(QueryRouterService);
  });

  describe('analyze', () => {
    describe('L0 (Sentence) routing', () => {
      it('should route exact/specific queries to L0', () => {
        const queries = [
          'What is the exact error code?',
          'Give me the specific command',
          'What precisely did they say?',
          'Quote what was mentioned',
        ];

        queries.forEach(query => {
          const result = service.analyze(query);
          expect(result.suggestedLevels).toContain('L0');
        });
      });

      it('should route technical specifics to L0', () => {
        const queries = [
          'What is the API endpoint?',
          'What command should I run?',
          'What is the syntax for that?',
          'What error code did you see?',
        ];

        queries.forEach(query => {
          const result = service.analyze(query);
          expect(result.suggestedLevels).toContain('L0');
        });
      });

      it('should route quote requests to L0', () => {
        const queries = [
          'What did Beaux say about that?',
          'What was mentioned in the meeting?',
          'What did they tell you?',
        ];

        queries.forEach(query => {
          const result = service.analyze(query);
          expect(result.suggestedLevels).toContain('L0');
        });
      });
    });

    describe('L1 (Paragraph) routing', () => {
      it('should route explanation queries to L1', () => {
        const queries = [
          'Explain how the system works',
          'Why did we choose that approach?',
          'What is the reasoning behind this?',
        ];

        queries.forEach(query => {
          const result = service.analyze(query);
          expect(result.suggestedLevels).toContain('L1');
        });
      });

      it('should route comparison queries to L1', () => {
        const queries = [
          'What is the difference between A and B?',
          'Compare the two approaches',
          'How does X relate to Y?',
        ];

        queries.forEach(query => {
          const result = service.analyze(query);
          expect(result.suggestedLevels).toContain('L1');
        });
      });

      it('should route process/steps queries to L1', () => {
        const queries = [
          'What are the steps to deploy?',
          'How to configure the system?',
          'What is the process for review?',
        ];

        queries.forEach(query => {
          const result = service.analyze(query);
          expect(result.suggestedLevels).toContain('L1');
        });
      });
    });

    describe('default routing', () => {
      it('should return L0 and L1 for generic queries', () => {
        const queries = [
          'memories about coffee',
          'project status',
          'deployment notes',
        ];

        queries.forEach(query => {
          const result = service.analyze(query);
          expect(result.suggestedLevels).toContain('L0');
          expect(result.suggestedLevels).toContain('L1');
        });
      });

      it('should have lower confidence for unmatched queries', () => {
        const result = service.analyze('random generic query');
        expect(result.confidence).toBeLessThanOrEqual(0.6);
      });
    });

    describe('result structure', () => {
      it('should return proper QueryAnalysis structure', () => {
        const result = service.analyze('test query');

        expect(result).toHaveProperty('query');
        expect(result).toHaveProperty('suggestedLevels');
        expect(result).toHaveProperty('confidence');
        expect(result).toHaveProperty('reasoning');
        
        expect(result.query).toBe('test query');
        expect(Array.isArray(result.suggestedLevels)).toBe(true);
        expect(typeof result.confidence).toBe('number');
        expect(typeof result.reasoning).toBe('string');
      });

      it('should have confidence between 0 and 1', () => {
        const testQueries = [
          'exact quote',
          'explain why',
          'random query',
          'what is the specific error code?',
        ];

        testQueries.forEach(query => {
          const result = service.analyze(query);
          expect(result.confidence).toBeGreaterThanOrEqual(0);
          expect(result.confidence).toBeLessThanOrEqual(1);
        });
      });

      it('should only suggest MVP levels (L0, L1)', () => {
        // Even queries that suggest L2/L3 should be filtered to L0/L1 in MVP
        const queries = [
          'what did we discuss in that meeting', // L2 indicator
          'what does Beaux usually prefer', // L3 indicator
        ];

        queries.forEach(query => {
          const result = service.analyze(query);
          result.suggestedLevels.forEach(level => {
            expect(['L0', 'L1']).toContain(level);
          });
        });
      });
    });
  });

  describe('getDefaultLevels', () => {
    it('should return L0 for precise mode', () => {
      const levels = service.getDefaultLevels('precise');
      expect(levels).toEqual(['L0']);
    });

    it('should return L0 and L1 for balanced mode', () => {
      const levels = service.getDefaultLevels('balanced');
      expect(levels).toContain('L0');
      expect(levels).toContain('L1');
    });

    it('should return L0 and L1 for broad mode (MVP)', () => {
      const levels = service.getDefaultLevels('broad');
      expect(levels).toContain('L0');
      expect(levels).toContain('L1');
    });
  });

  describe('getLevelWeights', () => {
    it('should return weights for factual queries', () => {
      const weights = service.getLevelWeights('factual');
      expect(weights.L0).toBeGreaterThan(weights.L1);
      expect(weights.L0).toBeGreaterThan(weights.L3);
    });

    it('should return weights for contextual queries', () => {
      const weights = service.getLevelWeights('contextual');
      expect(weights.L1).toBeGreaterThan(weights.L0);
    });

    it('should return equal weights for balanced queries', () => {
      const weights = service.getLevelWeights('balanced');
      expect(weights.L0).toBe(weights.L1);
    });

    it('should return all level weights', () => {
      const weights = service.getLevelWeights('balanced');
      expect(weights).toHaveProperty('L0');
      expect(weights).toHaveProperty('L1');
      expect(weights).toHaveProperty('L2');
      expect(weights).toHaveProperty('L3');
    });
  });

  describe('edge cases', () => {
    it('should handle empty query', () => {
      const result = service.analyze('');
      expect(result.suggestedLevels.length).toBeGreaterThan(0);
    });

    it('should handle query with only punctuation', () => {
      const result = service.analyze('???');
      expect(result.suggestedLevels.length).toBeGreaterThan(0);
    });

    it('should handle very long query', () => {
      const longQuery = 'What is the '.repeat(100) + 'answer?';
      const result = service.analyze(longQuery);
      expect(result.suggestedLevels.length).toBeGreaterThan(0);
    });

    it('should handle query with multiple level indicators', () => {
      const query = 'What exactly did we discuss in the meeting about our usual preferences?';
      const result = service.analyze(query);
      // Should find multiple indicators and include multiple levels
      expect(result.suggestedLevels.length).toBeGreaterThanOrEqual(1);
    });
  });
});
