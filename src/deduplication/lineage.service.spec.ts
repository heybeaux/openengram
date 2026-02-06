import { Test, TestingModule } from '@nestjs/testing';
import { LineageService } from './lineage.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from '../memory/embedding.service';
import { MergeStrategy } from './dto/deduplication.dto';

describe('LineageService', () => {
  let service: LineageService;
  let prismaService: jest.Mocked<PrismaService>;
  let embeddingService: jest.Mocked<EmbeddingService>;

  const mockPrisma = {
    memory: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    memoryMergeEvent: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockEmbedding = {
    generate: jest.fn(),
    store: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LineageService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmbeddingService, useValue: mockEmbedding },
      ],
    }).compile();

    service = module.get<LineageService>(LineageService);
    prismaService = module.get(PrismaService);
    embeddingService = module.get(EmbeddingService);
  });

  describe('recordMerge', () => {
    const mockMergeResult = {
      survivorId: 'mem_survivor',
      absorbedIds: ['mem_absorbed'],
      mergedContent: 'Merged content',
      mergedMetadata: {
        importanceScore: 0.7,
        accessCount: 5,
        lastAccessedAt: null,
        tags: [],
        sources: [],
        originalSources: ['mem_survivor', 'mem_absorbed'],
      },
      strategy: MergeStrategy.KEEP_DETAILED,
      contentChanged: false,
    };

    it('should create merge event with original contents', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        { id: 'mem_absorbed', raw: 'Original absorbed content', createdAt: new Date() },
      ]);
      mockPrisma.memoryMergeEvent.create.mockResolvedValue({
        id: 'event_1',
        survivorMemoryId: 'mem_survivor',
        absorbedMemoryIds: ['mem_absorbed'],
        strategy: MergeStrategy.KEEP_DETAILED,
        similarity: 0.95,
        triggeredBy: 'auto',
        approvedBy: null,
        originalContents: JSON.stringify([]),
        mergedContent: 'Merged content',
        contentChanged: false,
        canRollback: true,
        rolledBackAt: null,
        createdAt: new Date(),
      });
      mockPrisma.memory.update.mockResolvedValue({});
      mockPrisma.memory.updateMany.mockResolvedValue({ count: 1 });
      mockEmbedding.delete.mockResolvedValue(undefined);

      const result = await service.recordMerge('user_123', mockMergeResult, 'auto', 0.95);

      expect(result.id).toBe('event_1');
      expect(mockPrisma.memoryMergeEvent.create).toHaveBeenCalled();
      expect(mockPrisma.memory.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['mem_absorbed'] } },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          supersededById: 'mem_survivor',
        }),
      });
    });

    it('should delete absorbed memories from vector store', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        { id: 'mem_absorbed', raw: 'Content', createdAt: new Date() },
      ]);
      mockPrisma.memoryMergeEvent.create.mockResolvedValue({
        id: 'event_1',
        strategy: MergeStrategy.KEEP_DETAILED,
        createdAt: new Date(),
      });
      mockPrisma.memory.update.mockResolvedValue({});
      mockPrisma.memory.updateMany.mockResolvedValue({ count: 1 });

      await service.recordMerge('user_123', mockMergeResult, 'auto', 0.95);

      expect(mockEmbedding.delete).toHaveBeenCalledWith('mem_absorbed');
    });

    it('should re-embed survivor when content changed', async () => {
      const changedResult = { ...mockMergeResult, contentChanged: true };
      mockPrisma.memory.findMany.mockResolvedValue([]);
      mockPrisma.memoryMergeEvent.create.mockResolvedValue({
        id: 'event_1',
        strategy: MergeStrategy.KEEP_DETAILED,
        createdAt: new Date(),
      });
      mockPrisma.memory.update.mockResolvedValue({});
      mockPrisma.memory.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.memory.findUnique.mockResolvedValue({
        userId: 'user_123',
        layer: 'IDENTITY',
        importanceScore: 0.7,
        createdAt: new Date(),
      });
      mockEmbedding.generate.mockResolvedValue([0.1, 0.2, 0.3]);

      await service.recordMerge('user_123', changedResult, 'auto', 0.95);

      expect(mockEmbedding.generate).toHaveBeenCalledWith('Merged content');
      expect(mockEmbedding.store).toHaveBeenCalled();
    });

    it('should record manual trigger with approver', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([]);
      mockPrisma.memoryMergeEvent.create.mockResolvedValue({
        id: 'event_1',
        approvedBy: 'approver_1',
        createdAt: new Date(),
      });
      mockPrisma.memory.update.mockResolvedValue({});
      mockPrisma.memory.updateMany.mockResolvedValue({ count: 0 });

      await service.recordMerge('user_123', mockMergeResult, 'manual', 1.0, 'approver_1');

      expect(mockPrisma.memoryMergeEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          triggeredBy: 'manual',
          approvedBy: 'approver_1',
        }),
      });
    });
  });

  describe('rollbackMerge', () => {
    it('should restore absorbed memories', async () => {
      mockPrisma.memoryMergeEvent.findUnique.mockResolvedValue({
        id: 'event_1',
        userId: 'user_123',
        survivorMemoryId: 'mem_survivor',
        absorbedMemoryIds: ['mem_absorbed'],
        originalContents: JSON.stringify([
          { memoryId: 'mem_absorbed', content: 'Original content', createdAt: new Date() },
        ]),
        contentChanged: false,
        canRollback: true,
        rolledBackAt: null,
      });
      mockPrisma.memory.update.mockResolvedValue({});
      mockPrisma.memory.findUnique.mockResolvedValue({
        userId: 'user_123',
        layer: 'IDENTITY',
        importanceScore: 0.5,
        createdAt: new Date(),
      });
      mockPrisma.memoryMergeEvent.update.mockResolvedValue({});
      mockEmbedding.generate.mockResolvedValue([0.1, 0.2]);

      const result = await service.rollbackMerge('event_1');

      expect(result.success).toBe(true);
      expect(result.restoredMemoryIds).toContain('mem_absorbed');
      expect(mockPrisma.memory.update).toHaveBeenCalledWith({
        where: { id: 'mem_absorbed' },
        data: expect.objectContaining({
          deletedAt: null,
          supersededById: null,
        }),
      });
    });

    it('should restore vector embeddings', async () => {
      mockPrisma.memoryMergeEvent.findUnique.mockResolvedValue({
        id: 'event_1',
        userId: 'user_123',
        survivorMemoryId: 'mem_survivor',
        absorbedMemoryIds: ['mem_absorbed'],
        originalContents: JSON.stringify([
          { memoryId: 'mem_absorbed', content: 'Original content', createdAt: new Date() },
        ]),
        contentChanged: false,
        canRollback: true,
        rolledBackAt: null,
      });
      mockPrisma.memory.update.mockResolvedValue({});
      mockPrisma.memory.findUnique.mockResolvedValue({
        userId: 'user_123',
        layer: 'IDENTITY',
        importanceScore: 0.5,
        createdAt: new Date(),
      });
      mockPrisma.memoryMergeEvent.update.mockResolvedValue({});
      mockEmbedding.generate.mockResolvedValue([0.1, 0.2]);

      await service.rollbackMerge('event_1');

      expect(mockEmbedding.generate).toHaveBeenCalledWith('Original content');
      expect(mockEmbedding.store).toHaveBeenCalled();
    });

    it('should throw for non-existent event', async () => {
      mockPrisma.memoryMergeEvent.findUnique.mockResolvedValue(null);

      await expect(service.rollbackMerge('nonexistent')).rejects.toThrow('Merge event not found');
    });

    it('should throw when rollback not allowed', async () => {
      mockPrisma.memoryMergeEvent.findUnique.mockResolvedValue({
        id: 'event_1',
        canRollback: false,
      });

      await expect(service.rollbackMerge('event_1')).rejects.toThrow('cannot be rolled back');
    });

    it('should throw when already rolled back', async () => {
      mockPrisma.memoryMergeEvent.findUnique.mockResolvedValue({
        id: 'event_1',
        canRollback: true,
        rolledBackAt: new Date(),
      });

      await expect(service.rollbackMerge('event_1')).rejects.toThrow('already been rolled back');
    });

    it('should mark event as rolled back', async () => {
      mockPrisma.memoryMergeEvent.findUnique.mockResolvedValue({
        id: 'event_1',
        userId: 'user_123',
        survivorMemoryId: 'mem_survivor',
        absorbedMemoryIds: [],
        originalContents: JSON.stringify([]),
        contentChanged: false,
        canRollback: true,
        rolledBackAt: null,
      });
      mockPrisma.memoryMergeEvent.update.mockResolvedValue({});

      await service.rollbackMerge('event_1');

      expect(mockPrisma.memoryMergeEvent.update).toHaveBeenCalledWith({
        where: { id: 'event_1' },
        data: {
          rolledBackAt: expect.any(Date),
          canRollback: false,
        },
      });
    });
  });

  describe('getMergeHistory', () => {
    it('should return paginated merge events', async () => {
      mockPrisma.memoryMergeEvent.findMany.mockResolvedValue([
        {
          id: 'event_1',
          survivorMemoryId: 'mem_1',
          absorbedMemoryIds: ['mem_2'],
          strategy: MergeStrategy.KEEP_DETAILED,
          similarity: 0.95,
          triggeredBy: 'auto',
          mergedContent: 'Content',
          contentChanged: false,
          canRollback: true,
          createdAt: new Date(),
        },
      ]);
      mockPrisma.memoryMergeEvent.count.mockResolvedValue(1);

      const result = await service.getMergeHistory('user_123');

      expect(result.events.length).toBe(1);
      expect(result.total).toBe(1);
    });

    it('should filter by survivor ID', async () => {
      mockPrisma.memoryMergeEvent.findMany.mockResolvedValue([]);
      mockPrisma.memoryMergeEvent.count.mockResolvedValue(0);

      await service.getMergeHistory('user_123', { survivorId: 'mem_1' });

      expect(mockPrisma.memoryMergeEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ survivorMemoryId: 'mem_1' }),
        }),
      );
    });
  });

  describe('getMergeEvent', () => {
    it('should return event when found', async () => {
      mockPrisma.memoryMergeEvent.findUnique.mockResolvedValue({
        id: 'event_1',
        survivorMemoryId: 'mem_1',
        absorbedMemoryIds: ['mem_2'],
        strategy: MergeStrategy.KEEP_DETAILED,
        similarity: 0.95,
        triggeredBy: 'auto',
        mergedContent: 'Content',
        contentChanged: false,
        canRollback: true,
        createdAt: new Date(),
      });

      const result = await service.getMergeEvent('event_1');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('event_1');
    });

    it('should return null when not found', async () => {
      mockPrisma.memoryMergeEvent.findUnique.mockResolvedValue(null);

      const result = await service.getMergeEvent('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getMemoryLineage', () => {
    it('should return lineage for a memory', async () => {
      // As survivor
      mockPrisma.memoryMergeEvent.findMany.mockResolvedValue([
        {
          id: 'event_1',
          absorbedMemoryIds: ['mem_2', 'mem_3'],
          survivorMemoryId: 'mem_1',
          strategy: MergeStrategy.KEEP_DETAILED,
          similarity: 0.95,
          triggeredBy: 'auto',
          mergedContent: 'Content',
          contentChanged: false,
          canRollback: true,
          createdAt: new Date(),
        },
      ]);
      // As absorbed
      mockPrisma.memoryMergeEvent.findFirst.mockResolvedValue(null);

      const result = await service.getMemoryLineage('mem_1');

      expect(result.mergedFrom).toContain('mem_2');
      expect(result.mergedFrom).toContain('mem_3');
      expect(result.mergedInto).toBeNull();
    });

    it('should return mergedInto when memory was absorbed', async () => {
      mockPrisma.memoryMergeEvent.findMany.mockResolvedValue([]);
      mockPrisma.memoryMergeEvent.findFirst.mockResolvedValue({
        survivorMemoryId: 'mem_survivor',
      });

      const result = await service.getMemoryLineage('mem_absorbed');

      expect(result.mergedInto).toBe('mem_survivor');
    });
  });
});
