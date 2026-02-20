import { Test, TestingModule } from '@nestjs/testing';
import { TrustSignalService } from '../trust-signal.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('TrustSignalService', () => {
  let service: TrustSignalService;
  let prisma: {
    trustSignal: {
      create: jest.Mock;
      findMany: jest.Mock;
    };
    trustScore: {
      create: jest.Mock;
      findFirst: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      trustSignal: {
        create: jest.fn().mockResolvedValue({ id: 'sig-1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      trustScore: {
        create: jest.fn().mockResolvedValue({ id: 'score-1' }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrustSignalService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(TrustSignalService);
  });

  describe('recordSignal', () => {
    it('should record a SUCCESS signal with positive weight', async () => {
      await service.recordSignal({
        userId: 'user-1',
        signalType: 'SUCCESS',
        context: 'Deployed successfully',
        category: 'deploy',
      });

      expect(prisma.trustSignal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          signalType: 'SUCCESS',
          context: 'Deployed successfully',
          category: 'deploy',
          weight: 1.0, // 1.0 * 1.0 (SUCCESS weight)
        }),
      });
    });

    it('should record a FAILURE signal with negative weight', async () => {
      await service.recordSignal({
        userId: 'user-1',
        signalType: 'FAILURE',
        context: 'Deploy crashed',
        category: 'deploy',
      });

      expect(prisma.trustSignal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          signalType: 'FAILURE',
          weight: -1.5, // 1.0 * -1.5 (FAILURE weight)
        }),
      });
    });

    it('should record a CORRECTION signal with mild negative weight', async () => {
      await service.recordSignal({
        userId: 'user-1',
        signalType: 'CORRECTION',
        context: 'Agent corrected its approach',
      });

      expect(prisma.trustSignal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          signalType: 'CORRECTION',
          weight: -0.5,
        }),
      });
    });

    it('should apply custom weight multiplier', async () => {
      await service.recordSignal({
        userId: 'user-1',
        signalType: 'SUCCESS',
        context: 'Minor task',
        weight: 0.5,
      });

      expect(prisma.trustSignal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          weight: 0.5, // 0.5 * 1.0
        }),
      });
    });
  });

  describe('computeScore', () => {
    it('should return 0.5 score when no signals exist', async () => {
      prisma.trustSignal.findMany.mockResolvedValue([]);

      const result = await service.computeScore('user-1');

      expect(result.score).toBe(0.5);
      expect(result.signalCount).toBe(0);
      expect(prisma.trustScore.create).toHaveBeenCalled();
    });

    it('should compute high score for mostly successes', async () => {
      const now = new Date();
      prisma.trustSignal.findMany.mockResolvedValue([
        { signalType: 'SUCCESS', weight: 1.0, createdAt: now },
        { signalType: 'SUCCESS', weight: 1.0, createdAt: now },
        { signalType: 'SUCCESS', weight: 1.0, createdAt: now },
        { signalType: 'SUCCESS', weight: 1.0, createdAt: now },
        { signalType: 'FAILURE', weight: -1.5, createdAt: now },
      ]);

      const result = await service.computeScore('user-1');

      expect(result.score).toBeGreaterThan(0.5);
      expect(result.successCount).toBe(4);
      expect(result.failureCount).toBe(1);
    });

    it('should compute low score for mostly failures', async () => {
      const now = new Date();
      prisma.trustSignal.findMany.mockResolvedValue([
        { signalType: 'FAILURE', weight: -1.5, createdAt: now },
        { signalType: 'FAILURE', weight: -1.5, createdAt: now },
        { signalType: 'FAILURE', weight: -1.5, createdAt: now },
        { signalType: 'SUCCESS', weight: 1.0, createdAt: now },
      ]);

      const result = await service.computeScore('user-1');

      expect(result.score).toBeLessThan(0.5);
    });

    it('should apply time decay - older signals matter less', async () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(
        now.getTime() - 30 * 24 * 60 * 60 * 1000,
      );

      // Old failure, recent success
      prisma.trustSignal.findMany.mockResolvedValue([
        { signalType: 'SUCCESS', weight: 1.0, createdAt: now },
        { signalType: 'FAILURE', weight: -1.5, createdAt: thirtyDaysAgo },
      ]);

      const result = await service.computeScore('user-1');

      // Score should be above 0.5 because the success is recent
      expect(result.score).toBeGreaterThan(0.5);
    });

    it('should filter by category', async () => {
      await service.computeScore('user-1', { category: 'deploy' });

      expect(prisma.trustSignal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category: 'deploy' }),
        }),
      );
    });
  });

  describe('extractFromMemory', () => {
    it('should extract CORRECTION signal from correction memories', async () => {
      await service.extractFromMemory({
        id: 'mem-1',
        userId: 'user-1',
        raw: 'Agent was corrected about deployment process',
        source: 'CORRECTION',
        extraction: { topics: ['deployment'] },
      });

      expect(prisma.trustSignal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          signalType: 'CORRECTION',
          category: 'deployment',
        }),
      });
    });

    it('should extract FAILURE signal from LESSON memories', async () => {
      await service.extractFromMemory({
        id: 'mem-2',
        userId: 'user-1',
        raw: 'Learned that the build step requires Node 18',
        memoryType: 'LESSON',
        extraction: { topics: ['build'] },
      });

      expect(prisma.trustSignal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          signalType: 'FAILURE',
          category: 'build',
        }),
      });
    });

    it('should extract SUCCESS signal from agent observations', async () => {
      await service.extractFromMemory({
        id: 'mem-3',
        userId: 'user-1',
        raw: 'Successfully deployed the application to production',
        source: 'AGENT_OBSERVATION',
        extraction: { topics: ['deploy'] },
      });

      expect(prisma.trustSignal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          signalType: 'SUCCESS',
          category: 'deploy',
        }),
      });
    });
  });

  describe('getLatestScore', () => {
    it('should return null when no score exists', async () => {
      const result = await service.getLatestScore('user-1');
      expect(result).toBeNull();
    });

    it('should return the most recent score', async () => {
      prisma.trustScore.findFirst.mockResolvedValue({
        category: null,
        score: 0.85,
        signalCount: 10,
        successCount: 8,
        failureCount: 1,
        correctionCount: 1,
        computedAt: new Date(),
      });

      const result = await service.getLatestScore('user-1');
      expect(result).not.toBeNull();
      expect(result!.score).toBe(0.85);
    });
  });
});
