import { MultiQueryController } from './multi-query.controller';
import { MultiQueryService } from './multi-query.service';
import { QueryExpansionService } from './query-expansion.service';
import { ExpansionStrategy } from './dto/multi-query.dto';
import { HttpException, HttpStatus } from '@nestjs/common';

describe('MultiQueryController', () => {
  let controller: MultiQueryController;
  let multiQueryService: jest.Mocked<MultiQueryService>;
  let expansionService: jest.Mocked<QueryExpansionService>;

  beforeEach(() => {
    multiQueryService = {
      isEnabled: jest.fn(),
    } as any;

    expansionService = {
      expand: jest.fn(),
    } as any;

    controller = new MultiQueryController(multiQueryService, expansionService);
  });

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

      expect(expansionService.expand).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          strategy: ExpansionStrategy.RULES,
          maxVariants: 3,
        }),
      );
    });
  });

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
