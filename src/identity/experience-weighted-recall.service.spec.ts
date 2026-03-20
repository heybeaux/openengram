import { ExperienceWeightedRecallService } from './experience-weighted-recall.service';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryWithScore } from '../memory/memory.types';

describe('ExperienceWeightedRecallService', () => {
  let service: ExperienceWeightedRecallService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      experienceWeight: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        findMany: jest.fn(),
      },
    } as any;

    service = new ExperienceWeightedRecallService(prisma);
  });

  // ─── calculateWeight ────────────────────────────────────────────────────────

  describe('calculateWeight', () => {
    it('returns BASE_WEIGHT (1.0) when successCount is 0', () => {
      expect(service.calculateWeight(0)).toBe(1.0);
    });

    it('returns BASE_WEIGHT (1.0) when successCount is negative', () => {
      expect(service.calculateWeight(-5)).toBe(1.0);
    });

    it('returns ~1.6 weight at 20 successes (logarithmic curve)', () => {
      const weight = service.calculateWeight(20);
      expect(weight).toBeGreaterThan(1.5);
      expect(weight).toBeLessThan(1.75);
    });

    it('returns ~1.95 weight at 50 successes', () => {
      const weight = service.calculateWeight(50);
      expect(weight).toBeGreaterThan(1.9);
      expect(weight).toBeLessThan(2.0);
    });

    it('never exceeds MAX_WEIGHT (2.0)', () => {
      expect(service.calculateWeight(1000)).toBeLessThanOrEqual(2.0);
    });

    it('is monotonically increasing', () => {
      const weights = [1, 5, 10, 20, 50, 100].map((n) =>
        service.calculateWeight(n),
      );
      for (let i = 1; i < weights.length; i++) {
        expect(weights[i]).toBeGreaterThan(weights[i - 1]);
      }
    });

    it('returns a value between 1.0 and 2.0 for any positive successCount', () => {
      [1, 3, 7, 15, 30, 100].forEach((n) => {
        const w = service.calculateWeight(n);
        expect(w).toBeGreaterThanOrEqual(1.0);
        expect(w).toBeLessThanOrEqual(2.0);
      });
    });
  });

  // ─── updateWeight ────────────────────────────────────────────────────────────

  describe('updateWeight', () => {
    it('creates a new weight record when none exists (success)', async () => {
      prisma.experienceWeight.findUnique.mockResolvedValue(null);
      prisma.experienceWeight.upsert.mockResolvedValue({} as any);

      await service.updateWeight('user1', 'deploy', true);

      expect(prisma.experienceWeight.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            userId: 'user1',
            category: 'deploy',
            successCount: 1,
            totalCount: 1,
          }),
        }),
      );
    });

    it('creates a new weight record with 0 successes on failure', async () => {
      prisma.experienceWeight.findUnique.mockResolvedValue(null);
      prisma.experienceWeight.upsert.mockResolvedValue({} as any);

      await service.updateWeight('user1', 'deploy', false);

      expect(prisma.experienceWeight.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            successCount: 0,
            totalCount: 1,
          }),
        }),
      );
    });

    it('increments counts from existing record on success', async () => {
      prisma.experienceWeight.findUnique.mockResolvedValue({
        successCount: 10,
        totalCount: 12,
        weight: 1.5,
      } as any);
      prisma.experienceWeight.upsert.mockResolvedValue({} as any);

      await service.updateWeight('user1', 'deploy', true);

      expect(prisma.experienceWeight.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            successCount: 11,
            totalCount: 13,
          }),
        }),
      );
    });

    it('increments totalCount but not successCount on failure', async () => {
      prisma.experienceWeight.findUnique.mockResolvedValue({
        successCount: 10,
        totalCount: 12,
        weight: 1.5,
      } as any);
      prisma.experienceWeight.upsert.mockResolvedValue({} as any);

      await service.updateWeight('user1', 'deploy', false);

      expect(prisma.experienceWeight.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            successCount: 10,
            totalCount: 13,
          }),
        }),
      );
    });

    it('uses empty string for agentId when not provided', async () => {
      prisma.experienceWeight.findUnique.mockResolvedValue(null);
      prisma.experienceWeight.upsert.mockResolvedValue({} as any);

      await service.updateWeight('user1', 'deploy', true);

      expect(prisma.experienceWeight.findUnique).toHaveBeenCalledWith({
        where: {
          userId_agentId_category: {
            userId: 'user1',
            agentId: '',
            category: 'deploy',
          },
        },
      });
    });

    it('uses provided agentId', async () => {
      prisma.experienceWeight.findUnique.mockResolvedValue(null);
      prisma.experienceWeight.upsert.mockResolvedValue({} as any);

      await service.updateWeight('user1', 'deploy', true, 'agent-42');

      expect(prisma.experienceWeight.findUnique).toHaveBeenCalledWith({
        where: {
          userId_agentId_category: {
            userId: 'user1',
            agentId: 'agent-42',
            category: 'deploy',
          },
        },
      });
    });

    it('propagates prisma errors', async () => {
      prisma.experienceWeight.findUnique.mockRejectedValue(
        new Error('DB error'),
      );

      await expect(
        service.updateWeight('user1', 'deploy', true),
      ).rejects.toThrow('DB error');
    });
  });

  // ─── applyWeights ────────────────────────────────────────────────────────────

  describe('applyWeights', () => {
    const makeMemory = (
      id: string,
      score: number,
      topics?: string[],
    ): MemoryWithScore =>
      ({
        id,
        score,
        extraction: topics ? { topics } : undefined,
      }) as any;

    it('returns memories unchanged when no weights exist', async () => {
      prisma.experienceWeight.findMany.mockResolvedValue([]);

      const memories = [makeMemory('m1', 0.8, ['deploy'])];
      const result = await service.applyWeights('user1', memories);

      expect(result).toEqual(memories);
    });

    it('returns memories unchanged when memory has no topics', async () => {
      prisma.experienceWeight.findMany.mockResolvedValue([
        { category: 'deploy', weight: 1.8 },
      ] as any);

      const memories = [makeMemory('m1', 0.8, undefined)];
      const result = await service.applyWeights('user1', memories);

      expect(result[0].score).toBe(0.8);
    });

    it('returns memories unchanged when memory has empty topics', async () => {
      prisma.experienceWeight.findMany.mockResolvedValue([
        { category: 'deploy', weight: 1.8 },
      ] as any);

      const memories = [makeMemory('m1', 0.8, [])];
      const result = await service.applyWeights('user1', memories);

      expect(result[0].score).toBe(0.8);
    });

    it('boosts score when topic matches an experience weight', async () => {
      prisma.experienceWeight.findMany.mockResolvedValue([
        { category: 'deploy', weight: 1.8 },
      ] as any);

      const memories = [makeMemory('m1', 0.5, ['deploy'])];
      const result = await service.applyWeights('user1', memories);

      expect(result[0].score).toBeCloseTo(0.5 * 1.8);
    });

    it('applies topic matching case-insensitively', async () => {
      prisma.experienceWeight.findMany.mockResolvedValue([
        { category: 'deploy', weight: 1.8 },
      ] as any);

      const memories = [makeMemory('m1', 0.5, ['Deploy', 'DEPLOY'])];
      const result = await service.applyWeights('user1', memories);

      expect(result[0].score).toBeCloseTo(0.5 * 1.8);
    });

    it('uses the highest matching weight when multiple topics match', async () => {
      prisma.experienceWeight.findMany.mockResolvedValue([
        { category: 'deploy', weight: 1.5 },
        { category: 'testing', weight: 1.9 },
      ] as any);

      const memories = [makeMemory('m1', 0.5, ['deploy', 'testing'])];
      const result = await service.applyWeights('user1', memories);

      // Should use 1.9 (max)
      expect(result[0].score).toBeCloseTo(0.5 * 1.9);
    });

    it('does not boost when topic weight is at BASE (1.0)', async () => {
      prisma.experienceWeight.findMany.mockResolvedValue([
        { category: 'deploy', weight: 1.0 },
      ] as any);

      const memories = [makeMemory('m1', 0.5, ['deploy'])];
      const result = await service.applyWeights('user1', memories);

      expect(result[0].score).toBe(0.5);
    });

    it('processes multiple memories independently', async () => {
      prisma.experienceWeight.findMany.mockResolvedValue([
        { category: 'deploy', weight: 2.0 },
      ] as any);

      const memories = [
        makeMemory('m1', 0.5, ['deploy']),
        makeMemory('m2', 0.4, ['other']),
        makeMemory('m3', 0.6, ['deploy']),
      ];
      const result = await service.applyWeights('user1', memories);

      expect(result[0].score).toBeCloseTo(1.0);
      expect(result[1].score).toBe(0.4); // no match
      expect(result[2].score).toBeCloseTo(1.2);
    });

    it('filters by agentId when provided', async () => {
      prisma.experienceWeight.findMany.mockResolvedValue([]);

      await service.applyWeights('user1', [], { agentId: 'agent-99' });

      expect(prisma.experienceWeight.findMany).toHaveBeenCalledWith({
        where: { userId: 'user1', agentId: 'agent-99' },
      });
    });

    it('handles memory with score of 0', async () => {
      prisma.experienceWeight.findMany.mockResolvedValue([
        { category: 'deploy', weight: 1.8 },
      ] as any);

      const memories = [makeMemory('m1', 0, ['deploy'])];
      const result = await service.applyWeights('user1', memories);

      expect(result[0].score).toBe(0); // 0 * 1.8 = 0
    });
  });

  // ─── getWeights ──────────────────────────────────────────────────────────────

  describe('getWeights', () => {
    it('returns mapped weight results ordered by weight desc', async () => {
      prisma.experienceWeight.findMany.mockResolvedValue([
        {
          category: 'deploy',
          successCount: 20,
          totalCount: 22,
          weight: 1.8,
        },
        {
          category: 'testing',
          successCount: 5,
          totalCount: 6,
          weight: 1.3,
        },
      ] as any);

      const result = await service.getWeights('user1');

      expect(result).toEqual([
        { category: 'deploy', successCount: 20, totalCount: 22, weight: 1.8 },
        { category: 'testing', successCount: 5, totalCount: 6, weight: 1.3 },
      ]);
      expect(prisma.experienceWeight.findMany).toHaveBeenCalledWith({
        where: { userId: 'user1' },
        orderBy: { weight: 'desc' },
      });
    });

    it('returns empty array when no weights exist', async () => {
      prisma.experienceWeight.findMany.mockResolvedValue([]);

      const result = await service.getWeights('user1');

      expect(result).toEqual([]);
    });

    it('filters by agentId when provided', async () => {
      prisma.experienceWeight.findMany.mockResolvedValue([]);

      await service.getWeights('user1', { agentId: 'agent-42' });

      expect(prisma.experienceWeight.findMany).toHaveBeenCalledWith({
        where: { userId: 'user1', agentId: 'agent-42' },
        orderBy: { weight: 'desc' },
      });
    });

    it('propagates prisma errors', async () => {
      prisma.experienceWeight.findMany.mockRejectedValue(new Error('DB down'));

      await expect(service.getWeights('user1')).rejects.toThrow('DB down');
    });
  });
});
