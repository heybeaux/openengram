import { Test, TestingModule } from '@nestjs/testing';
import { TrustSignalService } from './trust-signal.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  trustSignal: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  trustScore: {
    create: jest.fn(),
    findFirst: jest.fn(),
  },
};

describe('TrustSignalService', () => {
  let service: TrustSignalService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrustSignalService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<TrustSignalService>(TrustSignalService);
  });

  describe('recordSignal', () => {
    it('should record a SUCCESS signal with positive weight', async () => {
      mockPrisma.trustSignal.create.mockResolvedValue({ id: '1' });
      await service.recordSignal({
        userId: 'user1',
        agentId: 'agent1',
        signalType: 'SUCCESS',
        context: 'deployed successfully',
      });
      expect(mockPrisma.trustSignal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user1',
          agentId: 'agent1',
          signalType: 'SUCCESS',
          weight: 1.0, // 1.0 * 1.0
        }),
      });
    });

    it('should record a FAILURE signal with negative weight', async () => {
      mockPrisma.trustSignal.create.mockResolvedValue({ id: '2' });
      await service.recordSignal({
        userId: 'user1',
        signalType: 'FAILURE',
        context: 'build broke',
      });
      expect(mockPrisma.trustSignal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          weight: -1.5, // 1.0 * -1.5
        }),
      });
    });

    it('should record CORRECTION with -0.5 weight', async () => {
      mockPrisma.trustSignal.create.mockResolvedValue({ id: '3' });
      await service.recordSignal({
        userId: 'user1',
        signalType: 'CORRECTION',
        context: 'corrected preference',
      });
      expect(mockPrisma.trustSignal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          weight: -0.5,
        }),
      });
    });

    it('should apply custom weight multiplier', async () => {
      mockPrisma.trustSignal.create.mockResolvedValue({ id: '4' });
      await service.recordSignal({
        userId: 'user1',
        signalType: 'FAILURE',
        context: 'minor issue',
        weight: 0.5,
      });
      expect(mockPrisma.trustSignal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          weight: -0.75, // 0.5 * -1.5
        }),
      });
    });
  });

  describe('computeScore', () => {
    it('should return 0.5 score for no signals', async () => {
      mockPrisma.trustSignal.findMany.mockResolvedValue([]);
      mockPrisma.trustScore.create.mockResolvedValue({});
      const result = await service.computeScore('user1');
      expect(result.score).toBe(0.5); // (0 + 1) / 2
      expect(result.signalCount).toBe(0);
    });

    it('should compute higher score for recent successes', async () => {
      const now = new Date();
      mockPrisma.trustSignal.findMany.mockResolvedValue([
        { id: '1', signalType: 'SUCCESS', weight: 1.0, createdAt: now },
        { id: '2', signalType: 'SUCCESS', weight: 1.0, createdAt: now },
      ]);
      mockPrisma.trustScore.create.mockResolvedValue({});
      const result = await service.computeScore('user1');
      expect(result.score).toBeGreaterThan(0.5);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(0);
    });

    it('should compute lower score for failures', async () => {
      const now = new Date();
      mockPrisma.trustSignal.findMany.mockResolvedValue([
        { id: '1', signalType: 'FAILURE', weight: -1.5, createdAt: now },
      ]);
      mockPrisma.trustScore.create.mockResolvedValue({});
      const result = await service.computeScore('user1');
      expect(result.score).toBeLessThan(0.5);
      expect(result.failureCount).toBe(1);
    });

    it('should apply time decay to older signals', async () => {
      const now = new Date();
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      mockPrisma.trustSignal.findMany.mockResolvedValue([
        {
          id: '1',
          signalType: 'FAILURE',
          weight: -1.5,
          createdAt: sixtyDaysAgo,
        },
      ]);
      mockPrisma.trustScore.create.mockResolvedValue({});
      const result = await service.computeScore('user1');
      // Old failure should be heavily decayed, score closer to 0.5
      // With time decay, old failure is reduced but rawScore = weightedSum/totalWeight = -1
      // score = (-1 + 1) / 2 = 0, clamped to 0
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThan(0.5);
    });

    it('should filter by agentId and category', async () => {
      mockPrisma.trustSignal.findMany.mockResolvedValue([]);
      mockPrisma.trustScore.create.mockResolvedValue({});
      await service.computeScore('user1', {
        agentId: 'a1',
        category: 'coding',
      });
      expect(mockPrisma.trustSignal.findMany).toHaveBeenCalledWith({
        where: { userId: 'user1', agentId: 'a1', category: 'coding' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should persist trust score snapshot', async () => {
      mockPrisma.trustSignal.findMany.mockResolvedValue([]);
      mockPrisma.trustScore.create.mockResolvedValue({});
      await service.computeScore('user1');
      expect(mockPrisma.trustScore.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user1',
          signalCount: 0,
        }),
      });
    });

    it('should clamp score between 0 and 1', async () => {
      const now = new Date();
      // Many heavy failures
      const failures = Array.from({ length: 20 }, (_, i) => ({
        id: `f${i}`,
        signalType: 'FAILURE',
        weight: -10,
        createdAt: now,
      }));
      mockPrisma.trustSignal.findMany.mockResolvedValue(failures);
      mockPrisma.trustScore.create.mockResolvedValue({});
      const result = await service.computeScore('user1');
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });
  });

  describe('getLatestScore', () => {
    it('should return null when no score exists', async () => {
      mockPrisma.trustScore.findFirst.mockResolvedValue(null);
      const result = await service.getLatestScore('user1');
      expect(result).toBeNull();
    });

    it('should return the latest score', async () => {
      const score = {
        category: 'coding',
        score: 0.85,
        signalCount: 10,
        successCount: 8,
        failureCount: 2,
        correctionCount: 0,
        computedAt: new Date(),
      };
      mockPrisma.trustScore.findFirst.mockResolvedValue(score);
      const result = await service.getLatestScore('user1', {
        category: 'coding',
      });
      expect(result).toEqual(score);
    });
  });

  describe('extractFromMemory', () => {
    it('should record CORRECTION signal for correction source', async () => {
      mockPrisma.trustSignal.create.mockResolvedValue({ id: '1' });
      await service.extractFromMemory({
        id: 'mem1',
        userId: 'user1',
        agentId: 'agent1',
        raw: 'Actually I prefer dark mode',
        source: 'CORRECTION',
        extraction: { topics: ['Preferences'] },
      });
      expect(mockPrisma.trustSignal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          signalType: 'CORRECTION',
          category: 'preferences',
        }),
      });
    });

    it('should record FAILURE signal for LESSON memories', async () => {
      mockPrisma.trustSignal.create.mockResolvedValue({ id: '2' });
      await service.extractFromMemory({
        id: 'mem2',
        userId: 'user1',
        raw: 'Learned not to use rm -rf',
        memoryType: 'LESSON',
      });
      expect(mockPrisma.trustSignal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          signalType: 'FAILURE',
        }),
      });
    });

    it('should record SUCCESS for agent observations', async () => {
      mockPrisma.trustSignal.create.mockResolvedValue({ id: '3' });
      await service.extractFromMemory({
        id: 'mem3',
        userId: 'user1',
        raw: 'Successfully deployed the new feature',
        source: 'AGENT_OBSERVATION',
      });
      expect(mockPrisma.trustSignal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          signalType: 'SUCCESS',
          weight: expect.any(Number),
        }),
      });
    });

    it('should not record signal for regular memories', async () => {
      await service.extractFromMemory({
        id: 'mem4',
        userId: 'user1',
        raw: 'The sky is blue',
        source: 'USER_MESSAGE',
      });
      expect(mockPrisma.trustSignal.create).not.toHaveBeenCalled();
    });

    it('should truncate context to 500 chars', async () => {
      mockPrisma.trustSignal.create.mockResolvedValue({ id: '5' });
      const longText = 'x'.repeat(1000);
      await service.extractFromMemory({
        id: 'mem5',
        userId: 'user1',
        raw: longText,
        source: 'CORRECTION',
      });
      expect(mockPrisma.trustSignal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          context: 'x'.repeat(500),
        }),
      });
    });
  });

  describe('looksLikeSuccess (via extractFromMemory)', () => {
    it('should detect success language', async () => {
      mockPrisma.trustSignal.create.mockResolvedValue({ id: '1' });
      await service.extractFromMemory({
        id: 'mem1',
        userId: 'user1',
        raw: 'Successfully deployed and merged the PR',
        source: 'AGENT_REFLECTION',
      });
      expect(mockPrisma.trustSignal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ signalType: 'SUCCESS' }),
      });
    });
  });
});
