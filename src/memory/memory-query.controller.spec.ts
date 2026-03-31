import { MemoryQueryController } from './memory-query.controller';
import { MemoryService } from './memory.service';
import { ContextualRecallService } from './contextual-recall.service';
import { TemporalGapService } from './temporal-gap.service';

describe('MemoryQueryController', () => {
  let controller: MemoryQueryController;
  let memoryService: jest.Mocked<MemoryService>;
  let contextualRecallService: jest.Mocked<ContextualRecallService>;
  let temporalGapService: jest.Mocked<TemporalGapService>;

  const userId = 'user-123';

  beforeEach(() => {
    memoryService = {
      recall: jest.fn(),
      getGraphData: jest.fn(),
      loadContext: jest.fn(),
    } as any;

    contextualRecallService = {
      recall: jest.fn(),
    } as any;

    temporalGapService = {
      detectGaps: jest.fn(),
    } as any;

    const prismaService = {
      user: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;

    const retrievalSignals = {
      logQuery: jest.fn().mockResolvedValue('query-id'),
    } as any;

    controller = new MemoryQueryController(
      memoryService,
      contextualRecallService,
      temporalGapService,
      prismaService,
      retrievalSignals,
    );
  });

  describe('recall', () => {
    it('should search memories', async () => {
      const dto = { query: 'test' } as any;
      const expected = { memories: [], total: 0 };
      memoryService.recall.mockResolvedValue(expected as any);

      const req = { isInstanceKey: false };
      const res = { set: jest.fn() } as any;
      const result = await controller.recall(userId, dto, req, res);

      expect(result).toEqual(expected);
      expect(memoryService.recall).toHaveBeenCalledWith(userId, dto);
    });
  });

  describe('contextualRecall', () => {
    it('should delegate to contextualRecallService', async () => {
      const dto = { messages: [] } as any;
      const expected = { triggered: false, memories: [] };
      contextualRecallService.recall.mockResolvedValue(expected as any);

      const req = { isInstanceKey: false };
      const result = await controller.contextualRecall(userId, dto, req);

      expect(result).toEqual(expected);
    });
  });

  describe('getGraph', () => {
    it('should return graph data with defaults', async () => {
      const expected = { nodes: [], edges: [], entities: [] };
      memoryService.getGraphData.mockResolvedValue(expected as any);

      const mockReq = { user: { id: userId } } as any;
      const result = await controller.getGraph(userId, mockReq);

      expect(memoryService.getGraphData).toHaveBeenCalledWith(
        userId,
        500,
        false,
      );
      expect(result).toEqual(expected);
    });

    it('should parse limit and includeAgent params', async () => {
      memoryService.getGraphData.mockResolvedValue({
        nodes: [],
        edges: [],
        entities: [],
      } as any);

      const mockReq = { user: { id: userId } } as any;
      await controller.getGraph(userId, mockReq, '100', 'true');

      expect(memoryService.getGraphData).toHaveBeenCalledWith(
        userId,
        100,
        true,
      );
    });
  });

  describe('loadContext', () => {
    it('should load context', async () => {
      const dto = { sessionHint: 'test' } as any;
      const expected = { memories: [], summary: '' };
      memoryService.loadContext.mockResolvedValue(expected as any);

      const result = await controller.loadContext(userId, dto);

      expect(result).toEqual(expected);
    });
  });

  describe('detectGaps', () => {
    const mockAgent = { id: 'agent-1', accountId: 'account-1' };

    it('should delegate to temporalGapService with correct params', async () => {
      const expected = {
        topic: 'deployment',
        range: { start: '2026-03-01', end: '2026-03-05' },
        totalMemories: 10,
        averagePerDay: 2,
        gaps: [],
        coverage: 100,
      };
      temporalGapService.detectGaps.mockResolvedValue(expected);

      const dto = {
        topic: 'deployment',
        start: '2026-03-01',
        end: '2026-03-05',
      } as any;
      const result = await controller.detectGaps(mockAgent, dto);

      expect(result).toEqual(expected);
      expect(temporalGapService.detectGaps).toHaveBeenCalledWith(
        'deployment',
        new Date('2026-03-01'),
        new Date('2026-03-05'),
        'agent-1',
      );
    });

    it('should use agent id for tenant isolation', async () => {
      temporalGapService.detectGaps.mockResolvedValue({
        topic: 'test',
        range: { start: '2026-03-01', end: '2026-03-01' },
        totalMemories: 0,
        averagePerDay: 0,
        gaps: [],
        coverage: 0,
      });

      const agent = { id: 'agent-other', accountId: 'account-2' };
      const dto = {
        topic: 'test',
        start: '2026-03-01',
        end: '2026-03-01',
      } as any;
      await controller.detectGaps(agent, dto);

      expect(temporalGapService.detectGaps).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Date),
        expect.any(Date),
        'agent-other',
      );
    });

    it('should return gap detection response', async () => {
      const gapResponse = {
        topic: 'meetings',
        range: { start: '2026-03-01', end: '2026-03-03' },
        totalMemories: 5,
        averagePerDay: 1.67,
        gaps: [
          { date: '2026-03-02', memoryCount: 0, isAbsoluteGap: true },
        ],
        coverage: 66.67,
      };
      temporalGapService.detectGaps.mockResolvedValue(gapResponse);

      const dto = {
        topic: 'meetings',
        start: '2026-03-01',
        end: '2026-03-03',
      } as any;
      const result = await controller.detectGaps(mockAgent, dto);

      expect(result.gaps).toHaveLength(1);
      expect(result.gaps[0].isAbsoluteGap).toBe(true);
      expect(result.coverage).toBe(66.67);
    });
  });
});
