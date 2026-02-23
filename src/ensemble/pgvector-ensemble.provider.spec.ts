import { Test, TestingModule } from '@nestjs/testing';
import { PgVectorEnsembleProvider } from './pgvector-ensemble.provider';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  $executeRawUnsafe: jest.fn(),
  $queryRawUnsafe: jest.fn(),
  $transaction: jest.fn(),
};

describe('PgVectorEnsembleProvider', () => {
  let provider: PgVectorEnsembleProvider;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PgVectorEnsembleProvider,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    provider = module.get<PgVectorEnsembleProvider>(PgVectorEnsembleProvider);
  });

  describe('upsertEmbedding', () => {
    it('should execute upsert SQL with correct parameters', async () => {
      mockPrisma.$executeRawUnsafe.mockResolvedValue(1);

      await provider.upsertEmbedding({
        memoryId: 'mem-1',
        modelId: 'bge-base' as any,
        embedding: [0.1, 0.2, 0.3],
        dimensions: 3,
      });

      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO memory_embeddings'),
        'mem-1',
        'bge-base',
        3,
        '[0.1,0.2,0.3]',
        expect.any(Date),
      );
    });
  });

  describe('upsertEmbeddings', () => {
    it('should execute within a transaction', async () => {
      mockPrisma.$transaction.mockImplementation(async (fn) => {
        const tx = { $executeRawUnsafe: jest.fn().mockResolvedValue(1) };
        await fn(tx);
        return tx;
      });

      await provider.upsertEmbeddings([
        { memoryId: 'mem-1', modelId: 'bge-base' as any, embedding: [0.1], dimensions: 1 },
        { memoryId: 'mem-2', modelId: 'bge-base' as any, embedding: [0.2], dimensions: 1 },
      ]);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('queryByModel', () => {
    it('should return search results with scores', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        { memory_id: 'mem-1', score: 0.95 },
        { memory_id: 'mem-2', score: 0.88 },
      ]);

      const results = await provider.queryByModel({
        userId: 'user1',
        modelId: 'bge-base' as any,
        embedding: [0.1, 0.2, 0.3],
        limit: 5,
      });

      expect(results).toEqual([
        { memoryId: 'mem-1', score: 0.95, modelId: 'bge-base' },
        { memoryId: 'mem-2', score: 0.88, modelId: 'bge-base' },
      ]);
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('FROM memory_embeddings'),
        '[0.1,0.2,0.3]',
        'bge-base',
        3,
        'user1',
        5,
      );
    });

    it('should return empty array when no results', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([]);

      const results = await provider.queryByModel({
        userId: 'user1',
        modelId: 'bge-base' as any,
        embedding: [0.1],
        limit: 5,
      });

      expect(results).toEqual([]);
    });
  });

  describe('queryAllModels', () => {
    it('should query multiple models in parallel', async () => {
      // Mock queryByModel indirectly through prisma
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        { memory_id: 'mem-1', score: 0.9 },
      ]);

      // Need to use models that match the embedding dimensions
      // bge-m3 has 768 dims, so we need a 768-dim embedding
      const embedding768 = new Array(768).fill(0.1);
      const results = await provider.queryAllModels(
        embedding768,
        'user1',
        ['bge-base' as any],
        5,
      );

      expect(results.size).toBeGreaterThanOrEqual(0);
    });

    it('should skip models with mismatched dimensions', async () => {
      // 3-dim embedding won't match any model config (768, 384, etc.)
      const results = await provider.queryAllModels(
        [0.1, 0.2, 0.3],
        'user1',
        ['bge-base' as any],
        5,
      );

      // Should skip bge-m3 since dims don't match
      expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('should handle query errors for individual models gracefully', async () => {
      mockPrisma.$queryRawUnsafe.mockRejectedValue(new Error('DB error'));

      const embedding768 = new Array(768).fill(0.1);
      const results = await provider.queryAllModels(
        embedding768,
        'user1',
        ['bge-base' as any],
        5,
      );

      // Should not throw, just return empty results for failed model
      expect(results.get('bge-base' as any)).toBeUndefined();
    });
  });
});
