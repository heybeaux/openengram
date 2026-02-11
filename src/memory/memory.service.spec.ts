import { Test, TestingModule } from '@nestjs/testing';
import { MemoryService, MemoryWithExtraction } from './memory.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExtractionService } from './extraction.service';
import { EmbeddingService } from './embedding.service';
import { ImportanceService } from './importance.service';
import { TemporalParserService } from './temporal/temporal-parser.service';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { ImportanceHint, MemoryLayer, MemorySource } from '@prisma/client';

describe('MemoryService', () => {
  let service: MemoryService;
  let mockPrisma: any;
  let mockExtraction: any;
  let mockEmbedding: any;
  let mockImportance: any;
  let mockTemporalParser: any;
  let mockHierarchyService: jest.Mocked<HierarchyService>;

  const mockMemory = {
    id: 'mem-123',
    userId: 'user-456',
    raw: 'Test memory content',
    layer: MemoryLayer.SESSION,
    source: MemorySource.EXPLICIT_STATEMENT,
    importanceHint: ImportanceHint.MEDIUM,
    importanceScore: 0.5,
    confidence: 1.0,
    retrievalCount: 0,
    usedCount: 0,
    consolidated: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    embeddingId: null,
    embeddingModel: null,
    lastRetrievedAt: null,
    lastUsedAt: null,
    consolidatedAt: null,
    supersededById: null,
    projectId: null,
    sessionId: null,
    sessionPosition: null,
  };

  beforeEach(async () => {
    mockPrisma = {
      memory: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      memoryExtraction: {
        create: jest.fn(),
      },
      session: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-456', externalId: 'TestUser' }),
      },
      entity: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      memoryEntity: {
        upsert: jest.fn(),
      },
      memoryChainLink: {
        upsert: jest.fn(),
      },
    };

    mockExtraction = {
      extract: jest.fn().mockResolvedValue({
        who: null,
        what: 'Test',
        when: null,
        where: null,
        why: null,
        how: null,
        topics: [],
        entities: [],
        memoryType: null,
        typeConfidence: null, confidence: { whoConfidence: null, whatConfidence: null, whenConfidence: null, whereConfidence: null, whyConfidence: null, howConfidence: null }, lesson: null,
      }),
      getPriorityForType: jest.fn().mockReturnValue(3),
      classifyLayer: jest.fn().mockReturnValue('SESSION'),
    } as any;

    mockEmbedding = {
      generate: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      store: jest.fn().mockResolvedValue('embed-123'),
      search: jest.fn().mockResolvedValue([]), // Default: no duplicates found
      delete: jest.fn(),
      deleteAllForUser: jest.fn(),
      getDimensions: jest.fn(),
      getProviderName: jest.fn(),
    } as any;

    mockImportance = {
      calculate: jest.fn(),
      recalculate: jest.fn(),
      applyDecay: jest.fn(),
    } as any;

    mockTemporalParser = {
      parse: jest.fn().mockReturnValue({
        temporalFilter: null,
        semanticQuery: 'test query',
      }),
      blendScores: jest.fn().mockImplementation((semantic, temporal, importance) => semantic + importance),
      computeTemporalScore: jest.fn().mockReturnValue(0.5),
    } as any;

    mockHierarchyService = {
      isEnabled: jest.fn().mockReturnValue(false),
      processMemory: jest.fn().mockResolvedValue({
        memoryId: 'mem-123',
        unitsCreated: 0,
        levels: [],
        units: [],
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ExtractionService, useValue: mockExtraction },
        { provide: EmbeddingService, useValue: mockEmbedding },
        { provide: ImportanceService, useValue: mockImportance },
        { provide: TemporalParserService, useValue: mockTemporalParser },
        { provide: HierarchyService, useValue: mockHierarchyService },
      ],
    }).compile();

    service = module.get<MemoryService>(MemoryService);
  });

  describe('remember', () => {
    it('should create a memory with calculated importance', async () => {
      mockImportance.calculate.mockReturnValue(0.6);
      mockPrisma.memory.create.mockResolvedValue(mockMemory);
      mockExtraction.extract.mockResolvedValue({
        who: null,
        what: 'Test',
        when: null,
        where: null,
        why: null,
        how: null,
        topics: [],
        entities: [],
        memoryType: null,
        typeConfidence: null, confidence: { whoConfidence: null, whatConfidence: null, whenConfidence: null, whereConfidence: null, whyConfidence: null, howConfidence: null }, lesson: null,
      });
      mockEmbedding.generate.mockResolvedValue([0.1, 0.2, 0.3]);
      mockEmbedding.store.mockResolvedValue('embed-123');

      const result = await service.remember('user-456', {
        raw: 'Test memory content',
        layer: MemoryLayer.SESSION,
        importanceHint: ImportanceHint.MEDIUM,
      });

      expect(mockImportance.calculate).toHaveBeenCalledWith({
        hint: ImportanceHint.MEDIUM,
        layer: MemoryLayer.SESSION,
      });
      expect(mockPrisma.memory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-456',
          raw: 'Test memory content',
          layer: MemoryLayer.SESSION,
          source: MemorySource.EXPLICIT_STATEMENT,
          importanceHint: ImportanceHint.MEDIUM,
          importanceScore: 0.6,
        }),
      });
      expect(result).toEqual(mockMemory);
    });

    it('should default to SESSION layer when not specified', async () => {
      mockImportance.calculate.mockReturnValue(0.5);
      mockPrisma.memory.create.mockResolvedValue(mockMemory);

      await service.remember('user-456', { raw: 'Test' });

      expect(mockPrisma.memory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          layer: MemoryLayer.SESSION,
        }),
      });
    });

    it('should include project and session context when provided', async () => {
      mockImportance.calculate.mockReturnValue(0.5);
      mockPrisma.memory.create.mockResolvedValue(mockMemory);
      // Mock session resolution - sessionId exists in DB
      mockPrisma.session.findUnique.mockResolvedValue({ id: 'session-456' });

      await service.remember('user-456', {
        raw: 'Test',
        context: {
          projectId: 'project-123',
          sessionId: 'session-456',
        },
      });

      expect(mockPrisma.memory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: 'project-123',
          sessionId: 'session-456',
        }),
      });
    });

    it('should trigger async extraction without blocking', async () => {
      mockImportance.calculate.mockReturnValue(0.5);
      mockPrisma.memory.create.mockResolvedValue(mockMemory);

      // Mock extraction to take some time
      let extractionStarted = false;
      mockExtraction.extract.mockImplementation(() => {
        extractionStarted = true;
        return Promise.resolve({
          who: null,
          what: 'Test',
          when: null,
          where: null,
          why: null,
          how: null,
          topics: [],
          entities: [],
          memoryType: null,
          typeConfidence: null, confidence: { whoConfidence: null, whatConfidence: null, whenConfidence: null, whereConfidence: null, whyConfidence: null, howConfidence: null }, lesson: null,
        });
      });
      mockEmbedding.generate.mockResolvedValue([0.1, 0.2]);
      mockEmbedding.store.mockResolvedValue('embed-123');

      const result = await service.remember('user-456', { raw: 'Test' });

      // Result should be returned before extraction completes
      expect(result).toEqual(mockMemory);

      // Wait for async extraction to start
      await new Promise((r) => setTimeout(r, 10));
      expect(extractionStarted).toBe(true);
    });
  });

  describe('rememberAll', () => {
    it('should create multiple memories in batch', async () => {
      mockImportance.calculate.mockReturnValue(0.5);
      mockPrisma.memory.create.mockResolvedValue(mockMemory);

      const result = await service.rememberAll('user-456', {
        memories: [
          { raw: 'Memory 1' },
          { raw: 'Memory 2' },
          { raw: 'Memory 3' },
        ],
      });

      expect(mockPrisma.memory.create).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ created: 3, failed: 0 });
    });

    it('should count failures without stopping batch', async () => {
      mockImportance.calculate.mockReturnValue(0.5);
      mockPrisma.memory.create
        .mockResolvedValueOnce(mockMemory)
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce(mockMemory);

      const result = await service.rememberAll('user-456', {
        memories: [
          { raw: 'Memory 1' },
          { raw: 'Memory 2' },
          { raw: 'Memory 3' },
        ],
      });

      expect(result).toEqual({ created: 2, failed: 1 });
    });

    it('should respect individual memory settings', async () => {
      mockImportance.calculate.mockReturnValue(0.5);
      mockPrisma.memory.create.mockResolvedValue(mockMemory);

      await service.rememberAll('user-456', {
        memories: [
          { raw: 'Memory 1', layer: MemoryLayer.IDENTITY, importanceHint: ImportanceHint.CRITICAL },
        ],
        context: { projectId: 'project-123' },
      });

      expect(mockImportance.calculate).toHaveBeenCalledWith({
        hint: ImportanceHint.CRITICAL,
        layer: MemoryLayer.IDENTITY,
      });
    });
  });

  describe('recall', () => {
    it('should perform semantic search and return memories', async () => {
      const queryEmbedding = [0.1, 0.2, 0.3];
      mockEmbedding.generate.mockResolvedValue(queryEmbedding);
      mockEmbedding.search.mockResolvedValue([
        { id: 'mem-1', score: 0.95 },
        { id: 'mem-2', score: 0.88 },
      ]);
      mockPrisma.memory.findMany.mockResolvedValue([
        { ...mockMemory, id: 'mem-1' },
        { ...mockMemory, id: 'mem-2' },
      ]);
      mockPrisma.memory.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.recall('user-456', {
        query: 'test query',
        limit: 10,
      });

      expect(mockEmbedding.generate).toHaveBeenCalledWith('test query');
      expect(mockEmbedding.search).toHaveBeenCalledWith(
        'user-456',
        queryEmbedding,
        10,
        undefined,
        undefined,
        undefined,
      );
      expect(result.memories).toHaveLength(2);
      expect(result.queryTokens).toBeGreaterThan(0);
      expect(result.latencyMs).toBeDefined();
    });

    it('should filter by layers when specified', async () => {
      mockEmbedding.generate.mockResolvedValue([0.1]);
      mockEmbedding.search.mockResolvedValue([]);
      mockPrisma.memory.findMany.mockResolvedValue([]);
      mockPrisma.memory.updateMany.mockResolvedValue({ count: 0 });

      await service.recall('user-456', {
        query: 'test',
        layers: [MemoryLayer.IDENTITY, MemoryLayer.PROJECT],
      });

      expect(mockEmbedding.search).toHaveBeenCalledWith(
        'user-456',
        expect.any(Array),
        10,
        [MemoryLayer.IDENTITY, MemoryLayer.PROJECT],
        undefined,
        undefined,
      );
    });

    it('should update retrieval counts', async () => {
      mockEmbedding.generate.mockResolvedValue([0.1]);
      mockEmbedding.search.mockResolvedValue([
        { id: 'mem-1', score: 0.9 },
        { id: 'mem-2', score: 0.8 },
      ]);
      mockPrisma.memory.findMany.mockResolvedValue([
        { ...mockMemory, id: 'mem-1' },
        { ...mockMemory, id: 'mem-2' },
      ]);
      mockPrisma.memory.updateMany.mockResolvedValue({ count: 2 });

      await service.recall('user-456', { query: 'test' });

      expect(mockPrisma.memory.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['mem-1', 'mem-2'] } },
        data: {
          retrievalCount: { increment: 1 },
          lastRetrievedAt: expect.any(Date),
        },
      });
    });

    it('should handle empty search results', async () => {
      mockEmbedding.generate.mockResolvedValue([0.1]);
      mockEmbedding.search.mockResolvedValue([]);
      mockPrisma.memory.findMany.mockResolvedValue([]);
      mockPrisma.memory.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.recall('user-456', { query: 'test' });

      expect(result.memories).toEqual([]);
    });
  });

  describe('loadContext', () => {
    it('should load memories from all layers', async () => {
      const identityMemories = [
        { ...mockMemory, id: 'id-1', layer: MemoryLayer.IDENTITY, raw: 'Identity fact' },
      ];
      const projectMemories = [
        { ...mockMemory, id: 'proj-1', layer: MemoryLayer.PROJECT, raw: 'Project info' },
      ];
      const sessionMemories = [
        { ...mockMemory, id: 'sess-1', layer: MemoryLayer.SESSION, raw: 'Session info' },
      ];

      mockPrisma.memory.findMany
        .mockResolvedValueOnce(identityMemories)
        .mockResolvedValueOnce(projectMemories)
        .mockResolvedValueOnce(sessionMemories);

      const result = await service.loadContext('user-456', {
        projectId: 'project-123',
      });

      expect(result.layers.identity).toBe(1);
      expect(result.layers.project).toBe(1);
      expect(result.layers.session).toBe(1);
      expect(result.memoriesIncluded).toBe(3);
    });

    it('should format context with layer headers', async () => {
      mockPrisma.memory.findMany
        .mockResolvedValueOnce([{ ...mockMemory, layer: MemoryLayer.IDENTITY, raw: 'User is John' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.loadContext('user-456', {});

      expect(result.context).toContain('## User Identity');
      expect(result.context).toContain('User is John');
    });

    it('should not include project memories when projectId not specified', async () => {
      mockPrisma.memory.findMany
        .mockResolvedValueOnce([]) // identity
        .mockResolvedValueOnce([]); // session

      const result = await service.loadContext('user-456', {});

      expect(mockPrisma.memory.findMany).toHaveBeenCalledTimes(2);
      expect(result.layers.project).toBe(0);
    });

    it('should respect maxTokens limit', async () => {
      const longMemories = Array.from({ length: 100 }, (_, i) => ({
        ...mockMemory,
        id: `mem-${i}`,
        layer: MemoryLayer.IDENTITY,
        raw: 'A'.repeat(100),
      }));

      mockPrisma.memory.findMany
        .mockResolvedValueOnce(longMemories)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.loadContext('user-456', { maxTokens: 100 });

      // Token count should be around the limit
      expect(result.tokenCount).toBeLessThanOrEqual(200); // Some margin for overhead
    });

    it('should query recent session memories from last 7 days', async () => {
      mockPrisma.memory.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await service.loadContext('user-456', {});

      // Session memories query
      expect(mockPrisma.memory.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            layer: MemoryLayer.SESSION,
            createdAt: { gte: expect.any(Date) },
          }),
        }),
      );
    });
  });

  describe('markUsed', () => {
    it('should increment usedCount and update lastUsedAt', async () => {
      mockPrisma.memory.update.mockResolvedValue(mockMemory);

      await service.markUsed('mem-123');

      expect(mockPrisma.memory.update).toHaveBeenCalledWith({
        where: { id: 'mem-123' },
        data: {
          usedCount: { increment: 1 },
          lastUsedAt: expect.any(Date),
        },
      });
    });
  });

  describe('getById', () => {
    it('should return memory with extraction', async () => {
      const memoryWithExtraction = {
        ...mockMemory,
        extraction: {
          who: 'John',
          what: 'Test',
          when: null,
          whereCtx: null,
          why: null,
          how: null,
          topics: ['test'],
        },
      };
      mockPrisma.memory.findUnique.mockResolvedValue(memoryWithExtraction);

      const result = await service.getById('mem-123');

      expect(mockPrisma.memory.findUnique).toHaveBeenCalledWith({
        where: { id: 'mem-123' },
        include: { extraction: true },
      });
      expect(result).toEqual(memoryWithExtraction);
    });

    it('should return null for non-existent memory', async () => {
      mockPrisma.memory.findUnique.mockResolvedValue(null);

      const result = await service.getById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should soft delete by setting deletedAt', async () => {
      mockPrisma.memory.update.mockResolvedValue(mockMemory);

      await service.delete('mem-123');

      expect(mockPrisma.memory.update).toHaveBeenCalledWith({
        where: { id: 'mem-123' },
        data: { deletedAt: expect.any(Date) },
      });
    });
  });
});
