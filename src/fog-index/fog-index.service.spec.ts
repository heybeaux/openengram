import { Test, TestingModule } from '@nestjs/testing';
import { FogIndexService } from './fog-index.service';
import { PrismaService } from '../prisma/prisma.service';

describe('FogIndexService', () => {
  let service: FogIndexService;
  let prisma: any;

  const mockPrisma = {
    memory: {
      count: jest.fn(),
      findFirst: jest.fn(),
      groupBy: jest.fn(),
      aggregate: jest.fn(),
    },
    mergeCandidate: {
      count: jest.fn(),
    },
    dreamCycleReport: {
      findFirst: jest.fn(),
    },
    $queryRawUnsafe: jest.fn(),
    $executeRawUnsafe: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FogIndexService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<FogIndexService>(FogIndexService);
    prisma = module.get(PrismaService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('getTier', () => {
    it('should return Crystal for 90-100', () => {
      expect(FogIndexService.getTier(100)).toBe('Crystal');
      expect(FogIndexService.getTier(95)).toBe('Crystal');
      expect(FogIndexService.getTier(90)).toBe('Crystal');
    });

    it('should return Clear for 75-89', () => {
      expect(FogIndexService.getTier(89)).toBe('Clear');
      expect(FogIndexService.getTier(75)).toBe('Clear');
    });

    it('should return Haze for 60-74', () => {
      expect(FogIndexService.getTier(74)).toBe('Haze');
      expect(FogIndexService.getTier(60)).toBe('Haze');
    });

    it('should return Mist for 40-59', () => {
      expect(FogIndexService.getTier(59)).toBe('Mist');
      expect(FogIndexService.getTier(40)).toBe('Mist');
    });

    it('should return Fog for 20-39', () => {
      expect(FogIndexService.getTier(39)).toBe('Fog');
      expect(FogIndexService.getTier(20)).toBe('Fog');
    });

    it('should return Dense Fog for 0-19', () => {
      expect(FogIndexService.getTier(19)).toBe('Dense Fog');
      expect(FogIndexService.getTier(0)).toBe('Dense Fog');
    });
  });

  describe('compute', () => {
    it('should return empty result when no users found', async () => {
      prisma.memory.findFirst.mockResolvedValue(null);

      const result = await service.compute();

      expect(result.score).toBe(0);
      expect(result.tier).toBe('Dense Fog');
      expect(result.components).toEqual([]);
    });

    it('should compute a score with all components', async () => {
      // Mock resolveDefaultUserId
      prisma.memory.findFirst.mockResolvedValue({ userId: 'user-1' });

      // Mock memoryStaleness
      prisma.memory.count
        .mockResolvedValueOnce(100) // total memories (staleness)
        .mockResolvedValueOnce(40) // accessed memories
        // embeddingCoverage
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(90) // with legacy embeddings
        // dedupDensity
        .mockResolvedValueOnce(100); // total for dedup

      // embeddingCoverage ensemble query
      prisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(85) }]);

      // dedupDensity
      prisma.mergeCandidate.count.mockResolvedValue(2);

      // consolidationHealth
      prisma.dreamCycleReport.findFirst.mockResolvedValue({
        completedAt: new Date(Date.now() - 12 * 60 * 60 * 1000), // 12h ago
        status: 'COMPLETED',
        startedAt: new Date(),
      });

      // memoryDecayRate
      prisma.memory.count
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(5) // decayed
        .mockResolvedValueOnce(3); // low score

      // coverageGaps
      prisma.memory.count.mockResolvedValueOnce(100); // total
      prisma.memory.groupBy
        .mockResolvedValueOnce([
          // type counts
          { memoryType: 'FACT', _count: 40 },
          { memoryType: 'PREFERENCE', _count: 20 },
          { memoryType: 'EVENT', _count: 30 },
          { memoryType: 'LESSON', _count: 10 },
        ])
        .mockResolvedValueOnce([
          // layer counts
          { layer: 'IDENTITY', _count: 30 },
          { layer: 'SESSION', _count: 50 },
          { layer: 'PROJECT', _count: 20 },
        ]);

      const result = await service.compute();

      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.tier).toBeDefined();
      expect(result.components).toHaveLength(6);
      expect(result.computedAt).toBeDefined();

      // Verify component names
      const names = result.components.map((c) => c.name);
      expect(names).toContain('Memory Freshness');
      expect(names).toContain('Embedding Coverage');
      expect(names).toContain('Dedup Health');
      expect(names).toContain('Consolidation Health');
      expect(names).toContain('Memory Vitality');
      expect(names).toContain('Coverage Breadth');
    });

    it('should accept a specific userId', async () => {
      prisma.memory.count.mockResolvedValue(0);
      prisma.mergeCandidate.count.mockResolvedValue(0);
      prisma.dreamCycleReport.findFirst.mockResolvedValue(null);
      prisma.memory.groupBy.mockResolvedValue([]);
      prisma.$queryRawUnsafe.mockResolvedValue([{ count: BigInt(0) }]);

      const result = await service.compute('specific-user');
      expect(result).toBeDefined();
      // Should not call findFirst to resolve user
      expect(prisma.memory.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('snapshot', () => {
    it('should compute and persist a snapshot', async () => {
      prisma.memory.findFirst.mockResolvedValue({ userId: 'user-1' });
      prisma.memory.count.mockResolvedValue(0);
      prisma.mergeCandidate.count.mockResolvedValue(0);
      prisma.dreamCycleReport.findFirst.mockResolvedValue(null);
      prisma.memory.groupBy.mockResolvedValue([]);
      prisma.$queryRawUnsafe.mockResolvedValue([{ count: BigInt(0) }]);
      prisma.$executeRawUnsafe.mockResolvedValue(undefined);

      const result = await service.snapshot();

      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO fog_index_snapshots'),
        expect.any(Number),
        expect.any(String),
        expect.any(String),
      );
      expect(result.score).toBeDefined();
    });
  });

  describe('getHistory', () => {
    it('should return historical snapshots', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([
        {
          score: 85,
          tier: 'Clear',
          computed_at: new Date('2026-02-10T10:00:00Z'),
        },
        {
          score: 72,
          tier: 'Haze',
          computed_at: new Date('2026-02-09T10:00:00Z'),
        },
      ]);

      const history = await service.getHistory(10);

      expect(history).toHaveLength(2);
      expect(history[0].score).toBe(85);
      expect(history[0].tier).toBe('Clear');
      expect(history[0].computedAt).toContain('2026-02-10');
    });
  });
});
