import { Test, TestingModule } from '@nestjs/testing';
import { BackfillService } from './backfill.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExtractionService } from './extraction.service';

describe('BackfillService', () => {
  let service: BackfillService;
  let prisma: jest.Mocked<PrismaService>;

  const mockUser = {
    id: 'user-123',
    externalId: 'beaux',
    agentId: 'agent-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockMemories = [
    {
      id: 'mem-1',
      userId: 'user-123',
      raw: 'beaux prefers dark mode for all applications',
      layer: 'IDENTITY',
      source: 'EXPLICIT_STATEMENT',
      importanceScore: 0.8,
      confidence: 1.0,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      extraction: {
        id: 'ext-1',
        memoryId: 'mem-1',
        who: 'beaux',
        what: 'beaux prefers dark mode for all applications',
        when: null,
        whereCtx: null,
        why: null,
        how: null,
        topics: ['preferences'],
        extractedAt: new Date(),
      },
    },
    {
      id: 'mem-2',
      userId: 'user-123',
      raw: 'The user never deploys on Fridays',
      layer: 'IDENTITY',
      source: 'EXPLICIT_STATEMENT',
      importanceScore: 0.7,
      confidence: 1.0,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      extraction: {
        id: 'ext-2',
        memoryId: 'mem-2',
        who: 'User',
        what: 'The user never deploys on Fridays',
        when: null,
        whereCtx: null,
        why: null,
        how: null,
        topics: ['preferences'],
        extractedAt: new Date(),
      },
    },
    {
      id: 'mem-3',
      userId: 'user-123',
      raw: 'Beaux loves coffee in the morning',
      layer: 'IDENTITY',
      source: 'EXPLICIT_STATEMENT',
      importanceScore: 0.6,
      confidence: 1.0,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      extraction: {
        id: 'ext-3',
        memoryId: 'mem-3',
        who: 'Beaux',
        what: 'loves coffee in the morning',
        when: null,
        whereCtx: null,
        why: null,
        how: null,
        topics: ['preferences'],
        extractedAt: new Date(),
      },
    },
  ];

  beforeEach(async () => {
    const mockPrisma = {
      memory: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
      memoryExtraction: {
        update: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
      },
    };

    const mockExtraction = {
      extract: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackfillService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ExtractionService, useValue: mockExtraction },
      ],
    }).compile();

    service = module.get<BackfillService>(BackfillService);
    prisma = module.get(PrismaService);
  });

  describe('backfillUserIdentity', () => {
    it('should replace user_xxx patterns with actual name', async () => {
      prisma.memory.findMany = jest.fn().mockResolvedValue([mockMemories[0]]);
      prisma.memory.update = jest.fn().mockResolvedValue({});
      prisma.memoryExtraction.update = jest.fn().mockResolvedValue({});

      const result = await service.backfillUserIdentity('user-123', 'Beaux');

      expect(result.updated).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.total).toBe(1);
      expect(result.dryRun).toBe(false);

      // Check that update was called with correct replacements
      expect(prisma.memory.update).toHaveBeenCalledWith({
        where: { id: 'mem-1' },
        data: { raw: 'Beaux prefers dark mode for all applications' },
      });

      expect(prisma.memoryExtraction.update).toHaveBeenCalledWith({
        where: { memoryId: 'mem-1' },
        data: {
          who: 'Beaux',
          what: 'Beaux prefers dark mode for all applications',
        },
      });
    });

    it('should replace "the user" patterns with actual name', async () => {
      prisma.memory.findMany = jest.fn().mockResolvedValue([mockMemories[1]]);
      prisma.memory.update = jest.fn().mockResolvedValue({});
      prisma.memoryExtraction.update = jest.fn().mockResolvedValue({});

      const result = await service.backfillUserIdentity('user-123', 'Beaux');

      expect(result.updated).toBe(1);

      expect(prisma.memory.update).toHaveBeenCalledWith({
        where: { id: 'mem-2' },
        data: { raw: 'Beaux never deploys on Fridays' },
      });

      expect(prisma.memoryExtraction.update).toHaveBeenCalledWith({
        where: { memoryId: 'mem-2' },
        data: {
          who: 'Beaux',
          what: 'Beaux never deploys on Fridays',
        },
      });
    });

    it('should skip memories that already use actual name', async () => {
      prisma.memory.findMany = jest.fn().mockResolvedValue([mockMemories[2]]);

      const result = await service.backfillUserIdentity('user-123', 'Beaux');

      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.total).toBe(1);

      // No updates should have been called
      expect(prisma.memory.update).not.toHaveBeenCalled();
      expect(prisma.memoryExtraction.update).not.toHaveBeenCalled();
    });

    it('should handle dry run mode', async () => {
      prisma.memory.findMany = jest.fn().mockResolvedValue([mockMemories[0]]);

      const result = await service.backfillUserIdentity('user-123', 'Beaux', {
        dryRun: true,
      });

      expect(result.updated).toBe(1);
      expect(result.dryRun).toBe(true);

      // No actual updates in dry run mode
      expect(prisma.memory.update).not.toHaveBeenCalled();
      expect(prisma.memoryExtraction.update).not.toHaveBeenCalled();

      // But details should still be populated
      expect(result.details).toHaveLength(1);
      expect(result.details[0].rawAfter).toContain('Beaux');
    });

    it('should handle multiple patterns in same memory', async () => {
      const memoryWithMultiplePatterns = {
        ...mockMemories[0],
        raw: 'beaux said the user prefers dark mode. User confirmed this.',
        extraction: {
          ...mockMemories[0].extraction,
          who: 'beaux',
          what: 'the user prefers dark mode',
        },
      };

      prisma.memory.findMany = jest
        .fn()
        .mockResolvedValue([memoryWithMultiplePatterns]);
      prisma.memory.update = jest.fn().mockResolvedValue({});
      prisma.memoryExtraction.update = jest.fn().mockResolvedValue({});

      const result = await service.backfillUserIdentity('user-123', 'Beaux');

      expect(result.updated).toBe(1);

      expect(prisma.memory.update).toHaveBeenCalledWith({
        where: { id: 'mem-1' },
        data: {
          raw: 'Beaux said Beaux prefers dark mode. Beaux confirmed this.',
        },
      });
    });

    it('should handle memories without extraction', async () => {
      const memoryWithoutExtraction = {
        ...mockMemories[0],
        extraction: null,
      };

      prisma.memory.findMany = jest
        .fn()
        .mockResolvedValue([memoryWithoutExtraction]);
      prisma.memory.update = jest.fn().mockResolvedValue({});

      const result = await service.backfillUserIdentity('user-123', 'Beaux');

      expect(result.updated).toBe(1);
      expect(prisma.memory.update).toHaveBeenCalled();
      expect(prisma.memoryExtraction.update).not.toHaveBeenCalled();
    });

    it('should NOT replace User in compound words like User-ID, userId, userName', async () => {
      const memoryWithCompoundWords = {
        id: 'mem-compound',
        userId: 'user-123',
        raw: 'The API requires X-AM-User-ID header. User prefers dark mode. Set userId correctly.',
        layer: 'SESSION',
        source: 'EXPLICIT_STATEMENT',
        importanceScore: 0.5,
        confidence: 1.0,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        extraction: {
          id: 'ext-compound',
          memoryId: 'mem-compound',
          who: 'User',
          what: 'requires X-AM-User-ID header',
          when: null,
          whereCtx: null,
          why: null,
          how: null,
          topics: [],
          extractedAt: new Date(),
        },
      };

      prisma.memory.findMany = jest
        .fn()
        .mockResolvedValue([memoryWithCompoundWords]);
      prisma.memory.update = jest.fn().mockResolvedValue({});
      prisma.memoryExtraction.update = jest.fn().mockResolvedValue({});

      const result = await service.backfillUserIdentity('user-123', 'Beaux');

      expect(result.updated).toBe(1);

      // Should replace standalone "User" but NOT "User-ID" or "userId"
      expect(prisma.memory.update).toHaveBeenCalledWith({
        where: { id: 'mem-compound' },
        data: {
          raw: 'The API requires X-AM-User-ID header. Beaux prefers dark mode. Set userId correctly.',
        },
      });
    });

    it('should respect batchSize option', async () => {
      prisma.memory.findMany = jest
        .fn()
        .mockResolvedValue(mockMemories.slice(0, 2));

      await service.backfillUserIdentity('user-123', 'Beaux', { batchSize: 2 });

      expect(prisma.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 2,
        }),
      );
    });
  });

  describe('findUserByExternalIdPattern', () => {
    it('should find users matching pattern', async () => {
      prisma.user.findMany = jest.fn().mockResolvedValue([mockUser]);

      const result = await service.findUserByExternalIdPattern('beaux');

      expect(result).toHaveLength(1);
      expect(result[0].externalId).toBe('beaux');
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          externalId: {
            contains: 'beaux',
            mode: 'insensitive',
          },
          deletedAt: null,
        },
        select: {
          id: true,
          externalId: true,
        },
      });
    });

    it('should return empty array when no users match', async () => {
      prisma.user.findMany = jest.fn().mockResolvedValue([]);

      const result = await service.findUserByExternalIdPattern('nonexistent');

      expect(result).toHaveLength(0);
    });
  });
});
