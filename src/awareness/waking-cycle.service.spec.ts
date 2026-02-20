import { WakingCycleService } from './waking-cycle.service';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryService } from '../memory/memory.service';
import { MemorySignalService } from './signals/memory-signal.service';
import { GitHubSignalService } from './signals/github-signal.service';
import { PatternDetectorService } from './analysis/pattern-detector.service';
import { InsightGeneratorService } from './analysis/insight-generator.service';

describe('WakingCycleService', () => {
  let service: WakingCycleService;
  let prisma: jest.Mocked<PrismaService>;
  let memoryService: jest.Mocked<MemoryService>;
  let memorySignal: jest.Mocked<MemorySignalService>;
  let githubSignal: jest.Mocked<GitHubSignalService>;
  let patternDetector: jest.Mocked<PatternDetectorService>;
  let insightGenerator: jest.Mocked<InsightGeneratorService>;

  beforeEach(() => {
    prisma = {
      awarenessState: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      account: {
        findFirst: jest.fn().mockResolvedValue({ id: 'acc-1' }),
        findMany: jest.fn().mockResolvedValue([{ id: 'acc-1' }]),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'user-1' }),
      },
    } as any;

    memoryService = {
      remember: jest.fn().mockResolvedValue({ id: 'mem-1' }),
    } as any;

    memorySignal = {
      name: 'memory',
      collect: jest.fn().mockResolvedValue({
        observations: [
          { id: 'obs-1', source: 'memory', content: 'User talks about cooking often', observedAt: new Date() },
        ],
        checkpoint: { lastId: 'mem-100' },
      }),
    } as any;

    githubSignal = {
      name: 'github',
      collect: jest.fn().mockResolvedValue({
        observations: [],
        checkpoint: {},
      }),
    } as any;

    patternDetector = {
      detect: jest.fn().mockReturnValue([
        { type: 'recurring_topic', description: 'Cooking mentioned frequently', observations: ['obs-1'] },
      ]),
    } as any;

    insightGenerator = {
      generate: jest.fn().mockResolvedValue([
        { content: 'User has a strong interest in cooking', confidence: 0.8 },
      ]),
    } as any;

    const linearSignal = {
      name: 'linear',
      collect: jest.fn().mockResolvedValue({
        observations: [],
        checkpoint: {},
      }),
    } as any;

    service = new WakingCycleService(
      prisma,
      memoryService,
      memorySignal,
      githubSignal,
      linearSignal,
      patternDetector,
      insightGenerator,
    );
  });

  describe('runCycle', () => {
    it('should execute full pipeline and return stats', async () => {
      const result = await service.runCycle();

      expect(result.observations).toBe(1);
      expect(result.patterns).toBe(1);
      expect(result.insights).toBe(1);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      expect(memorySignal.collect).toHaveBeenCalledTimes(1);
      expect(githubSignal.collect).toHaveBeenCalledTimes(1);
      expect(patternDetector.detect).toHaveBeenCalledTimes(1);
      expect(insightGenerator.generate).toHaveBeenCalledTimes(1);
      expect(memoryService.remember).toHaveBeenCalledTimes(1);
    });

    it('should store insights as INSIGHT layer memories', async () => {
      await service.runCycle();

      expect(memoryService.remember).toHaveBeenCalledWith('user-1', expect.objectContaining({
        raw: 'User has a strong interest in cooking',
        layer: 'INSIGHT',
        source: 'PATTERN_DETECTED',
      }));
    });

    it('should skip storing if no user found for account', async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.runCycle('acc-1');

      expect(result.insights).toBe(1);
      expect(memoryService.remember).not.toHaveBeenCalled();
    });

    it('should prevent concurrent runs', async () => {
      // Start first cycle (will take a moment)
      const firstCycle = service.runCycle();
      // Try a second while first is running
      const secondCycle = service.runCycle();

      const [first, second] = await Promise.all([firstCycle, secondCycle]);

      // Second should be skipped
      expect(second).toEqual({ observations: 0, patterns: 0, insights: 0, durationMs: 0 });
      expect(first.observations).toBe(1);
    });

    it('should handle errors gracefully', async () => {
      memorySignal.collect.mockRejectedValue(new Error('DB connection lost'));

      const result = await service.runCycle();

      expect(result.observations).toBe(0);
      expect(result.patterns).toBe(0);
      expect(result.insights).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should save checkpoints after collecting signals', async () => {
      await service.runCycle();

      expect(prisma.awarenessState.upsert).toHaveBeenCalledTimes(3);
      expect(prisma.awarenessState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            accountId_signalSource: {
              accountId: 'acc-1',
              signalSource: 'memory',
            },
          },
        }),
      );
    });

    it('should skip cycle if no account found', async () => {
      (prisma.account.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.runCycle();

      expect(result.observations).toBe(0);
      expect(prisma.awarenessState.upsert).not.toHaveBeenCalled();
    });

    it('should scope to a specific accountId when provided', async () => {
      await service.runCycle('acc-42');

      expect(prisma.awarenessState.findMany).toHaveBeenCalledWith({
        where: { accountId: 'acc-42' },
      });
      expect(prisma.awarenessState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            accountId_signalSource: {
              accountId: 'acc-42',
              signalSource: 'memory',
            },
          },
        }),
      );
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { agent: { accountId: 'acc-42' } },
      });
    });

    it('should handle insight dedup rejection gracefully', async () => {
      memoryService.remember.mockRejectedValue(new Error('Duplicate memory detected'));

      const result = await service.runCycle();

      // Should still complete successfully
      expect(result.insights).toBe(1);
    });
  });
});
