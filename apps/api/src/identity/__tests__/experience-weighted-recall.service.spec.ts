import { Test, TestingModule } from '@nestjs/testing';
import { ExperienceWeightedRecallService } from '../experience-weighted-recall.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MemoryWithScore } from '../../memory/memory.types';

describe('ExperienceWeightedRecallService', () => {
  let service: ExperienceWeightedRecallService;
  let prisma: {
    experienceWeight: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      upsert: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      experienceWeight: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({ id: 'ew-1' }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExperienceWeightedRecallService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ExperienceWeightedRecallService);
  });

  describe('calculateWeight', () => {
    it('should return 1.0 for zero successes', () => {
      expect(service.calculateWeight(0)).toBe(1.0);
    });

    it('should return > 1.0 for positive successes', () => {
      expect(service.calculateWeight(5)).toBeGreaterThan(1.0);
    });

    it('should increase with more successes', () => {
      const w5 = service.calculateWeight(5);
      const w20 = service.calculateWeight(20);
      const w50 = service.calculateWeight(50);

      expect(w20).toBeGreaterThan(w5);
      expect(w50).toBeGreaterThan(w20);
    });

    it('should approach but not exceed 2.0', () => {
      const w100 = service.calculateWeight(100);
      const w1000 = service.calculateWeight(1000);

      expect(w100).toBeLessThanOrEqual(2.0);
      expect(w1000).toBeLessThanOrEqual(2.0);
      expect(w1000).toBeGreaterThan(1.95);
    });

    it('should be approximately 1.8 at 20 successes', () => {
      const w20 = service.calculateWeight(20);
      expect(w20).toBeGreaterThan(1.5);
      expect(w20).toBeLessThan(2.0);
    });
  });

  describe('updateWeight', () => {
    it('should create new weight for first signal', async () => {
      await service.updateWeight('user-1', 'deploy', true);

      expect(prisma.experienceWeight.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            userId: 'user-1',
            category: 'deploy',
            successCount: 1,
            totalCount: 1,
          }),
        }),
      );
    });

    it('should increment counts on existing weight', async () => {
      prisma.experienceWeight.findUnique.mockResolvedValue({
        successCount: 5,
        totalCount: 8,
      });

      await service.updateWeight('user-1', 'deploy', true);

      expect(prisma.experienceWeight.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            successCount: 6,
            totalCount: 9,
          }),
        }),
      );
    });

    it('should not increment successCount for failures', async () => {
      prisma.experienceWeight.findUnique.mockResolvedValue({
        successCount: 5,
        totalCount: 8,
      });

      await service.updateWeight('user-1', 'deploy', false);

      expect(prisma.experienceWeight.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            successCount: 5, // unchanged
            totalCount: 9,
          }),
        }),
      );
    });
  });

  describe('applyWeights', () => {
    const makeMemory = (
      id: string,
      score: number,
      topics: string[],
    ): MemoryWithScore =>
      ({
        id,
        score,
        extraction: { topics },
      }) as any;

    it('should return memories unchanged when no weights exist', async () => {
      const memories = [makeMemory('m1', 0.8, ['deploy'])];

      const result = await service.applyWeights('user-1', memories);

      expect(result[0].score).toBe(0.8);
    });

    it('should boost memories matching high-experience categories', async () => {
      prisma.experienceWeight.findMany.mockResolvedValue([
        { category: 'deploy', weight: 1.8 },
      ]);

      const memories = [
        makeMemory('m1', 0.8, ['deploy']),
        makeMemory('m2', 0.9, ['testing']),
      ];

      const result = await service.applyWeights('user-1', memories);

      expect(result[0].score).toBeCloseTo(0.8 * 1.8);
      expect(result[1].score).toBe(0.9); // No boost for testing
    });

    it('should use the highest matching weight from multiple topics', async () => {
      prisma.experienceWeight.findMany.mockResolvedValue([
        { category: 'deploy', weight: 1.8 },
        { category: 'testing', weight: 1.3 },
      ]);

      const memories = [makeMemory('m1', 0.5, ['deploy', 'testing'])];

      const result = await service.applyWeights('user-1', memories);

      // Should use deploy weight (1.8) not testing weight (1.3)
      expect(result[0].score).toBeCloseTo(0.5 * 1.8);
    });

    it('should not boost memories without extraction topics', async () => {
      prisma.experienceWeight.findMany.mockResolvedValue([
        { category: 'deploy', weight: 1.8 },
      ]);

      const memories = [{ id: 'm1', score: 0.8 } as any];

      const result = await service.applyWeights('user-1', memories);

      expect(result[0].score).toBe(0.8);
    });
  });

  describe('getWeights', () => {
    it('should return weights ordered by weight desc', async () => {
      prisma.experienceWeight.findMany.mockResolvedValue([
        { category: 'deploy', successCount: 20, totalCount: 25, weight: 1.8 },
        { category: 'testing', successCount: 5, totalCount: 8, weight: 1.3 },
      ]);

      const result = await service.getWeights('user-1');

      expect(result).toHaveLength(2);
      expect(result[0].category).toBe('deploy');
      expect(result[0].weight).toBe(1.8);
    });
  });
});
