import { WakingCycleService } from './waking-cycle.service';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryService } from '../memory/memory.service';
import { MemorySignalService } from './signals/memory-signal.service';
import { GitHubSignalService } from './signals/github-signal.service';
import { PatternDetectorService } from './analysis/pattern-detector.service';
import { InsightGeneratorService } from './analysis/insight-generator.service';
import { BehavioralConsistencyService } from './analysis/behavioral-consistency.service';
import { ProactiveNotificationService } from './proactive-notification.service';
import { InsightFeedbackService } from './insight-feedback.service';

describe('WakingCycleService', () => {
  let service: WakingCycleService;
  let prisma: any;
  let memoryService: any;
  let memorySignal: any;
  let githubSignal: any;
  let patternDetector: any;
  let insightGenerator: any;
  let behavioralConsistency: any;
  let proactiveNotification: any;
  let insightFeedback: any;

  beforeEach(() => {
    prisma = {
      awarenessState: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      account: {
        findFirst: jest.fn().mockResolvedValue({ id: 'acc-1' }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'user-1' }),
      },
      memory: {
        update: jest.fn().mockResolvedValue({}),
      },
    };

    memoryService = {
      remember: jest.fn().mockResolvedValue({ id: 'mem-1' }),
    };

    memorySignal = {
      name: 'memory',
      collect: jest.fn().mockResolvedValue({
        observations: [
          { id: 'obs-1', source: 'memory', content: 'User talks about cooking often', observedAt: new Date() },
        ],
        checkpoint: { lastId: 'mem-100' },
      }),
    };

    githubSignal = {
      name: 'github',
      collect: jest.fn().mockResolvedValue({
        observations: [],
        checkpoint: {},
      }),
    };

    patternDetector = {
      detect: jest.fn().mockReturnValue([
        { type: 'recurring_topic', description: 'Cooking mentioned frequently', observations: ['obs-1'] },
      ]),
    };

    insightGenerator = {
      generate: jest.fn().mockResolvedValue([
        {
          content: 'User has a strong interest in cooking',
          confidence: 0.8,
          insightType: 'recurring_pattern',
          sourceMemoryIds: ['mem-50'],
          signalSource: 'memory',
          actionable: false,
        },
      ]),
    };

    behavioralConsistency = {
      check: jest.fn().mockResolvedValue({
        inconsistencies: [],
        memoriesAnalyzed: 0,
        llmCallsUsed: 0,
      }),
    };

    proactiveNotification = {
      checkAndNotify: jest.fn().mockResolvedValue([]),
    };

    insightFeedback = {
      getFeedbackStats: jest.fn().mockResolvedValue({
        totalFeedback: 0,
        dismissed: 0,
        actedOn: 0,
        helpful: 0,
        avgConfidenceAdjustment: 0,
      }),
    };

    service = new WakingCycleService(
      prisma,
      memoryService,
      memorySignal,
      githubSignal,
      patternDetector,
      insightGenerator,
      behavioralConsistency,
      proactiveNotification,
      insightFeedback,
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

    it('should store insights as INSIGHT layer memories with metadata (HEY-136)', async () => {
      await service.runCycle();

      expect(memoryService.remember).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          raw: 'User has a strong interest in cooking',
          layer: 'INSIGHT',
          source: 'PATTERN_DETECTED',
        }),
      );

      // Should update with full insight metadata
      expect(prisma.memory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'mem-1' },
          data: expect.objectContaining({
            confidence: 0.8,
            metadata: expect.objectContaining({
              insightType: 'recurring_pattern',
              sourceMemoryIds: ['mem-50'],
              signalSource: 'memory',
              actionable: false,
              acknowledged: false,
            }),
          }),
        }),
      );
    });

    it('should adjust confidence based on feedback history (HEY-151)', async () => {
      insightFeedback.getFeedbackStats.mockResolvedValue({
        totalFeedback: 5,
        dismissed: 3,
        actedOn: 1,
        helpful: 1,
        avgConfidenceAdjustment: -0.03,
      });

      await service.runCycle();

      // Original confidence 0.8 adjusted by -0.03 = 0.77
      const updateCall = prisma.memory.update.mock.calls[0][0];
      expect(updateCall.data.confidence).toBeCloseTo(0.77, 2);
    });

    it('should trigger proactive notifications after storing (HEY-154)', async () => {
      await service.runCycle();

      expect(proactiveNotification.checkAndNotify).toHaveBeenCalledWith('acc-1');
    });

    it('should skip storing if no user found', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const result = await service.runCycle();

      expect(result.insights).toBe(1);
      expect(memoryService.remember).not.toHaveBeenCalled();
    });

    it('should prevent concurrent runs', async () => {
      const firstCycle = service.runCycle();
      const secondCycle = service.runCycle();

      const [first, second] = await Promise.all([firstCycle, secondCycle]);

      expect(second).toEqual({ observations: 0, patterns: 0, insights: 0, durationMs: 0 });
      expect(first.observations).toBe(1);
    });

    it('should handle errors gracefully', async () => {
      memorySignal.collect.mockRejectedValue(new Error('DB connection lost'));

      const result = await service.runCycle();

      expect(result.observations).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should save checkpoints after collecting signals', async () => {
      await service.runCycle();

      expect(prisma.awarenessState.upsert).toHaveBeenCalledTimes(2);
    });

    it('should handle insight dedup rejection gracefully', async () => {
      memoryService.remember.mockRejectedValue(new Error('Duplicate memory detected'));

      const result = await service.runCycle();
      expect(result.insights).toBe(1);
    });

    it('should handle proactive notification failure gracefully', async () => {
      proactiveNotification.checkAndNotify.mockRejectedValue(new Error('Webhook failed'));

      const result = await service.runCycle();
      expect(result.insights).toBe(1);
    });

    it('should work without optional services', async () => {
      const minimalService = new WakingCycleService(
        prisma,
        memoryService,
        memorySignal,
        githubSignal,
        patternDetector,
        insightGenerator,
        behavioralConsistency,
      );

      const result = await minimalService.runCycle();
      expect(result.insights).toBe(1);
    });
  });
});
