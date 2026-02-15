import { MemoryQueryService } from './memory-query.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import { TemporalParserService } from './temporal/temporal-parser.service';
import { MultiQueryService } from '../multi-query/multi-query.service';
import { MemoryPoolService } from '../memory-pool/memory-pool.service';
import { MemoryAccessLogService } from '../memory-access-log/memory-access-log.service';

describe('MemoryQueryService', () => {
  let service: MemoryQueryService;
  let prisma: jest.Mocked<PrismaService>;
  let embedding: jest.Mocked<EmbeddingService>;
  let temporalParser: jest.Mocked<TemporalParserService>;
  let multiQueryService: jest.Mocked<MultiQueryService>;
  let memoryPoolService: jest.Mocked<MemoryPoolService>;
  let memoryAccessLogService: jest.Mocked<MemoryAccessLogService>;

  const userId = 'user-123';
  const mockEmbedding = [0.1, 0.2, 0.3];

  beforeEach(() => {
    prisma = {
      memory: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as any;

    embedding = {
      generate: jest.fn().mockResolvedValue(mockEmbedding),
      search: jest.fn().mockResolvedValue([]),
    } as any;

    temporalParser = {
      parse: jest.fn().mockReturnValue({
        semanticQuery: 'test query',
        temporalFilter: null,
      }),
      calculateTemporalRelevance: jest.fn().mockReturnValue(0.8),
      blendScores: jest.fn().mockReturnValue(0.7),
    } as any;

    multiQueryService = {
      isEnabled: jest.fn().mockReturnValue(false),
      search: jest.fn(),
      generateMetadata: jest.fn().mockReturnValue({
        queryCount: 1,
        strategy: 'default',
        explanations: [],
      }),
    } as any;

    memoryPoolService = {
      getAccessiblePoolIds: jest.fn().mockResolvedValue(['pool-1']),
    } as any;

    memoryAccessLogService = {
      logRecalled: jest.fn().mockResolvedValue(undefined),
    } as any;

    service = new MemoryQueryService(
      prisma,
      embedding,
      temporalParser,
      multiQueryService,
      memoryPoolService,
      memoryAccessLogService,
    );
  });

  describe('recall', () => {
    it('should perform standard semantic search', async () => {
      embedding.search.mockResolvedValue([
        { id: 'm1', score: 0.9 },
        { id: 'm2', score: 0.7 },
      ] as any);

      prisma.memory.findMany = jest.fn().mockResolvedValue([
        { id: 'm1', raw: 'memory 1', effectiveScore: 0.8, extraction: {} },
        { id: 'm2', raw: 'memory 2', effectiveScore: 0.6, extraction: {} },
      ]);

      const result = await service.recall(userId, { query: 'test query' } as any);

      expect(result.memories).toHaveLength(2);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(embedding.generate).toHaveBeenCalledWith('test query');
    });

    it('should use temporal path when temporal intent detected', async () => {
      temporalParser.parse.mockReturnValue({
        semanticQuery: 'meeting',
        temporalFilter: {
          expression: 'yesterday',
          start: new Date('2026-02-14'),
          end: new Date('2026-02-15'),
        },
      } as any);

      prisma.memory.findMany = jest.fn().mockResolvedValue([
        { id: 'm1', raw: 'yesterday meeting', effectiveScore: 0.8, createdAt: new Date('2026-02-14T10:00:00Z'), extraction: {} },
      ]);

      embedding.search.mockResolvedValue([{ id: 'm1', score: 0.9 }] as any);

      const result = await service.recall(userId, { query: 'yesterday meeting' } as any);
      expect(result.memories).toHaveLength(1);
      expect(temporalParser.blendScores).toHaveBeenCalledWith(0.9, 0.8, 0.8, true);
    });

    it('should resolve pool IDs from agentSessionKey', async () => {
      embedding.search.mockResolvedValue([]);
      const result = await service.recall(userId, {
        query: 'test',
        agentSessionKey: 'session-1',
      } as any);

      expect(memoryPoolService.getAccessiblePoolIds).toHaveBeenCalledWith('session-1', userId);
      expect(result.memories).toHaveLength(0);
    });

    it('should handle pool resolution failure gracefully', async () => {
      memoryPoolService.getAccessiblePoolIds.mockRejectedValue(new Error('fail'));
      embedding.search.mockResolvedValue([]);

      const result = await service.recall(userId, {
        query: 'test',
        agentSessionKey: 'session-1',
      } as any);

      expect(result.memories).toHaveLength(0);
    });

    it('should update retrieval counts for returned memories', async () => {
      embedding.search.mockResolvedValue([{ id: 'm1', score: 0.9 }] as any);
      prisma.memory.findMany = jest.fn().mockResolvedValue([
        { id: 'm1', raw: 'test', effectiveScore: 0.5, extraction: {} },
      ]);

      await service.recall(userId, { query: 'test' } as any);

      expect(prisma.memory.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['m1'] } },
        data: {
          retrievalCount: { increment: 1 },
          lastRetrievedAt: expect.any(Date),
        },
      });
    });

    it('should log access when agentSessionKey provided', async () => {
      embedding.search.mockResolvedValue([{ id: 'm1', score: 0.9 }] as any);
      prisma.memory.findMany = jest.fn().mockResolvedValue([
        { id: 'm1', raw: 'test', effectiveScore: 0.5, extraction: {} },
      ]);

      await service.recall(userId, {
        query: 'test',
        agentSessionKey: 'agent-1',
      } as any);

      expect(memoryAccessLogService.logRecalled).toHaveBeenCalledWith(
        ['m1'],
        'agent-1',
        'test',
      );
    });
  });

  describe('shouldUseMultiQuery', () => {
    it('should return false when multiQueryService is not available', () => {
      const svc = new MemoryQueryService(prisma, embedding, temporalParser);
      expect(svc.shouldUseMultiQuery({} as any)).toBe(false);
    });

    it('should respect explicit enabled=false', () => {
      expect(service.shouldUseMultiQuery({ multiQuery: { enabled: false } } as any)).toBe(false);
    });

    it('should respect explicit enabled=true', () => {
      expect(service.shouldUseMultiQuery({ multiQuery: { enabled: true } } as any)).toBe(true);
    });

    it('should fall back to service isEnabled', () => {
      multiQueryService.isEnabled.mockReturnValue(true);
      expect(service.shouldUseMultiQuery({} as any)).toBe(true);
    });
  });

  describe('recall with multiQuery', () => {
    it('should use multi-query path when enabled', async () => {
      multiQueryService.isEnabled.mockReturnValue(true);
      multiQueryService.search.mockResolvedValue({
        results: [{ memoryId: 'm1', score: 0.9 }],
        metadata: {},
      } as any);

      prisma.memory.findMany = jest.fn().mockResolvedValue([
        { id: 'm1', raw: 'test', effectiveScore: 0.5, extraction: {} },
      ]);

      const result = await service.recall(userId, { query: 'complex query' } as any);
      expect(result.memories).toHaveLength(1);
      expect(multiQueryService.search).toHaveBeenCalled();
    });

    it('should fall back to standard when temporal intent + multiQuery', async () => {
      multiQueryService.isEnabled.mockReturnValue(true);
      temporalParser.parse.mockReturnValue({
        semanticQuery: 'meeting',
        temporalFilter: {
          expression: 'yesterday',
          start: new Date('2026-02-14'),
          end: new Date('2026-02-15'),
        },
      } as any);

      embedding.search.mockResolvedValue([]);
      prisma.memory.findMany = jest.fn().mockResolvedValue([]);

      await service.recall(userId, { query: 'yesterday meeting' } as any);
      // Should NOT use multiQuery for temporal queries
      expect(multiQueryService.search).not.toHaveBeenCalled();
    });
  });
});
