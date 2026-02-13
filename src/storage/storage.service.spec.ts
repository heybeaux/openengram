import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';
import { PrismaPostgresProvider } from './prisma-postgres.provider';
import { SqliteProvider } from './sqlite.provider';

const mockPrismaPostgresProvider = {
  name: 'prisma-postgres',
  createMemory: jest.fn(),
  getMemory: jest.fn(),
  updateMemory: jest.fn(),
  incrementMemory: jest.fn(),
  deleteMemory: jest.fn(),
  findMemories: jest.fn(),
  countMemories: jest.fn(),
  updateManyMemories: jest.fn(),
  incrementManyMemories: jest.fn(),
  vectorSearch: jest.fn(),
  getMemoryEmbedding: jest.fn(),
  bulkCreate: jest.fn(),
  bulkUpdate: jest.fn(),
  getStats: jest.fn(),
  groupBy: jest.fn(),
  aggregate: jest.fn(),
  createMergeCandidate: jest.fn(),
  healthCheck: jest.fn().mockResolvedValue({ healthy: true, latencyMs: 1, provider: 'prisma-postgres' }),
};

const mockSqliteProvider = {
  name: 'sqlite',
  createMemory: jest.fn(),
  getMemory: jest.fn(),
  updateMemory: jest.fn(),
  incrementMemory: jest.fn(),
  deleteMemory: jest.fn(),
  findMemories: jest.fn(),
  countMemories: jest.fn(),
  updateManyMemories: jest.fn(),
  incrementManyMemories: jest.fn(),
  vectorSearch: jest.fn(),
  getMemoryEmbedding: jest.fn(),
  bulkCreate: jest.fn(),
  bulkUpdate: jest.fn(),
  getStats: jest.fn(),
  groupBy: jest.fn(),
  aggregate: jest.fn(),
  createMergeCandidate: jest.fn(),
  healthCheck: jest.fn().mockResolvedValue({ healthy: true, latencyMs: 1, provider: 'sqlite' }),
};

