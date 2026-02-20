import { FailurePatternService } from '../failure-pattern.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('FailurePatternService', () => {
  let service: FailurePatternService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      trustSignal: {
        findMany: jest.fn(),
      },
      memory: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    } as any;

    service = new FailurePatternService(prisma);
  });

  describe('analyze', () => {
    it('should detect capability-based failure patterns', async () => {
      const signals = [
        { signalType: 'FAILURE', category: 'typescript-refactor', context: 'Failed refactor 1', createdAt: new Date(), agentId: 'a1' },
        { signalType: 'FAILURE', category: 'typescript-refactor', context: 'Failed refactor 2', createdAt: new Date(), agentId: 'a1' },
        { signalType: 'FAILURE', category: 'typescript-refactor', context: 'Failed refactor 3', createdAt: new Date(), agentId: 'a1' },
        { signalType: 'SUCCESS', category: 'typescript-refactor', context: 'Success 1', createdAt: new Date(), agentId: 'a1' },
        { signalType: 'SUCCESS', category: 'deploy', context: 'Deploy OK', createdAt: new Date(), agentId: 'a1' },
      ];

      prisma.trustSignal.findMany.mockResolvedValue(signals as any);
      prisma.memory.findMany.mockResolvedValue([]); // No task outcomes
      prisma.memory.findFirst.mockResolvedValue(null); // No recent duplicate
      prisma.memory.create.mockResolvedValue({ id: 'insight-1' } as any);

      const result = await service.analyze('user-1', { agentId: 'a1' });

      expect(result.patterns.length).toBeGreaterThanOrEqual(1);
      const capPattern = result.patterns.find(
        (p) => p.type === 'capability' && p.key === 'typescript-refactor',
      );
      expect(capPattern).toBeDefined();
      expect(capPattern!.failureCount).toBe(3);
      expect(capPattern!.totalCount).toBe(4);
      expect(capPattern!.failureRate).toBe(0.75);
      expect(capPattern!.insight).toContain('typescript-refactor');
    });

    it('should return no patterns when failures are below threshold', async () => {
      const signals = [
        { signalType: 'FAILURE', category: 'deploy', context: 'Fail 1', createdAt: new Date(), agentId: 'a1' },
        { signalType: 'SUCCESS', category: 'deploy', context: 'OK 1', createdAt: new Date(), agentId: 'a1' },
        { signalType: 'SUCCESS', category: 'deploy', context: 'OK 2', createdAt: new Date(), agentId: 'a1' },
        { signalType: 'SUCCESS', category: 'deploy', context: 'OK 3', createdAt: new Date(), agentId: 'a1' },
      ];

      prisma.trustSignal.findMany.mockResolvedValue(signals as any);
      prisma.memory.findMany.mockResolvedValue([]);

      const result = await service.analyze('user-1', { storeInsights: false });

      const capPatterns = result.patterns.filter((p) => p.type === 'capability');
      expect(capPatterns).toHaveLength(0);
    });

    it('should detect time-of-day patterns', async () => {
      // Create signals all failing at night (0-6 hours)
      const nightTime = new Date('2026-02-20T03:00:00Z');
      const signals = Array.from({ length: 5 }, (_, i) => ({
        signalType: i < 4 ? 'FAILURE' : 'SUCCESS',
        category: 'misc',
        context: `Night task ${i}`,
        createdAt: nightTime,
        agentId: 'a1',
      }));

      prisma.trustSignal.findMany.mockResolvedValue(signals as any);
      prisma.memory.findMany.mockResolvedValue([]);

      const result = await service.analyze('user-1', { storeInsights: false });

      const timePattern = result.patterns.find((p) => p.type === 'time_of_day');
      expect(timePattern).toBeDefined();
      expect(timePattern!.failureRate).toBe(0.8);
    });

    it('should detect collaboration partner failure patterns', async () => {
      const signals = [
        { signalType: 'FAILURE', category: 'review', context: 'Fail', createdAt: new Date(), agentId: 'bad-agent' },
        { signalType: 'FAILURE', category: 'review', context: 'Fail', createdAt: new Date(), agentId: 'bad-agent' },
        { signalType: 'FAILURE', category: 'review', context: 'Fail', createdAt: new Date(), agentId: 'bad-agent' },
        { signalType: 'SUCCESS', category: 'review', context: 'OK', createdAt: new Date(), agentId: 'good-agent' },
        { signalType: 'SUCCESS', category: 'review', context: 'OK', createdAt: new Date(), agentId: 'good-agent' },
      ];

      prisma.trustSignal.findMany.mockResolvedValue(signals as any);
      prisma.memory.findMany.mockResolvedValue([]);

      const result = await service.analyze('user-1', { storeInsights: false });

      const collabPattern = result.patterns.find(
        (p) => p.type === 'collaboration' && p.key === 'bad-agent',
      );
      expect(collabPattern).toBeDefined();
      expect(collabPattern!.failureCount).toBe(3);
      expect(collabPattern!.failureRate).toBe(1.0);
    });

    it('should store insights as INSIGHT memories', async () => {
      const signals = Array.from({ length: 5 }, () => ({
        signalType: 'FAILURE',
        category: 'testing',
        context: 'Test failed',
        createdAt: new Date(),
        agentId: 'a1',
      }));

      prisma.trustSignal.findMany.mockResolvedValue(signals as any);
      prisma.memory.findMany.mockResolvedValue([]);
      prisma.memory.findFirst.mockResolvedValue(null); // No duplicate
      prisma.memory.create.mockResolvedValue({ id: 'insight-1' } as any);

      const result = await service.analyze('user-1', { agentId: 'a1', storeInsights: true });

      expect(result.insightsCreated).toBeGreaterThanOrEqual(1);
      expect(prisma.memory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            layer: 'INSIGHT',
            memoryType: 'LESSON',
            source: 'PATTERN_DETECTED',
            metadata: expect.objectContaining({
              failurePattern: expect.objectContaining({
                type: 'capability',
                key: 'testing',
              }),
              actionable: true,
            }),
          }),
        }),
      );
    });

    it('should skip duplicate capability insight when recent one exists', async () => {
      // 3 failures + many successes spread across times so only capability pattern triggers
      const times = [
        new Date('2026-02-20T09:00:00Z'),
        new Date('2026-02-20T14:00:00Z'),
        new Date('2026-02-20T20:00:00Z'),
      ];
      const signals = [
        { signalType: 'FAILURE', category: 'testing', context: 'Fail', createdAt: times[0], agentId: null },
        { signalType: 'FAILURE', category: 'testing', context: 'Fail', createdAt: times[1], agentId: null },
        { signalType: 'FAILURE', category: 'testing', context: 'Fail', createdAt: times[2], agentId: null },
        // Add successes at each time slot to keep time-of-day failure rate low
        { signalType: 'SUCCESS', category: 'testing', context: 'OK', createdAt: times[0], agentId: null },
        { signalType: 'SUCCESS', category: 'other', context: 'OK', createdAt: times[0], agentId: null },
        { signalType: 'SUCCESS', category: 'other', context: 'OK', createdAt: times[1], agentId: null },
        { signalType: 'SUCCESS', category: 'other', context: 'OK', createdAt: times[1], agentId: null },
        { signalType: 'SUCCESS', category: 'other', context: 'OK', createdAt: times[2], agentId: null },
        { signalType: 'SUCCESS', category: 'other', context: 'OK', createdAt: times[2], agentId: null },
      ];

      prisma.trustSignal.findMany.mockResolvedValue(signals as any);
      prisma.memory.findMany.mockResolvedValue([]);
      // Return existing insight matching the capability pattern key
      prisma.memory.findFirst.mockResolvedValue({
        id: 'existing-insight',
        metadata: { failurePattern: { type: 'capability', key: 'testing' } },
      } as any);

      const result = await service.analyze('user-1', { storeInsights: true });

      // The only pattern (capability/testing) should be skipped due to dedup
      expect(result.insightsCreated).toBe(0);
    });
  });
});
