import { Test, TestingModule } from '@nestjs/testing';
import { ConsolidationService } from './consolidation.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import { LLMService } from '../llm/llm.service';
import { MemoryLayer } from '@prisma/client';

describe('ConsolidationService', () => {
  let service: ConsolidationService;
  let mockPrisma: any;
  let mockEmbedding: any;
  let mockLLM: any;

  beforeEach(async () => {
    mockPrisma = {
      memory: {
        findMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      memoryExtraction: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    } as any;

    mockEmbedding = {
      generate: jest.fn(),
      search: jest.fn(),
    } as any;

    mockLLM = {
      json: jest.fn().mockResolvedValue({
        gist: 'Consolidated memory gist',
        confidence: 0.9,
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConsolidationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmbeddingService, useValue: mockEmbedding },
        { provide: LLMService, useValue: mockLLM },
      ],
    }).compile();

    service = module.get<ConsolidationService>(ConsolidationService);
  });

  describe('promoteRecurringPatterns', () => {
    const userId = 'test-user-id';

    it('should return empty result when no memories exist', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([]);

      const result = await service.promoteRecurringPatterns(userId);

      expect(result.promoted).toBe(0);
      expect(result.duplicatesRemoved).toBe(0);
      expect(result.clustersFound).toBe(0);
      expect(result.details).toEqual([]);
    });

    it('should return empty result when memories count is below threshold', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        { id: 'mem1', raw: 'I prefer dark mode', createdAt: new Date(), importanceScore: 0.5, extraction: { what: 'prefers dark mode' } },
        { id: 'mem2', raw: 'Dark mode is my preference', createdAt: new Date(), importanceScore: 0.5, extraction: { what: 'prefers dark mode' } },
      ]);

      const result = await service.promoteRecurringPatterns(userId);

      expect(result.promoted).toBe(0);
    });

    it('should identify and promote clusters of 3+ similar memories', async () => {
      const now = new Date();
      const memories = [
        { id: 'mem1', raw: 'I prefer dark mode', createdAt: now, importanceScore: 0.5, extraction: { what: 'prefers dark mode' } },
        { id: 'mem2', raw: 'Dark mode is my preference', createdAt: new Date(now.getTime() - 1000), importanceScore: 0.6, extraction: { what: 'Dark mode is my preference' } },
        { id: 'mem3', raw: 'I always use dark mode', createdAt: new Date(now.getTime() - 2000), importanceScore: 0.5, extraction: { what: 'always use dark mode' } },
      ];

      mockPrisma.memory.findMany.mockResolvedValue(memories);
      mockEmbedding.generate.mockResolvedValue([0.1, 0.2, 0.3]);
      mockEmbedding.search.mockResolvedValue([
        { id: 'mem1', score: 1.0 },
        { id: 'mem2', score: 0.92 },
        { id: 'mem3', score: 0.88 },
      ]);

      const result = await service.promoteRecurringPatterns(userId, { dryRun: true });

      expect(result.clustersFound).toBe(1);
      expect(result.promoted).toBe(1);
      expect(result.duplicatesRemoved).toBe(2);
    });

    it('should not modify database in dry run mode', async () => {
      const now = new Date();
      const memories = [
        { id: 'mem1', raw: 'Test memory 1', createdAt: now, importanceScore: 0.5, extraction: { what: 'test 1' } },
        { id: 'mem2', raw: 'Test memory 2', createdAt: new Date(now.getTime() - 1000), importanceScore: 0.5, extraction: { what: 'test 2' } },
        { id: 'mem3', raw: 'Test memory 3', createdAt: new Date(now.getTime() - 2000), importanceScore: 0.5, extraction: { what: 'test 3' } },
      ];

      mockPrisma.memory.findMany.mockResolvedValue(memories);
      mockEmbedding.generate.mockResolvedValue([0.1, 0.2, 0.3]);
      mockEmbedding.search.mockResolvedValue([
        { id: 'mem1', score: 1.0 },
        { id: 'mem2', score: 0.90 },
        { id: 'mem3', score: 0.88 },
      ]);

      await service.promoteRecurringPatterns(userId, { dryRun: true });

      expect(mockPrisma.memory.update).not.toHaveBeenCalled();
    });

    it('should select canonical memory with longest extraction', async () => {
      const now = new Date();
      const memories = [
        { id: 'mem1', raw: 'Short', createdAt: now, importanceScore: 0.5, extraction: { what: 'short' } },
        { id: 'mem2', raw: 'This is a longer and more detailed memory about preferences', createdAt: new Date(now.getTime() - 1000), importanceScore: 0.5, extraction: { what: 'This is a longer and more detailed memory about preferences' } },
        { id: 'mem3', raw: 'Medium length', createdAt: new Date(now.getTime() - 2000), importanceScore: 0.5, extraction: { what: 'Medium length' } },
      ];

      mockPrisma.memory.findMany.mockResolvedValue(memories);
      mockEmbedding.generate.mockResolvedValue([0.1, 0.2, 0.3]);
      mockEmbedding.search.mockResolvedValue([
        { id: 'mem1', score: 1.0 },
        { id: 'mem2', score: 0.90 },
        { id: 'mem3', score: 0.88 },
      ]);

      const result = await service.promoteRecurringPatterns(userId, { dryRun: true });

      // mem2 should be canonical (longest extraction.what)
      expect(result.details[0].canonicalId).toBe('mem2');
      expect(result.details[0].duplicateIds).toContain('mem1');
      expect(result.details[0].duplicateIds).toContain('mem3');
    });

    it('should respect custom minOccurrences setting', async () => {
      const now = new Date();
      const memories = [
        { id: 'mem1', raw: 'Test 1', createdAt: now, importanceScore: 0.5, extraction: { what: 'test' } },
        { id: 'mem2', raw: 'Test 2', createdAt: new Date(now.getTime() - 1000), importanceScore: 0.5, extraction: { what: 'test' } },
      ];

      mockPrisma.memory.findMany.mockResolvedValue(memories);
      mockEmbedding.generate.mockResolvedValue([0.1, 0.2, 0.3]);
      mockEmbedding.search.mockResolvedValue([
        { id: 'mem1', score: 1.0 },
        { id: 'mem2', score: 0.90 },
      ]);

      // With default minOccurrences=3, should not promote
      let result = await service.promoteRecurringPatterns(userId, { dryRun: true });
      expect(result.promoted).toBe(0);

      // With minOccurrences=2, should promote
      result = await service.promoteRecurringPatterns(userId, { dryRun: true, minOccurrences: 2 });
      expect(result.promoted).toBe(1);
    });

    it('should update memory with IDENTITY layer and boost importance when not dry run', async () => {
      const now = new Date();
      const memories = [
        { id: 'mem1', raw: 'I prefer dark mode', createdAt: now, importanceScore: 0.5, extraction: { what: 'prefers dark mode' } },
        { id: 'mem2', raw: 'Dark mode preference', createdAt: new Date(now.getTime() - 1000), importanceScore: 0.5, extraction: { what: 'dark mode' } },
        { id: 'mem3', raw: 'Always dark mode', createdAt: new Date(now.getTime() - 2000), importanceScore: 0.5, extraction: { what: 'dark mode' } },
      ];

      mockPrisma.memory.findMany.mockResolvedValue(memories);
      mockEmbedding.generate.mockResolvedValue([0.1, 0.2, 0.3]);
      mockEmbedding.search.mockResolvedValue([
        { id: 'mem1', score: 1.0 },
        { id: 'mem2', score: 0.90 },
        { id: 'mem3', score: 0.88 },
      ]);
      mockPrisma.memory.update.mockResolvedValue({} as any);

      await service.promoteRecurringPatterns(userId, { dryRun: false });

      // Should update canonical memory (mem1 has longest extraction.what)
      expect(mockPrisma.memory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'mem1' },
          data: expect.objectContaining({
            layer: MemoryLayer.IDENTITY,
            importanceScore: 0.7, // 0.5 + 0.2
            consolidated: true,
          }),
        }),
      );

      // Should soft-delete duplicates with consolidatedInto
      expect(mockPrisma.memory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'mem2' },
          data: expect.objectContaining({
            consolidatedInto: 'mem1',
            deletedAt: expect.any(Date),
          }),
        }),
      );
    });
  });

  describe('getStats', () => {
    const userId = 'test-user-id';

    it('should return memory statistics', async () => {
      mockPrisma.memory.count
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(60)  // session
        .mockResolvedValueOnce(25)  // identity
        .mockResolvedValueOnce(15)  // project
        .mockResolvedValueOnce(5);  // consolidated

      const stats = await service.getStats(userId);

      expect(stats.totalMemories).toBe(100);
      expect(stats.sessionMemories).toBe(60);
      expect(stats.identityMemories).toBe(25);
      expect(stats.projectMemories).toBe(15);
      expect(stats.consolidatedCount).toBe(5);
      expect(stats.potentialClusters).toBe(20); // 60 / 3
    });
  });
});
