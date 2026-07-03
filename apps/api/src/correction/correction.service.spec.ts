import { Test, TestingModule } from '@nestjs/testing';
import { CorrectionService } from './correction.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from '../memory/embedding.service';
import { LLMService } from '../llm/llm.service';
import { MemorySource } from '@prisma/client';

describe('CorrectionService', () => {
  let service: CorrectionService;
  let prisma: jest.Mocked<PrismaService>;
  let embedding: jest.Mocked<EmbeddingService>;
  let llm: jest.Mocked<LLMService>;

  const mockPrisma = {
    memory: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    memoryChainLink: {
      create: jest.fn(),
    },
  };

  const mockEmbedding = {
    generate: jest.fn(),
    search: jest.fn(),
    store: jest.fn(),
  };

  const mockLLM = {
    json: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CorrectionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmbeddingService, useValue: mockEmbedding },
        { provide: LLMService, useValue: mockLLM },
      ],
    }).compile();

    service = module.get<CorrectionService>(CorrectionService);
    prisma = module.get(PrismaService);
    embedding = module.get(EmbeddingService);
    llm = module.get(LLMService);
  });

  describe('checkForContradictions', () => {
    const userId = 'user-1';
    const newMemoryId = 'mem-new';
    const newContent = 'I prefer dark chocolate';

    it('should return empty when no similar memories found', async () => {
      mockEmbedding.generate.mockResolvedValue([0.1, 0.2, 0.3]);
      mockEmbedding.search.mockResolvedValue([]);

      const result = await service.checkForContradictions(
        newMemoryId,
        userId,
        newContent,
      );

      expect(result.contradictions).toHaveLength(0);
      expect(result.superseded).toHaveLength(0);
    });

    it('should return empty when similar memories are below threshold', async () => {
      mockEmbedding.generate.mockResolvedValue([0.1, 0.2, 0.3]);
      mockEmbedding.search.mockResolvedValue([
        { id: 'mem-old', score: 0.5 }, // Below 0.70 threshold
      ]);

      const result = await service.checkForContradictions(
        newMemoryId,
        userId,
        newContent,
      );

      expect(result.contradictions).toHaveLength(0);
      expect(mockLLM.json).not.toHaveBeenCalled();
    });

    it('should detect and supersede contradicting memories', async () => {
      const existingMemory = {
        id: 'mem-old',
        userId,
        raw: 'I prefer white chocolate',
        layer: 'IDENTITY',
        deletedAt: null,
        supersededById: null,
        importanceScore: 0.5,
      };

      mockEmbedding.generate.mockResolvedValue([0.1, 0.2, 0.3]);
      mockEmbedding.search.mockResolvedValue([{ id: 'mem-old', score: 0.85 }]);
      mockPrisma.memory.findMany.mockResolvedValue([existingMemory]);
      mockLLM.json.mockResolvedValue([
        {
          index: 1,
          isContradiction: true,
          explanation: 'Chocolate preference changed',
        },
      ]);
      mockPrisma.memory.update.mockResolvedValue({});
      mockPrisma.memoryChainLink.create.mockResolvedValue({});

      const result = await service.checkForContradictions(
        newMemoryId,
        userId,
        newContent,
      );

      expect(result.contradictions).toHaveLength(1);
      expect(result.contradictions[0].isContradiction).toBe(true);
      expect(result.superseded).toEqual(['mem-old']);

      // Verify the old memory was superseded
      expect(mockPrisma.memory.update).toHaveBeenCalledWith({
        where: { id: 'mem-old' },
        data: {
          supersededById: newMemoryId,
          supersededAt: expect.any(Date),
        },
      });

      // Verify CONTRADICTS link was created
      expect(mockPrisma.memoryChainLink.create).toHaveBeenCalledWith({
        data: {
          sourceId: newMemoryId,
          targetId: 'mem-old',
          linkType: 'CONTRADICTS',
          confidence: 1.0,
          createdBy: expect.stringContaining('auto:correction:'),
        },
      });
    });

    it('should skip already-superseded memories', async () => {
      mockEmbedding.generate.mockResolvedValue([0.1, 0.2, 0.3]);
      mockEmbedding.search.mockResolvedValue([{ id: 'mem-old', score: 0.85 }]);
      // Memory already superseded — filtered out by findMany query
      mockPrisma.memory.findMany.mockResolvedValue([]);

      const result = await service.checkForContradictions(
        newMemoryId,
        userId,
        newContent,
      );

      expect(result.contradictions).toHaveLength(0);
      expect(mockLLM.json).not.toHaveBeenCalled();
    });

    it('should not block on LLM errors', async () => {
      mockEmbedding.generate.mockResolvedValue([0.1, 0.2, 0.3]);
      mockEmbedding.search.mockResolvedValue([{ id: 'mem-old', score: 0.85 }]);
      mockPrisma.memory.findMany.mockResolvedValue([
        {
          id: 'mem-old',
          userId,
          raw: 'old content',
          deletedAt: null,
          supersededById: null,
        },
      ]);
      mockLLM.json.mockRejectedValue(new Error('LLM timeout'));

      const result = await service.checkForContradictions(
        newMemoryId,
        userId,
        newContent,
      );

      // Should gracefully return empty, not throw
      expect(result.contradictions).toHaveLength(0);
      expect(result.superseded).toHaveLength(0);
    });

    it('should exclude the new memory itself from candidates', async () => {
      mockEmbedding.generate.mockResolvedValue([0.1, 0.2, 0.3]);
      mockEmbedding.search.mockResolvedValue([
        { id: newMemoryId, score: 1.0 }, // The memory itself
        { id: 'mem-old', score: 0.5 }, // Below threshold
      ]);

      const result = await service.checkForContradictions(
        newMemoryId,
        userId,
        newContent,
      );

      expect(result.contradictions).toHaveLength(0);
    });

    it('should handle multiple contradictions', async () => {
      const memories = [
        {
          id: 'mem-1',
          userId,
          raw: 'I prefer white chocolate',
          deletedAt: null,
          supersededById: null,
        },
        {
          id: 'mem-2',
          userId,
          raw: 'I like white chocolate the most',
          deletedAt: null,
          supersededById: null,
        },
      ];

      mockEmbedding.generate.mockResolvedValue([0.1, 0.2, 0.3]);
      mockEmbedding.search.mockResolvedValue([
        { id: 'mem-1', score: 0.85 },
        { id: 'mem-2', score: 0.8 },
      ]);
      mockPrisma.memory.findMany.mockResolvedValue(memories);
      mockLLM.json.mockResolvedValue([
        { index: 1, isContradiction: true, explanation: 'Preference changed' },
        { index: 2, isContradiction: true, explanation: 'Preference changed' },
      ]);
      mockPrisma.memory.update.mockResolvedValue({});
      mockPrisma.memoryChainLink.create.mockResolvedValue({});

      const result = await service.checkForContradictions(
        newMemoryId,
        userId,
        newContent,
      );

      expect(result.superseded).toHaveLength(2);
      expect(result.superseded).toContain('mem-1');
      expect(result.superseded).toContain('mem-2');
    });
  });

  describe('manualCorrect', () => {
    it('should create correction and supersede original', async () => {
      const existing = {
        id: 'mem-old',
        userId: 'user-1',
        raw: 'Old fact',
        layer: 'IDENTITY',
        importanceScore: 0.5,
        deletedAt: null,
        supersededById: null,
        projectId: null,
        sessionId: null,
      };

      mockPrisma.memory.findUnique.mockResolvedValue(existing);
      mockPrisma.memory.create.mockResolvedValue({
        ...existing,
        id: 'mem-correction',
        raw: 'Corrected fact',
        source: MemorySource.CORRECTION,
        importanceScore: 0.6,
      });
      mockPrisma.memory.update.mockResolvedValue({});
      mockPrisma.memoryChainLink.create.mockResolvedValue({});
      mockEmbedding.generate.mockResolvedValue([0.1, 0.2]);
      mockEmbedding.store.mockResolvedValue('emb-1');

      const result = await service.manualCorrect(
        'user-1',
        'mem-old',
        'Corrected fact',
        'was wrong',
      );

      expect(result.correctionId).toBe('mem-correction');
      expect(result.supersededId).toBe('mem-old');
    });

    it('should reject if memory not found', async () => {
      mockPrisma.memory.findUnique.mockResolvedValue(null);

      await expect(
        service.manualCorrect('user-1', 'nonexistent', 'new content'),
      ).rejects.toThrow('Memory not found');
    });

    it('should reject if memory belongs to another user', async () => {
      mockPrisma.memory.findUnique.mockResolvedValue({
        id: 'mem-1',
        userId: 'other-user',
        deletedAt: null,
        supersededById: null,
      });

      await expect(
        service.manualCorrect('user-1', 'mem-1', 'new content'),
      ).rejects.toThrow('Access denied');
    });

    it('should reject if memory already superseded', async () => {
      mockPrisma.memory.findUnique.mockResolvedValue({
        id: 'mem-1',
        userId: 'user-1',
        deletedAt: null,
        supersededById: 'mem-2',
      });

      await expect(
        service.manualCorrect('user-1', 'mem-1', 'new content'),
      ).rejects.toThrow('already superseded');
    });
  });
});
