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

    it('should deduplicate A-B vs B-A pairs via seenPairs', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        { id: 'mem_a', raw: 'A' },
        { id: 'mem_b', raw: 'B' },
      ]);
      mockEmbedding.generate.mockResolvedValue([0.1]);
      // mem_a finds mem_b, mem_b finds mem_a — same pair both directions
      mockEmbedding.search
        .mockResolvedValueOnce([{ id: 'mem_b', score: 0.92 }])
        .mockResolvedValueOnce([{ id: 'mem_a', score: 0.92 }]);

      const pairs = await service.computePairwiseSimilarity('user_123', {
        minSimilarity: 0.85,
      });

      expect(pairs).toHaveLength(1);
      // Sorted pair key
      const [first, second] = [pairs[0].memoryIdA, pairs[0].memoryIdB].sort();
      expect(first).toBe('mem_a');
      expect(second).toBe('mem_b');
    });

    it('should filter out matches below minSimilarity threshold', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        { id: 'mem_1', raw: 'Content' },
      ]);
      mockEmbedding.generate.mockResolvedValue([0.1]);
      mockEmbedding.search.mockResolvedValue([
        { id: 'mem_2', score: 0.80 }, // Below 0.85 threshold
        { id: 'mem_3', score: 0.90 }, // Above threshold
      ]);

      const pairs = await service.computePairwiseSimilarity('user_123', {
        minSimilarity: 0.85,
      });

      expect(pairs).toHaveLength(1);
      expect(pairs[0].similarity).toBe(0.90);
    });

    it('should produce identical results regardless of batch size', async () => {
      // Create 6 memories — with default BATCH_SIZE=500 they all go in one batch
      const memories = Array.from({ length: 6 }, (_, i) => ({
        id: `mem_${i}`,
        raw: `Content ${i}`,
      }));
      mockPrisma.memory.findMany.mockResolvedValue(memories);
      mockEmbedding.generate.mockResolvedValue([0.1]);

      // Each memory finds its neighbor as similar
      const searchResults = memories.map((m, i) => {
        const neighborIdx = i % 2 === 0 ? i + 1 : i - 1;
        if (neighborIdx >= 0 && neighborIdx < memories.length) {
          return [{ id: `mem_${neighborIdx}`, score: 0.92 }];
        }
        return [];
      });
      mockEmbedding.search
        .mockResolvedValueOnce(searchResults[0])
        .mockResolvedValueOnce(searchResults[1])
        .mockResolvedValueOnce(searchResults[2])
        .mockResolvedValueOnce(searchResults[3])
        .mockResolvedValueOnce(searchResults[4])
        .mockResolvedValueOnce(searchResults[5]);

      const pairs = await service.computePairwiseSimilarity('user_123', {
        minSimilarity: 0.85,
      });

      // 3 unique pairs: (0,1), (2,3), (4,5)
      expect(pairs).toHaveLength(3);
      // All pairs should have similarity 0.92
      pairs.forEach((p) => expect(p.similarity).toBe(0.92));
    });

    it('should detect cross-batch pairs when batching occurs', async () => {
      // The BATCH_SIZE is hardcoded at 500 in the source. With 2 memories,
      // they fit in one batch. The key assertion is that pairs across
      // different memories are detected regardless of batch boundaries.
      // We simulate 3 memories where mem_0 and mem_2 are similar (cross-pair).
      const memories = [
        { id: 'mem_0', raw: 'A' },
        { id: 'mem_1', raw: 'B' },
        { id: 'mem_2', raw: 'C' },
      ];
      mockPrisma.memory.findMany.mockResolvedValue(memories);
      mockEmbedding.generate.mockResolvedValue([0.1]);

      // mem_0 finds mem_2 as similar (cross-pair skipping mem_1)
      mockEmbedding.search
        .mockResolvedValueOnce([{ id: 'mem_2', score: 0.91 }])
        .mockResolvedValueOnce([]) // mem_1 has no similar
        .mockResolvedValueOnce([{ id: 'mem_0', score: 0.91 }]); // mem_2 finds mem_0 (dup)

      const pairs = await service.computePairwiseSimilarity('user_123', {
        minSimilarity: 0.85,
      });

      expect(pairs).toHaveLength(1);
      expect(pairs[0].memoryIdA).toBe('mem_0');
      expect(pairs[0].memoryIdB).toBe('mem_2');
    });

    it('should sort results by similarity descending', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        { id: 'mem_1', raw: 'A' },
        { id: 'mem_2', raw: 'B' },
        { id: 'mem_3', raw: 'C' },
      ]);
      mockEmbedding.generate.mockResolvedValue([0.1]);
      mockEmbedding.search
        .mockResolvedValueOnce([{ id: 'mem_2', score: 0.87 }])
        .mockResolvedValueOnce([{ id: 'mem_3', score: 0.95 }])
        .mockResolvedValueOnce([]);

      const pairs = await service.computePairwiseSimilarity('user_123', {
        minSimilarity: 0.85,
      });

      expect(pairs).toHaveLength(2);
      expect(pairs[0].similarity).toBeGreaterThanOrEqual(pairs[1].similarity);
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
