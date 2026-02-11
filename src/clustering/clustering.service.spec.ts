import { Test, TestingModule } from '@nestjs/testing';
import { ClusteringService } from './clustering.service';
import { PrismaService } from '../prisma/prisma.service';
import { LLMService } from '../llm/llm.service';

describe('ClusteringService', () => {
  let service: ClusteringService;
  let prisma: jest.Mocked<PrismaService>;
  let llm: jest.Mocked<LLMService>;

  beforeEach(async () => {
    const mockPrisma = {
      memory: {
        findMany: jest.fn(),
      },
      $queryRawUnsafe: jest.fn(),
      $executeRawUnsafe: jest.fn(),
    };

    const mockLlm = {
      json: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClusteringService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LLMService, useValue: mockLlm },
      ],
    }).compile();

    service = module.get<ClusteringService>(ClusteringService);
    prisma = module.get(PrismaService);
    llm = module.get(LLMService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('run', () => {
    it('should return early with 0 clusters when no memories exist', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.run({ userId: 'user1' });

      expect(result.clustersCreated).toBe(0);
      expect(result.memoriesTotal).toBe(0);
      expect(result.noisePoints).toBe(0);
    });

    it('should return early when memories < minPoints', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([
        { memory_id: 'm1' },
        { memory_id: 'm2' },
      ]);

      const result = await service.run({ userId: 'user1', minPoints: 3 });

      expect(result.clustersCreated).toBe(0);
      expect(result.memoriesTotal).toBe(2);
    });

    it('should support dry run mode', async () => {
      // 4 memories, all close to each other
      (prisma.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([
          { memory_id: 'm1' },
          { memory_id: 'm2' },
          { memory_id: 'm3' },
          { memory_id: 'm4' },
        ])
        // findNeighbors for m1 -> returns m2, m3, m4
        .mockResolvedValueOnce([
          { memory_id: 'm2', distance: 0.1 },
          { memory_id: 'm3', distance: 0.15 },
          { memory_id: 'm4', distance: 0.2 },
        ])
        // findNeighbors for m2 -> returns m1, m3, m4
        .mockResolvedValueOnce([
          { memory_id: 'm1', distance: 0.1 },
          { memory_id: 'm3', distance: 0.12 },
          { memory_id: 'm4', distance: 0.18 },
        ])
        // findNeighbors for m3 -> returns m1, m2, m4
        .mockResolvedValueOnce([
          { memory_id: 'm1', distance: 0.15 },
          { memory_id: 'm2', distance: 0.12 },
          { memory_id: 'm4', distance: 0.14 },
        ])
        // findNeighbors for m4 -> returns m1, m2, m3
        .mockResolvedValueOnce([
          { memory_id: 'm1', distance: 0.2 },
          { memory_id: 'm2', distance: 0.18 },
          { memory_id: 'm3', distance: 0.14 },
        ]);

      const result = await service.run({ userId: 'user1', dryRun: true, minPoints: 3 });

      expect(result.dryRun).toBe(true);
      expect(result.clustersCreated).toBe(1);
      expect(result.memoriesClustered).toBe(4);
      expect(result.noisePoints).toBe(0);
      // No DB writes in dry run
      expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });
  });

  describe('listClusters', () => {
    it('should return formatted cluster list', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([
        { id: 'c1', label: 'Test Cluster', description: 'A test', member_count: 5, created_at: new Date(), updated_at: new Date() },
      ]);

      const clusters = await service.listClusters();

      expect(clusters).toHaveLength(1);
      expect(clusters[0].label).toBe('Test Cluster');
      expect(clusters[0].memberCount).toBe(5);
    });
  });

  describe('getCluster', () => {
    it('should return null for non-existent cluster', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.getCluster('nonexistent');
      expect(result).toBeNull();
    });

    it('should return cluster with members', async () => {
      (prisma.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([
          { id: 'c1', label: 'Test', description: null, member_count: 2, created_at: new Date(), updated_at: new Date() },
        ])
        .mockResolvedValueOnce([
          { id: 'm1', raw: 'Memory 1', effective_score: 0.8, memory_type: 'FACT', created_at: new Date() },
          { id: 'm2', raw: 'Memory 2', effective_score: 0.6, memory_type: 'FACT', created_at: new Date() },
        ]);

      const result = await service.getCluster('c1');

      expect(result).not.toBeNull();
      expect(result!.label).toBe('Test');
      expect(result!.members).toHaveLength(2);
    });
  });
});