describe('StorageService', () => {
  let service: StorageService;

  describe('with prisma-postgres provider (default)', () => {
    beforeEach(async () => {
      jest.clearAllMocks();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StorageService,
          { provide: PrismaPostgresProvider, useValue: mockPrismaPostgresProvider },
          { provide: SqliteProvider, useValue: mockSqliteProvider },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue?: any) => {
                const config: Record<string, any> = {};
                return config[key] ?? defaultValue;
              }),
            },
          },
        ],
      }).compile();

      service = module.get<StorageService>(StorageService);
    });

    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should use prisma-postgres provider by default', () => {
      expect(service.getProviderName()).toBe('prisma-postgres');
    });

    it('should delegate createMemory', async () => {
      const data = { userId: 'u1', raw: 'test', layer: 'IDENTITY' as any };
      const mockResult = { id: 'm1', ...data };
      mockPrismaPostgresProvider.createMemory.mockResolvedValue(mockResult);

      const result = await service.createMemory(data);
      expect(result).toEqual(mockResult);
      expect(mockPrismaPostgresProvider.createMemory).toHaveBeenCalledWith(data);
    });

    it('should delegate getMemory', async () => {
      const mockResult = { id: 'm1', raw: 'test' };
      mockPrismaPostgresProvider.getMemory.mockResolvedValue(mockResult);

      const result = await service.getMemory('m1');
      expect(result).toEqual(mockResult);
      expect(mockPrismaPostgresProvider.getMemory).toHaveBeenCalledWith('m1', undefined);
    });

    it('should delegate getMemory with include', async () => {
      const include = { extraction: true };
      mockPrismaPostgresProvider.getMemory.mockResolvedValue(null);

      await service.getMemory('m1', include);
      expect(mockPrismaPostgresProvider.getMemory).toHaveBeenCalledWith('m1', include);
    });

    it('should delegate updateMemory', async () => {
      const data = { raw: 'updated' };
      const mockResult = { id: 'm1', raw: 'updated' };
      mockPrismaPostgresProvider.updateMemory.mockResolvedValue(mockResult);

      const result = await service.updateMemory('m1', data);
      expect(result).toEqual(mockResult);
      expect(mockPrismaPostgresProvider.updateMemory).toHaveBeenCalledWith('m1', data);
    });

    it('should delegate incrementMemory', async () => {
      const increments = { usedCount: 1 };
      const data = { lastUsedAt: new Date() };
      mockPrismaPostgresProvider.incrementMemory.mockResolvedValue({ id: 'm1' });

      await service.incrementMemory('m1', increments, data);
      expect(mockPrismaPostgresProvider.incrementMemory).toHaveBeenCalledWith('m1', increments, data);
    });

    it('should delegate deleteMemory', async () => {
      mockPrismaPostgresProvider.deleteMemory.mockResolvedValue(undefined);

      await service.deleteMemory('m1');
      expect(mockPrismaPostgresProvider.deleteMemory).toHaveBeenCalledWith('m1');
    });

    it('should delegate findMemories', async () => {
      const filters = { userId: 'u1', deletedAt: null as null };
      const pagination = { limit: 10 };
      mockPrismaPostgresProvider.findMemories.mockResolvedValue([]);

      const result = await service.findMemories(filters, pagination);
      expect(result).toEqual([]);
      expect(mockPrismaPostgresProvider.findMemories).toHaveBeenCalledWith(filters, pagination, undefined);
    });

    it('should delegate countMemories', async () => {
      mockPrismaPostgresProvider.countMemories.mockResolvedValue(42);

      const result = await service.countMemories({ userId: 'u1' });
      expect(result).toBe(42);
    });

    it('should delegate vectorSearch', async () => {
      const embedding = [0.1, 0.2, 0.3];
      const options = { limit: 5, threshold: 0.7 };
      const mockResults = [{ id: 'm1', score: 0.95 }];
      mockPrismaPostgresProvider.vectorSearch.mockResolvedValue(mockResults);

      const result = await service.vectorSearch(embedding, options);
      expect(result).toEqual(mockResults);
      expect(mockPrismaPostgresProvider.vectorSearch).toHaveBeenCalledWith(embedding, options);
    });

    it('should delegate bulkCreate', async () => {
      const data = [
        { userId: 'u1', raw: 'a', layer: 'IDENTITY' as any },
        { userId: 'u1', raw: 'b', layer: 'SESSION' as any },
      ];
      mockPrismaPostgresProvider.bulkCreate.mockResolvedValue(data.map((d, i) => ({ id: `m${i}`, ...d })));

      const result = await service.bulkCreate(data);
      expect(result).toHaveLength(2);
    });

    it('should delegate bulkUpdate', async () => {
      const updates = [{ id: 'm1', data: { raw: 'updated' } }];
      mockPrismaPostgresProvider.bulkUpdate.mockResolvedValue(1);

      const result = await service.bulkUpdate(updates);
      expect(result).toBe(1);
    });

    it('should delegate getStats', async () => {
      const stats = { totalMemories: 100, activeMemories: 90, deletedMemories: 10, consolidatedMemories: 5, layerDistribution: { IDENTITY: 30 } };
      mockPrismaPostgresProvider.getStats.mockResolvedValue(stats);

      const result = await service.getStats('u1');
      expect(result).toEqual(stats);
    });

    it('should delegate groupBy', async () => {
      mockPrismaPostgresProvider.groupBy.mockResolvedValue([{ value: 'IDENTITY', count: 30 }]);

      const result = await service.groupBy('layer', { userId: 'u1' });
      expect(result).toEqual([{ value: 'IDENTITY', count: 30 }]);
    });

    it('should delegate aggregate', async () => {
      mockPrismaPostgresProvider.aggregate.mockResolvedValue(0.75);

      const result = await service.aggregate('importanceScore', 'avg', { userId: 'u1' });
      expect(result).toBe(0.75);
    });

    it('should delegate createMergeCandidate', async () => {
      const data = { userId: 'u1', memoryIds: ['m1', 'm2'], similarity: 0.95, suggestedStrategy: 'MERGE', suggestedSurvivorId: 'm1', status: 'PENDING' };
      mockPrismaPostgresProvider.createMergeCandidate.mockResolvedValue({ id: 'mc1', ...data });

      await service.createMergeCandidate(data);
      expect(mockPrismaPostgresProvider.createMergeCandidate).toHaveBeenCalledWith(data);
    });

    it('should delegate healthCheck', async () => {
      const result = await service.healthCheck();
      expect(result.healthy).toBe(true);
      expect(result.provider).toBe('prisma-postgres');
    });

    it('should delegate updateManyMemories', async () => {
      mockPrismaPostgresProvider.updateManyMemories.mockResolvedValue(5);

      const result = await service.updateManyMemories(
        { ids: ['m1', 'm2'], deletedAt: null },
        { retrievalCount: 0 },
      );
      expect(result).toBe(5);
    });

    it('should delegate incrementManyMemories', async () => {
      mockPrismaPostgresProvider.incrementManyMemories.mockResolvedValue(3);

      const result = await service.incrementManyMemories(
        { ids: ['m1', 'm2', 'm3'] },
        { retrievalCount: 1 },
        { lastRetrievedAt: new Date() },
      );
      expect(result).toBe(3);
    });

    it('should delegate getMemoryEmbedding', async () => {
      mockPrismaPostgresProvider.getMemoryEmbedding.mockResolvedValue([0.1, 0.2]);

      const result = await service.getMemoryEmbedding('m1');
      expect(result).toEqual([0.1, 0.2]);
    });

    it('should expose the underlying provider', () => {
      expect(service.getProvider()).toBe(mockPrismaPostgresProvider);
    });
  });

  describe('with sqlite provider', () => {
    beforeEach(async () => {
      jest.clearAllMocks();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StorageService,
          { provide: PrismaPostgresProvider, useValue: mockPrismaPostgresProvider },
          { provide: SqliteProvider, useValue: mockSqliteProvider },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue?: any) => {
                const config: Record<string, any> = {
                  STORAGE_PROVIDER: 'sqlite',
                };
                return config[key] ?? defaultValue;
              }),
            },
          },
        ],
      }).compile();

      service = module.get<StorageService>(StorageService);
    });

    it('should use sqlite provider', () => {
      expect(service.getProviderName()).toBe('sqlite');
    });

    it('should delegate to sqlite provider', async () => {
      mockSqliteProvider.createMemory.mockResolvedValue({ id: 'm1' });

      await service.createMemory({ userId: 'u1', raw: 'test', layer: 'IDENTITY' as any });
      expect(mockSqliteProvider.createMemory).toHaveBeenCalled();
      expect(mockPrismaPostgresProvider.createMemory).not.toHaveBeenCalled();
    });
  });

  describe('with unknown provider', () => {
    beforeEach(async () => {
      jest.clearAllMocks();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StorageService,
          { provide: PrismaPostgresProvider, useValue: mockPrismaPostgresProvider },
          { provide: SqliteProvider, useValue: mockSqliteProvider },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue?: any) => {
                const config: Record<string, any> = {
                  STORAGE_PROVIDER: 'unknown-provider',
                };
                return config[key] ?? defaultValue;
              }),
            },
          },
        ],
      }).compile();

      service = module.get<StorageService>(StorageService);
    });

    it('should fall back to prisma-postgres provider', () => {
      expect(service.getProviderName()).toBe('prisma-postgres');
    });
  });
});
