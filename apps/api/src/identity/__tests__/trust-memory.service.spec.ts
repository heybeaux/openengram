import { TrustMemoryService } from '../trust-memory.service';
import { TrustSignalService } from '../trust-signal.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('TrustMemoryService', () => {
  let service: TrustMemoryService;
  let prisma: any;
  let trustSignal: jest.Mocked<TrustSignalService>;

  beforeEach(() => {
    prisma = {
      memory: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
    } as any;

    trustSignal = {
      getLatestScore: jest.fn(),
      computeScore: jest.fn(),
    } as any;

    service = new TrustMemoryService(prisma, trustSignal);
  });

  describe('recomputeAndRemember', () => {
    it('should create initial trust memory when no previous score exists', async () => {
      trustSignal.getLatestScore.mockResolvedValue(null);
      trustSignal.computeScore.mockResolvedValue({
        category: null,
        score: 0.65,
        signalCount: 10,
        successCount: 7,
        failureCount: 2,
        correctionCount: 1,
        computedAt: new Date(),
      });
      prisma.memory.create.mockResolvedValue({ id: 'mem-1' } as any);

      const result = await service.recomputeAndRemember('user-1', {
        agentId: 'agent-1',
      });

      expect(result.score.score).toBe(0.65);
      expect(result.memoryId).toBe('mem-1');
      expect(result.narrative).toContain('initialized');
      expect(result.narrative).toContain('0.65');
      expect(prisma.memory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            layer: 'IDENTITY',
            metadata: expect.objectContaining({
              trustScore: true,
              newScore: 0.65,
            }),
          }),
        }),
      );
    });

    it('should create delta memory when trust increases', async () => {
      trustSignal.getLatestScore.mockResolvedValue({
        category: null,
        score: 0.6,
        signalCount: 8,
        successCount: 5,
        failureCount: 2,
        correctionCount: 1,
        computedAt: new Date(),
      });
      trustSignal.computeScore.mockResolvedValue({
        category: null,
        score: 0.75,
        signalCount: 12,
        successCount: 9,
        failureCount: 2,
        correctionCount: 1,
        computedAt: new Date(),
      });
      prisma.memory.create.mockResolvedValue({ id: 'mem-2' } as any);

      const result = await service.recomputeAndRemember('user-1', {
        agentId: 'agent-1',
      });

      expect(result.narrative).toContain('increased');
      expect(result.narrative).toContain('0.60');
      expect(result.narrative).toContain('0.75');
    });

    it('should skip memory creation for negligible changes', async () => {
      trustSignal.getLatestScore.mockResolvedValue({
        category: null,
        score: 0.7,
        signalCount: 10,
        successCount: 7,
        failureCount: 2,
        correctionCount: 1,
        computedAt: new Date(),
      });
      trustSignal.computeScore.mockResolvedValue({
        category: null,
        score: 0.702,
        signalCount: 10,
        successCount: 7,
        failureCount: 2,
        correctionCount: 1,
        computedAt: new Date(),
      });

      const result = await service.recomputeAndRemember('user-1');

      expect(result.memoryId).toBeNull();
      expect(result.narrative).toBeNull();
      expect(prisma.memory.create).not.toHaveBeenCalled();
    });

    it('should create memory when trust decreases', async () => {
      trustSignal.getLatestScore.mockResolvedValue({
        category: null,
        score: 0.8,
        signalCount: 10,
        successCount: 8,
        failureCount: 1,
        correctionCount: 1,
        computedAt: new Date(),
      });
      trustSignal.computeScore.mockResolvedValue({
        category: null,
        score: 0.55,
        signalCount: 15,
        successCount: 8,
        failureCount: 6,
        correctionCount: 1,
        computedAt: new Date(),
      });
      prisma.memory.create.mockResolvedValue({ id: 'mem-3' } as any);

      const result = await service.recomputeAndRemember('user-1', {
        agentId: 'a1',
      });

      expect(result.narrative).toContain('significantly decreased');
      expect(result.narrative).toContain('0.80');
      expect(result.narrative).toContain('0.55');
    });
  });

  describe('getTrustNarrative', () => {
    it('should return trust narrative history', async () => {
      prisma.memory.findMany.mockResolvedValue([
        {
          id: 'mem-1',
          raw: 'Trust increased from 0.5 to 0.7',
          metadata: {
            trustScore: true,
            category: 'overall',
            newScore: 0.7,
            delta: 0.2,
          },
          createdAt: new Date('2026-02-20'),
        },
      ] as any);

      const result = await service.getTrustNarrative('user-1', {
        agentId: 'a1',
      });

      expect(result).toHaveLength(1);
      expect(result[0].score).toBe(0.7);
      expect(result[0].delta).toBe(0.2);
    });

    it('should filter by category', async () => {
      prisma.memory.findMany.mockResolvedValue([
        {
          id: 'mem-1',
          raw: 'Trust for deploy...',
          metadata: {
            trustScore: true,
            category: 'deploy',
            newScore: 0.8,
            delta: 0.1,
          },
          createdAt: new Date(),
        },
        {
          id: 'mem-2',
          raw: 'Trust for code-review...',
          metadata: {
            trustScore: true,
            category: 'code-review',
            newScore: 0.6,
            delta: -0.1,
          },
          createdAt: new Date(),
        },
      ] as any);

      const result = await service.getTrustNarrative('user-1', {
        category: 'deploy',
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('mem-1');
    });
  });
});
