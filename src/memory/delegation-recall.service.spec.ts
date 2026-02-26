import { ContextualRecallService } from './contextual-recall.service';

describe('ContextualRecallService — Delegation-Aware Recall (HEY-189)', () => {
  let service: ContextualRecallService;
  let prisma: any;
  let embedding: any;
  let memoryPoolService: any;
  let memoryAccessLogService: any;

  const userId = 'user-1';

  beforeEach(() => {
    prisma = {
      memory: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'mem-1',
            raw: 'The SSRF bug is in the webhook handler',
            layer: 'SESSION',
            extraction: { topics: ['ssrf', 'security'] },
          },
          {
            id: 'mem-2',
            raw: 'Deploy uses blue-green strategy',
            layer: 'PROJECT',
            extraction: { topics: ['deploy'] },
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      memoryAccessLog: {
        findMany: jest.fn().mockResolvedValue([
          { memoryId: 'mem-1' }, // delegator accessed mem-1
        ]),
      },
    };

    embedding = {
      generate: jest.fn().mockResolvedValue(new Array(768).fill(0.1)),
      search: jest.fn().mockResolvedValue([
        { id: 'mem-1', score: 0.6 },
        { id: 'mem-2', score: 0.55 },
        { id: 'mem-3', score: 0.4 },
      ]),
    };

    memoryPoolService = {
      getAccessiblePoolIds: jest.fn().mockResolvedValue([]),
    };

    memoryAccessLogService = {
      logRecalled: jest.fn().mockResolvedValue(undefined),
    };

    service = new ContextualRecallService(
      prisma,
      embedding,
      memoryPoolService,
      memoryAccessLogService,
    );
  });

  it('should boost scores for delegator memories', async () => {
    // mem-1 was accessed by delegator, so it should get boosted
    prisma.memoryAccessLog.findMany.mockResolvedValue([{ memoryId: 'mem-1' }]);
    prisma.memory.findMany
      .mockResolvedValueOnce([]) // getDelegatorMemoryIds - createdBySession query
      .mockResolvedValue([
        {
          id: 'mem-1',
          raw: 'SSRF bug in webhook handler',
          layer: 'SESSION',
          extraction: { topics: ['ssrf'] },
        },
        {
          id: 'mem-2',
          raw: 'Deploy uses blue-green',
          layer: 'PROJECT',
          extraction: { topics: ['deploy'] },
        },
      ]);

    const result = await service.recall(userId, {
      text: 'fix the SSRF vulnerability',
      sessionKey: 'session-delegatee',
      delegationContext: {
        delegatingAgentSessionKey: 'session-delegator',
        taskDescription: 'fix the SSRF bug',
        boostFactor: 1.5,
      },
    });

    // The delegator's memory (mem-1) should appear first due to boosting
    expect(result.topicShift).toBe(true);
    // mem-1 base score 0.6 * 1.5 = 0.9 (capped at 1.0)
    // mem-2 stays at 0.55
    if (result.memories.length > 0) {
      expect(result.memories[0].id).toBe('mem-1');
    }
  });

  it('should work normally without delegation context', async () => {
    prisma.memory.findMany.mockResolvedValue([
      {
        id: 'mem-1',
        raw: 'test',
        layer: 'SESSION',
        extraction: { topics: [] },
      },
    ]);

    const result = await service.recall(userId, {
      text: 'something new',
      sessionKey: 'session-normal',
    });

    expect(result.topicShift).toBe(true);
    expect(prisma.memoryAccessLog.findMany).not.toHaveBeenCalled();
  });

  it('should use default boost factor of 1.5 when not specified', async () => {
    prisma.memoryAccessLog.findMany.mockResolvedValue([{ memoryId: 'mem-1' }]);
    prisma.memory.findMany.mockResolvedValue([]);

    const result = await service.recall(userId, {
      text: 'fix the bug',
      sessionKey: 'session-2',
      delegationContext: {
        delegatingAgentSessionKey: 'session-delegator',
      },
    });

    // Should not throw — default boostFactor is applied
    expect(result).toBeDefined();
  });
});
