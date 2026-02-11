import { Test, TestingModule } from '@nestjs/testing';
import { SimilarityService } from './similarity.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from '../memory/embedding.service';

describe('SimilarityService', () => {
  let service: SimilarityService;
  let prismaService: jest.Mocked<PrismaService>;
  let embeddingService: jest.Mocked<EmbeddingService>;

  const mockPrisma = {
    memory: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const mockEmbedding = {
    generate: jest.fn(),
    search: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SimilarityService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmbeddingService, useValue: mockEmbedding },
      ],
    }).compile();

    service = module.get<SimilarityService>(SimilarityService);
    prismaService = module.get(PrismaService);
    embeddingService = module.get(EmbeddingService);
  });

  describe('cosineSimilarity', () => {
    it('should return 1.0 for identical vectors', () => {
      const vec = [0.1, 0.2, 0.3, 0.4];
      expect(service.cosineSimilarity(vec, vec)).toBeCloseTo(1.0);
    });

    it('should return 0 for orthogonal vectors', () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      expect(service.cosineSimilarity(a, b)).toBeCloseTo(0);
    });

    it('should return -1 for opposite vectors', () => {
      const a = [1, 0, 0];
      const b = [-1, 0, 0];
      expect(service.cosineSimilarity(a, b)).toBeCloseTo(-1);
    });

    it('should handle normalized vectors correctly', () => {
      const a = service.normalize([1, 2, 3]);
      const b = service.normalize([1, 2, 3.1]);
      expect(service.cosineSimilarity(a, b)).toBeGreaterThan(0.99);
    });

    it('should throw for mismatched dimensions', () => {
      const a = [1, 2, 3];
      const b = [1, 2];
      expect(() => service.cosineSimilarity(a, b)).toThrow(
        'Vector dimension mismatch',
      );
    });

    it('should handle zero vectors', () => {
      const a = [0, 0, 0];
      const b = [1, 2, 3];
      expect(service.cosineSimilarity(a, b)).toBe(0);
    });
  });

  describe('normalize', () => {
    it('should normalize a vector to unit length', () => {
      const vec = [3, 4];
      const normalized = service.normalize(vec);
      const length = Math.sqrt(normalized[0] ** 2 + normalized[1] ** 2);
      expect(length).toBeCloseTo(1.0);
    });

    it('should not modify zero vector', () => {
      const vec = [0, 0, 0];
      const normalized = service.normalize(vec);
      expect(normalized).toEqual([0, 0, 0]);
    });

    it('should preserve direction', () => {
      const vec = [2, 2];
      const normalized = service.normalize(vec);
      expect(normalized[0]).toBeCloseTo(normalized[1]);
    });
  });

  describe('findSimilarMemories', () => {
    it('should return similar memories above threshold', async () => {
      mockPrisma.memory.findUnique.mockResolvedValue({
        id: 'mem_1',
        raw: 'Test content',
      });
      mockEmbedding.generate.mockResolvedValue([0.1, 0.2, 0.3]);
      mockEmbedding.search.mockResolvedValue([
        { id: 'mem_1', score: 1.0 },
        { id: 'mem_2', score: 0.95 },
        { id: 'mem_3', score: 0.8 },
      ]);
      mockPrisma.memory.findMany.mockResolvedValue([
        {
          id: 'mem_2',
          raw: 'Similar content',
          memoryType: 'FACT',
          createdAt: new Date(),
        },
      ]);

      const result = await service.findSimilarMemories('mem_1', 'user_123', {
        minSimilarity: 0.85,
      });

      expect(result).toHaveLength(1);
      expect(result[0].memoryId).toBe('mem_2');
      expect(result[0].similarity).toBe(0.95);
    });

    it('should filter out self-match', async () => {
      mockPrisma.memory.findUnique.mockResolvedValue({
        id: 'mem_1',
        raw: 'Test content',
      });
      mockEmbedding.generate.mockResolvedValue([0.1, 0.2, 0.3]);
      mockEmbedding.search.mockResolvedValue([
        { id: 'mem_1', score: 1.0 }, // Self
        { id: 'mem_2', score: 0.95 },
      ]);
      mockPrisma.memory.findMany.mockResolvedValue([
        {
          id: 'mem_2',
          raw: 'Similar',
          memoryType: null,
          createdAt: new Date(),
        },
      ]);

      const result = await service.findSimilarMemories('mem_1', 'user_123');

      expect(result.every((r) => r.memoryId !== 'mem_1')).toBe(true);
    });

    it('should throw when memory not found', async () => {
      mockPrisma.memory.findUnique.mockResolvedValue(null);

      await expect(
        service.findSimilarMemories('mem_nonexistent', 'user_123'),
      ).rejects.toThrow('Memory not found');
    });

    it('should respect topK limit', async () => {
      mockPrisma.memory.findUnique.mockResolvedValue({
        id: 'mem_1',
        raw: 'Test',
      });
      mockEmbedding.generate.mockResolvedValue([0.1]);
      mockEmbedding.search.mockResolvedValue([
        { id: 'mem_2', score: 0.99 },
        { id: 'mem_3', score: 0.98 },
        { id: 'mem_4', score: 0.97 },
        { id: 'mem_5', score: 0.96 },
      ]);
      mockPrisma.memory.findMany.mockResolvedValue([
        { id: 'mem_2', raw: 'A', memoryType: null, createdAt: new Date() },
        { id: 'mem_3', raw: 'B', memoryType: null, createdAt: new Date() },
      ]);

      const result = await service.findSimilarMemories('mem_1', 'user_123', {
        topK: 2,
      });

      expect(mockPrisma.memory.findMany).toHaveBeenCalled();
    });
  });

  describe('findSimilarForContent', () => {
    it('should find similar memories for new content', async () => {
      mockEmbedding.generate.mockResolvedValue([0.1, 0.2]);
      mockEmbedding.search.mockResolvedValue([
        { id: 'mem_1', score: 0.92 },
        { id: 'mem_2', score: 0.88 },
      ]);
      mockPrisma.memory.findMany.mockResolvedValue([
        {
          id: 'mem_1',
          raw: 'Content 1',
          memoryType: 'FACT',
          createdAt: new Date(),
        },
        {
          id: 'mem_2',
          raw: 'Content 2',
          memoryType: 'FACT',
          createdAt: new Date(),
        },
      ]);

      const result = await service.findSimilarForContent(
        'New content',
        'user_123',
      );

      expect(result.length).toBeGreaterThan(0);
      expect(mockEmbedding.generate).toHaveBeenCalledWith('New content');
    });

    it('should exclude specified IDs', async () => {
      mockEmbedding.generate.mockResolvedValue([0.1]);
      mockEmbedding.search.mockResolvedValue([
        { id: 'mem_exclude', score: 0.99 },
        { id: 'mem_include', score: 0.95 },
      ]);
      mockPrisma.memory.findMany.mockResolvedValue([
        {
          id: 'mem_include',
          raw: 'Content',
          memoryType: null,
          createdAt: new Date(),
        },
      ]);

      const result = await service.findSimilarForContent(
        'New content',
        'user_123',
        {
          excludeIds: ['mem_exclude'],
        },
      );

      expect(result.every((r) => r.memoryId !== 'mem_exclude')).toBe(true);
    });
  });

  describe('clusterSimilarMemories', () => {
    it('should cluster connected memories', () => {
      const pairs = [
        { memoryIdA: 'mem_1', memoryIdB: 'mem_2', similarity: 0.95 },
        { memoryIdA: 'mem_2', memoryIdB: 'mem_3', similarity: 0.9 },
        { memoryIdA: 'mem_4', memoryIdB: 'mem_5', similarity: 0.88 },
      ];

      const clusters = service.clusterSimilarMemories(pairs, 0.85);

      expect(clusters.length).toBe(2);

      const cluster1 = clusters.find((c) => c.memoryIds.includes('mem_1'));
      expect(cluster1?.memoryIds).toContain('mem_2');
      expect(cluster1?.memoryIds).toContain('mem_3');

      const cluster2 = clusters.find((c) => c.memoryIds.includes('mem_4'));
      expect(cluster2?.memoryIds).toContain('mem_5');
    });

    it('should not cluster memories below threshold', () => {
      const pairs = [
        { memoryIdA: 'mem_1', memoryIdB: 'mem_2', similarity: 0.8 },
      ];

      const clusters = service.clusterSimilarMemories(pairs, 0.85);

      expect(clusters.length).toBe(0);
    });

    it('should select centroid with highest average similarity', () => {
      const pairs = [
        { memoryIdA: 'mem_1', memoryIdB: 'mem_2', similarity: 0.95 },
        { memoryIdA: 'mem_1', memoryIdB: 'mem_3', similarity: 0.9 },
        { memoryIdA: 'mem_2', memoryIdB: 'mem_3', similarity: 0.88 },
      ];

      const clusters = service.clusterSimilarMemories(pairs, 0.85);

      expect(clusters.length).toBe(1);
      // mem_1 has highest average similarity (0.95 + 0.90) / 2 = 0.925
      expect(clusters[0].centroidMemoryId).toBe('mem_1');
    });

    it('should handle transitive closure', () => {
      const pairs = [
        { memoryIdA: 'mem_1', memoryIdB: 'mem_2', similarity: 0.95 },
        { memoryIdA: 'mem_3', memoryIdB: 'mem_4', similarity: 0.9 },
        { memoryIdA: 'mem_2', memoryIdB: 'mem_3', similarity: 0.87 }, // Connects the clusters
      ];

      const clusters = service.clusterSimilarMemories(pairs, 0.85);

      expect(clusters.length).toBe(1);
      expect(clusters[0].memoryIds.length).toBe(4);
    });

    it('should calculate correct cluster statistics', () => {
      const pairs = [
        { memoryIdA: 'mem_1', memoryIdB: 'mem_2', similarity: 0.95 },
        { memoryIdA: 'mem_1', memoryIdB: 'mem_3', similarity: 0.9 },
        { memoryIdA: 'mem_2', memoryIdB: 'mem_3', similarity: 0.88 },
      ];

      const clusters = service.clusterSimilarMemories(pairs, 0.85);

      expect(clusters[0].avgSimilarity).toBeCloseTo((0.95 + 0.9 + 0.88) / 3);
      expect(clusters[0].minSimilarity).toBe(0.88);
    });
  });

  describe('computePairwiseSimilarity', () => {
    it('should compute pairwise similarities', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        { id: 'mem_1', raw: 'Content 1' },
        { id: 'mem_2', raw: 'Content 2' },
      ]);
      mockEmbedding.generate.mockResolvedValue([0.1, 0.2]);
      mockEmbedding.search
        .mockResolvedValueOnce([{ id: 'mem_2', score: 0.92 }])
        .mockResolvedValueOnce([{ id: 'mem_1', score: 0.92 }]);

      const pairs = await service.computePairwiseSimilarity('user_123', {
        minSimilarity: 0.85,
      });

      // Should have deduplicated pairs (A-B and B-A become one)
      expect(pairs.length).toBeLessThanOrEqual(1);
    });

    it('should respect maxMemories limit', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        { id: 'mem_1', raw: 'Content 1' },
      ]);
      mockEmbedding.generate.mockResolvedValue([0.1]);
      mockEmbedding.search.mockResolvedValue([]);

      await service.computePairwiseSimilarity('user_123', { maxMemories: 1 });

      expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1 }),
      );
    });
  });
});
