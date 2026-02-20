import {
  BehavioralConsistencyService,
  InconsistencyType,
} from './behavioral-consistency.service';

describe('HEY-175: Behavioral Consistency Detection', () => {
  let service: BehavioralConsistencyService;
  let mockPrisma: any;
  let mockLlm: any;

  beforeEach(() => {
    mockPrisma = {
      memory: {
        findMany: jest.fn(),
      },
    };
    mockLlm = {
      chat: jest.fn(),
    };
    service = new BehavioralConsistencyService(mockPrisma, mockLlm);
  });

  describe('check', () => {
    it('should return empty when insufficient recent memories', async () => {
      mockPrisma.memory.findMany.mockResolvedValueOnce([]); // recent

      const result = await service.check('user-1');
      expect(result.inconsistencies).toHaveLength(0);
      expect(result.memoriesAnalyzed).toBe(0);
      expect(result.llmCallsUsed).toBe(0);
    });

    it('should return empty when insufficient historical memories', async () => {
      const recentMemories = Array.from({ length: 5 }, (_, i) => ({
        id: `recent-${i}`,
        raw: `Recent memory ${i}`,
        layer: 'SESSION',
        source: 'EXPLICIT_STATEMENT',
        createdAt: new Date(),
        agentId: null,
        memoryType: null,
      }));
      mockPrisma.memory.findMany
        .mockResolvedValueOnce(recentMemories) // recent
        .mockResolvedValueOnce([]); // historical

      const result = await service.check('user-1');
      expect(result.inconsistencies).toHaveLength(0);
      expect(result.llmCallsUsed).toBe(0);
    });

    it('should detect layer distribution shift via heuristics', async () => {
      const recentMemories = Array.from({ length: 10 }, (_, i) => ({
        id: `recent-${i}`,
        raw: `Recent memory ${i} with some content`,
        layer: 'INSIGHT', // all INSIGHT = shifted
        source: 'PATTERN_DETECTED',
        createdAt: new Date(),
        agentId: null,
        memoryType: null,
      }));
      const historicalMemories = Array.from({ length: 20 }, (_, i) => ({
        id: `hist-${i}`,
        raw: `Historical memory ${i} with content`,
        layer: 'SESSION', // all SESSION = baseline
        source: 'EXPLICIT_STATEMENT',
        createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        agentId: null,
        memoryType: null,
      }));

      mockPrisma.memory.findMany
        .mockResolvedValueOnce(recentMemories)
        .mockResolvedValueOnce(historicalMemories);

      // Skip LLM by setting maxLlmCalls=0
      const result = await service.check('user-1', { maxLlmCalls: 0 });

      expect(result.inconsistencies.length).toBeGreaterThan(0);
      const layerShift = result.inconsistencies.find(
        (i) => i.type === InconsistencyType.PATTERN_BREAK,
      );
      expect(layerShift).toBeDefined();
      expect(layerShift!.confidence).toBeGreaterThan(0);
    });

    it('should detect content length shift as tone change', async () => {
      const recentMemories = Array.from({ length: 10 }, (_, i) => ({
        id: `recent-${i}`,
        raw: 'x'.repeat(500), // long
        layer: 'SESSION',
        source: 'EXPLICIT_STATEMENT',
        createdAt: new Date(),
        agentId: null,
        memoryType: null,
      }));
      const historicalMemories = Array.from({ length: 20 }, (_, i) => ({
        id: `hist-${i}`,
        raw: 'short', // short
        layer: 'SESSION',
        source: 'EXPLICIT_STATEMENT',
        createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        agentId: null,
        memoryType: null,
      }));

      mockPrisma.memory.findMany
        .mockResolvedValueOnce(recentMemories)
        .mockResolvedValueOnce(historicalMemories);

      const result = await service.check('user-1', { maxLlmCalls: 0 });

      const toneShift = result.inconsistencies.find(
        (i) => i.type === InconsistencyType.TONE_SHIFT,
      );
      expect(toneShift).toBeDefined();
    });

    it('should call LLM for deep analysis when budget allows', async () => {
      const makeMemories = (prefix: string, count: number, daysAgo: number) =>
        Array.from({ length: count }, (_, i) => ({
          id: `${prefix}-${i}`,
          raw: `${prefix} memory ${i} with some content text`,
          layer: 'SESSION',
          source: 'EXPLICIT_STATEMENT',
          createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
          agentId: null,
          memoryType: null,
        }));

      mockPrisma.memory.findMany
        .mockResolvedValueOnce(makeMemories('recent', 10, 0))
        .mockResolvedValueOnce(makeMemories('hist', 20, 7));

      mockLlm.chat.mockResolvedValue({
        content: JSON.stringify({
          inconsistencies: [
            {
              type: 'contradictory_decision',
              description: 'Agent said X before but now says Y',
              confidence: 0.7,
              severity: 'medium',
              suggestion: 'Review recent context changes',
            },
          ],
        }),
      });

      const result = await service.check('user-1', { maxLlmCalls: 1 });
      expect(result.llmCallsUsed).toBe(1);
      expect(mockLlm.chat).toHaveBeenCalledTimes(1);

      const llmInconsistency = result.inconsistencies.find(
        (i) => i.type === InconsistencyType.CONTRADICTORY_DECISION,
      );
      expect(llmInconsistency).toBeDefined();
      expect(llmInconsistency!.confidence).toBe(0.7);
    });

    it('should handle LLM failure gracefully', async () => {
      const makeMemories = (prefix: string, count: number, daysAgo: number) =>
        Array.from({ length: count }, (_, i) => ({
          id: `${prefix}-${i}`,
          raw: `${prefix} memory ${i} content`,
          layer: 'SESSION',
          source: 'EXPLICIT_STATEMENT',
          createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
          agentId: null,
          memoryType: null,
        }));

      mockPrisma.memory.findMany
        .mockResolvedValueOnce(makeMemories('recent', 10, 0))
        .mockResolvedValueOnce(makeMemories('hist', 20, 7));

      mockLlm.chat.mockRejectedValue(new Error('LLM timeout'));

      const result = await service.check('user-1', { maxLlmCalls: 1 });
      // Should not throw, just return heuristic results
      expect(result.llmCallsUsed).toBe(0);
    });

    it('should filter by agentId when provided', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([]);

      await service.check('user-1', { agentId: 'agent-1' });

      expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ agentId: 'agent-1' }),
        }),
      );
    });
  });
});
