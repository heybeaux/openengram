import { HttpException, HttpStatus } from '@nestjs/common';
import { MultiQueryController } from './multi-query.controller';
import { MultiQueryService } from './multi-query.service';
import { QueryExpansionService } from './query-expansion.service';
import { ExpansionStrategy } from './dto/multi-query.dto';

// Mock expansion-rules for getRulesInfo
jest.mock('./expansion-rules', () => ({
  SYNONYM_GROUPS: { greeting: ['hi', 'hello'], farewell: ['bye', 'goodbye'] },
  RELATED_CONCEPTS: { memory: ['recall', 'remember'] },
  PATTERN_RULES: [{ pattern: /test/, replacement: 'test' }],
}));
import { HttpException, HttpStatus } from '@nestjs/common';

describe('MultiQueryController', () => {
  let controller: MultiQueryController;
  let multiQueryService: jest.Mocked<MultiQueryService>;
  let expansionService: jest.Mocked<QueryExpansionService>;

  beforeEach(() => {
    jest.clearAllMocks();

    multiQueryService = {
      isEnabled: jest.fn().mockReturnValue(true),
    multiQueryService = {
      isEnabled: jest.fn(),
    } as any;

    expansionService = {
      expand: jest.fn(),
    } as any;

    controller = new MultiQueryController(multiQueryService, expansionService);
  });

  // =========================================================================
  // isEnabled
  // =========================================================================
  describe('isEnabled', () => {
    it('should return enabled true when service is enabled', () => {
      const result = controller.isEnabled();
      expect(result).toEqual({ enabled: true, version: '1.0.0' });
    });

    it('should return enabled false when service is disabled', () => {
      multiQueryService.isEnabled.mockReturnValue(false);
      const result = controller.isEnabled();
      expect(result).toEqual({ enabled: false, version: '1.0.0' });
    });
  });

  // =========================================================================
  // expandQuery
  // =========================================================================
  describe('expandQuery', () => {
    const mockExpansionResult = {
      original: 'test query',
      variants: ['test query', 'test search', 'testing query'],
      sources: ['rules', 'llm'],
      timings: { totalMs: 42 },
      llmUsed: true,
    };

    it('should expand a valid query with defaults', async () => {
      expansionService.expand.mockResolvedValue(mockExpansionResult as any);

      const result = await controller.expandQuery({ query: 'test query' });

      expect(result.original).toBe('test query');
      expect(result.variants).toHaveLength(3);
      expect(result.llmUsed).toBe(true);
      expect(expansionService.expand).toHaveBeenCalledWith('test query', {
        strategy: ExpansionStrategy.HYBRID,
        maxVariants: 7,
      });
    });

    it('should use provided strategy and maxVariants', async () => {
      expansionService.expand.mockResolvedValue(mockExpansionResult as any);

      await controller.expandQuery({
        query: 'hello',
  // ─── isEnabled ───────────────────────────────────────────────────────────────

  describe('isEnabled', () => {
    it('returns enabled:true when service is enabled', () => {
      multiQueryService.isEnabled.mockReturnValue(true);

      const result = controller.isEnabled();

      expect(result).toEqual({ enabled: true, version: '1.0.0' });
    });

    it('returns enabled:false when service is disabled', () => {
      multiQueryService.isEnabled.mockReturnValue(false);

      const result = controller.isEnabled();

      expect(result).toEqual({ enabled: false, version: '1.0.0' });
    });

    it('always returns version 1.0.0', () => {
      multiQueryService.isEnabled.mockReturnValue(true);
      expect(controller.isEnabled().version).toBe('1.0.0');
    });
  });

  // ─── expandQuery ─────────────────────────────────────────────────────────────

  describe('expandQuery', () => {
    const mockExpansionResult = {
      original: 'deploy application',
      variants: ['deploy app', 'release application', 'ship app'],
      sources: ['rules', 'synonyms'],
      timings: { totalMs: 15 },
      llmUsed: false,
    };

    it('calls expansionService.expand with correct args and returns mapped result', async () => {
      expansionService.expand.mockResolvedValue(mockExpansionResult as any);

      const result = await controller.expandQuery({
        query: 'deploy application',
        strategy: ExpansionStrategy.HYBRID,
        maxVariants: 7,
      });

      expect(expansionService.expand).toHaveBeenCalledWith(
        'deploy application',
        expect.objectContaining({
          strategy: ExpansionStrategy.HYBRID,
          maxVariants: 7,
        }),
      );
      expect(result).toEqual({
        original: 'deploy application',
        variants: ['deploy app', 'release application', 'ship app'],
        sources: ['rules', 'synonyms'],
        timings: { totalMs: 15 },
        llmUsed: false,
      });
    });

    it('uses HYBRID strategy and 7 maxVariants as defaults', async () => {
      expansionService.expand.mockResolvedValue(mockExpansionResult as any);

      await controller.expandQuery({ query: 'test query' });

      expect(expansionService.expand).toHaveBeenCalledWith(
        'test query',
        expect.objectContaining({
          strategy: ExpansionStrategy.HYBRID,
          maxVariants: 7,
        }),
      );
    });

    it('throws 400 when query is empty string', async () => {
      await expect(
        controller.expandQuery({ query: '' }),
      ).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        message: 'Query is required',
      });
    });

    it('throws 400 when query is whitespace only', async () => {
      await expect(
        controller.expandQuery({ query: '   ' }),
      ).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
    });

    it('throws 500 with error message when expand throws Error', async () => {
      expansionService.expand.mockRejectedValue(
        new Error('LLM timeout'),
      );

      await expect(
        controller.expandQuery({ query: 'test' }),
      ).rejects.toMatchObject({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'LLM timeout',
      });
    });

    it('throws 500 with generic message for non-Error exceptions', async () => {
      expansionService.expand.mockRejectedValue('string error');

      await expect(
        controller.expandQuery({ query: 'test' }),
      ).rejects.toMatchObject({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to expand query',
      });
    });

    it('passes custom strategy to expansion service', async () => {
      expansionService.expand.mockResolvedValue(mockExpansionResult as any);

      await controller.expandQuery({
        query: 'test',
        strategy: ExpansionStrategy.RULES,
        maxVariants: 3,
      });

      expect(expansionService.expand).toHaveBeenCalledWith('hello', {
        strategy: ExpansionStrategy.RULES,
        maxVariants: 3,
      });
    });

    it('should throw BAD_REQUEST when query is empty string', async () => {
      await expect(controller.expandQuery({ query: '' })).rejects.toThrow(
        new HttpException('Query is required', HttpStatus.BAD_REQUEST),
      );
    });

    it('should throw BAD_REQUEST when query is whitespace only', async () => {
      await expect(controller.expandQuery({ query: '   ' })).rejects.toThrow(
        new HttpException('Query is required', HttpStatus.BAD_REQUEST),
      );
    });

    it('should throw INTERNAL_SERVER_ERROR when expansion fails with Error', async () => {
      expansionService.expand.mockRejectedValue(new Error('LLM timeout'));

      await expect(
        controller.expandQuery({ query: 'valid query' }),
      ).rejects.toThrow(
        new HttpException('LLM timeout', HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });

    it('should throw generic message when expansion fails with non-Error', async () => {
      expansionService.expand.mockRejectedValue('unknown error');

      await expect(
        controller.expandQuery({ query: 'valid query' }),
      ).rejects.toThrow(
        new HttpException(
          'Failed to expand query',
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
      expect(expansionService.expand).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          strategy: ExpansionStrategy.RULES,
          maxVariants: 3,
        }),
      );
    });
  });

  // =========================================================================
  // getRulesInfo
  // =========================================================================
  describe('getRulesInfo', () => {
    it('should return counts of expansion rules', () => {
      const result = controller.getRulesInfo();
      expect(result.synonymGroups).toBe(2);
      expect(result.relatedConcepts).toBe(1);
      expect(result.patternRules).toBe(1);
      expect(result.strategies).toEqual(Object.values(ExpansionStrategy));
    });
  });

  // =========================================================================
  // testExpansion
  // =========================================================================
  describe('testExpansion', () => {
    it('should throw BAD_REQUEST when query is empty', async () => {
      await expect(controller.testExpansion({ query: '' })).rejects.toThrow(
        HttpException,
      );
    });

    it('should throw BAD_REQUEST when query is whitespace', async () => {
      await expect(controller.testExpansion({ query: '  ' })).rejects.toThrow(
        HttpException,
      );
    });

    it('should test all strategies and return results', async () => {
      expansionService.expand.mockResolvedValue({
        original: 'test',
        variants: ['test', 'testing'],
        sources: ['rules'],
        timings: { totalMs: 10 },
        llmUsed: false,
      } as any);

      const result = await controller.testExpansion({ query: 'test' });

      expect(result.query).toBe('test');
      const strategies = Object.values(ExpansionStrategy);
      for (const strategy of strategies) {
        expect(result.results[strategy]).toBeDefined();
        expect(result.results[strategy].variants).toEqual(['test', 'testing']);
        expect(result.results[strategy].count).toBe(2);
        expect(result.results[strategy].timeMs).toBe(10);
      }
    });

    it('should handle individual strategy failures gracefully', async () => {
      let callCount = 0;
      expansionService.expand.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('LLM failed');
        }
        return {
          original: 'q',
          variants: ['q', 'query'],
          sources: ['rules'],
          timings: { totalMs: 5 },
          llmUsed: false,
        } as any;
      });

      const result = await controller.testExpansion({ query: 'q' });

      // First strategy should have fallback
      const strategies = Object.values(ExpansionStrategy);
      expect(result.results[strategies[0]].variants).toEqual(['q']);
      expect(result.results[strategies[0]].count).toBe(1);
      expect(result.results[strategies[0]].llmUsed).toBe(false);
  // ─── getRulesInfo ────────────────────────────────────────────────────────────

  describe('getRulesInfo', () => {
    it('returns an object with expected numeric fields and strategies array', () => {
      const result = controller.getRulesInfo();

      expect(result).toMatchObject({
        synonymGroups: expect.any(Number),
        relatedConcepts: expect.any(Number),
        patternRules: expect.any(Number),
        strategies: expect.any(Array),
      });
    });

    it('includes all ExpansionStrategy values', () => {
      const result = controller.getRulesInfo();
      const allStrategies = Object.values(ExpansionStrategy);

      for (const strategy of allStrategies) {
        expect(result.strategies).toContain(strategy);
      }
    });

    it('returns non-negative counts', () => {
      const result = controller.getRulesInfo();

      expect(result.synonymGroups).toBeGreaterThanOrEqual(0);
      expect(result.relatedConcepts).toBeGreaterThanOrEqual(0);
      expect(result.patternRules).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── testExpansion ───────────────────────────────────────────────────────────

  describe('testExpansion', () => {
    const mockResult = (variants: string[]) => ({
      original: 'test',
      variants,
      sources: [],
      timings: { totalMs: 10 },
      llmUsed: false,
    });

    it('throws 400 for empty query', async () => {
      await expect(
        controller.testExpansion({ query: '' }),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });

    it('throws 400 for whitespace-only query', async () => {
      await expect(
        controller.testExpansion({ query: '  ' }),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });

    it('calls expand for each ExpansionStrategy', async () => {
      expansionService.expand.mockResolvedValue(mockResult(['v1', 'v2']) as any);

      await controller.testExpansion({ query: 'deploy' });

      const strategies = Object.values(ExpansionStrategy);
      expect(expansionService.expand).toHaveBeenCalledTimes(strategies.length);

      for (const strategy of strategies) {
        expect(expansionService.expand).toHaveBeenCalledWith(
          'deploy',
          expect.objectContaining({ strategy }),
        );
      }
    });

    it('returns results keyed by strategy', async () => {
      expansionService.expand.mockResolvedValue(
        mockResult(['variant1']) as any,
      );

      const result = await controller.testExpansion({ query: 'test query' });

      expect(result.query).toBe('test query');
      const strategies = Object.values(ExpansionStrategy);
      for (const strategy of strategies) {
        expect(result.results[strategy]).toBeDefined();
        expect(result.results[strategy].variants).toEqual(['variant1']);
        expect(result.results[strategy].count).toBe(1);
      }
    });

    it('falls back to original query when a strategy fails', async () => {
      // First strategy throws, rest succeed
      expansionService.expand
        .mockRejectedValueOnce(new Error('LLM timeout'))
        .mockResolvedValue(mockResult(['v']) as any);

      const result = await controller.testExpansion({ query: 'test' });

      // Should not throw — fallen-back strategy gets original query
      const strategies = Object.values(ExpansionStrategy);
      const firstStrategy = strategies[0];
      expect(result.results[firstStrategy].variants).toEqual(['test']);
      expect(result.results[firstStrategy].count).toBe(1);
      expect(result.results[firstStrategy].timeMs).toBe(0);
      expect(result.results[firstStrategy].llmUsed).toBe(false);
    });

    it('maps timing and llmUsed from expansion result', async () => {
      expansionService.expand.mockResolvedValue({
        original: 'q',
        variants: ['a', 'b', 'c'],
        sources: [],
        timings: { totalMs: 42 },
        llmUsed: true,
      } as any);

      const result = await controller.testExpansion({ query: 'q' });

      const firstStrategy = Object.values(ExpansionStrategy)[0];
      expect(result.results[firstStrategy].timeMs).toBe(42);
      expect(result.results[firstStrategy].llmUsed).toBe(true);
      expect(result.results[firstStrategy].count).toBe(3);
    });
  });
});
