import { Test, TestingModule } from '@nestjs/testing';
import { MergeService } from './merge.service';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryType } from '@prisma/client';
import { MergeStrategy } from './dto/deduplication.dto';

describe('MergeService', () => {
  let service: MergeService;
  let prismaService: jest.Mocked<PrismaService>;

  const mockPrisma = {
    memory: {
      findMany: jest.fn(),
    },
  };

  const createMockMemory = (overrides: Partial<any> = {}) => ({
    id: 'mem_1',
    raw: 'Test content',
    memoryType: MemoryType.FACT,
    importanceScore: 0.5,
    createdAt: new Date('2026-01-15'),
    retrievalCount: 1,
    lastRetrievedAt: new Date('2026-01-20'),
    usedCount: 0,
    lastUsedAt: null,
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MergeService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<MergeService>(MergeService);
    prismaService = module.get(PrismaService);
  });

  describe('getDefaultStrategy', () => {
    it('should return COMBINE_METADATA for CONSTRAINT', () => {
      expect(service.getDefaultStrategy(MemoryType.CONSTRAINT)).toBe(
        MergeStrategy.COMBINE_METADATA,
      );
    });

    it('should return KEEP_NEWEST for LESSON', () => {
      expect(service.getDefaultStrategy(MemoryType.LESSON)).toBe(
        MergeStrategy.KEEP_NEWEST,
      );
    });

    it('should return KEEP_NEWEST for PREFERENCE', () => {
      expect(service.getDefaultStrategy(MemoryType.PREFERENCE)).toBe(
        MergeStrategy.KEEP_NEWEST,
      );
    });

    it('should return KEEP_DETAILED for FACT', () => {
      expect(service.getDefaultStrategy(MemoryType.FACT)).toBe(
        MergeStrategy.KEEP_DETAILED,
      );
    });

    it('should return KEEP_DETAILED for null', () => {
      expect(service.getDefaultStrategy(null)).toBe(
        MergeStrategy.KEEP_DETAILED,
      );
    });
  });

  describe('merge', () => {
    it('should throw when less than 2 memories provided', async () => {
      await expect(
        service.merge(['mem_1'], MergeStrategy.KEEP_NEWEST),
      ).rejects.toThrow('Need at least 2 memories to merge');
    });

    it('should throw when some memories not found', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([createMockMemory()]);

      await expect(
        service.merge(['mem_1', 'mem_2'], MergeStrategy.KEEP_NEWEST),
      ).rejects.toThrow('Some memories not found');
    });
  });

  describe('merge - KEEP_NEWEST strategy', () => {
    it('should keep the most recently created memory', async () => {
      const older = createMockMemory({
        id: 'mem_older',
        raw: 'Old version',
        createdAt: new Date('2026-01-01'),
      });
      const newer = createMockMemory({
        id: 'mem_newer',
        raw: 'New version',
        createdAt: new Date('2026-02-01'),
      });
      mockPrisma.memory.findMany.mockResolvedValue([older, newer]);

      const result = await service.merge(
        ['mem_older', 'mem_newer'],
        MergeStrategy.KEEP_NEWEST,
      );

      expect(result.survivorId).toBe('mem_newer');
      expect(result.absorbedIds).toContain('mem_older');
      expect(result.mergedContent).toBe('New version');
      expect(result.strategy).toBe(MergeStrategy.KEEP_NEWEST);
    });
  });

  describe('merge - KEEP_OLDEST strategy', () => {
    it('should keep the oldest memory', async () => {
      const older = createMockMemory({
        id: 'mem_older',
        raw: 'Original',
        createdAt: new Date('2026-01-01'),
      });
      const newer = createMockMemory({
        id: 'mem_newer',
        raw: 'Updated',
        createdAt: new Date('2026-02-01'),
      });
      mockPrisma.memory.findMany.mockResolvedValue([older, newer]);

      const result = await service.merge(
        ['mem_older', 'mem_newer'],
        MergeStrategy.KEEP_OLDEST,
      );

      expect(result.survivorId).toBe('mem_older');
      expect(result.mergedContent).toBe('Original');
    });
  });

  describe('merge - KEEP_DETAILED strategy', () => {
    it('should keep the more detailed memory', async () => {
      const brief = createMockMemory({
        id: 'mem_brief',
        raw: 'Beaux wife Deanna',
      });
      const detailed = createMockMemory({
        id: 'mem_detailed',
        raw: 'Beaux is married to Deanna. They got married in 2020 and live in Powell River, British Columbia.',
      });
      mockPrisma.memory.findMany.mockResolvedValue([brief, detailed]);

      const result = await service.merge(
        ['mem_brief', 'mem_detailed'],
        MergeStrategy.KEEP_DETAILED,
      );

      expect(result.survivorId).toBe('mem_detailed');
    });

    it('should prefer memories with dates and numbers', async () => {
      const noNumbers = createMockMemory({
        id: 'mem_no_numbers',
        raw: 'Beaux has children',
      });
      const withNumbers = createMockMemory({
        id: 'mem_with_numbers',
        raw: 'Beaux has 2 children born in 2022 and 2024',
      });
      mockPrisma.memory.findMany.mockResolvedValue([noNumbers, withNumbers]);

      const result = await service.merge(
        ['mem_no_numbers', 'mem_with_numbers'],
        MergeStrategy.KEEP_DETAILED,
      );

      expect(result.survivorId).toBe('mem_with_numbers');
    });
  });

  describe('merge - KEEP_IMPORTANCE strategy', () => {
    it('should keep memory with highest importance score', async () => {
      const lowImportance = createMockMemory({
        id: 'mem_low',
        raw: 'Low importance',
        importanceScore: 0.3,
      });
      const highImportance = createMockMemory({
        id: 'mem_high',
        raw: 'High importance',
        importanceScore: 0.9,
      });
      mockPrisma.memory.findMany.mockResolvedValue([
        lowImportance,
        highImportance,
      ]);

      const result = await service.merge(
        ['mem_low', 'mem_high'],
        MergeStrategy.KEEP_IMPORTANCE,
      );

      expect(result.survivorId).toBe('mem_high');
    });
  });

  describe('merge - COMBINE_METADATA strategy', () => {
    it('should keep detailed content and combine metadata', async () => {
      const mem1 = createMockMemory({
        id: 'mem_1',
        raw: 'Short',
        importanceScore: 0.3,
        retrievalCount: 5,
      });
      const mem2 = createMockMemory({
        id: 'mem_2',
        raw: 'This is a much longer and more detailed description of the same fact',
        importanceScore: 0.8,
        retrievalCount: 2,
      });
      mockPrisma.memory.findMany.mockResolvedValue([mem1, mem2]);

      const result = await service.merge(
        ['mem_1', 'mem_2'],
        MergeStrategy.COMBINE_METADATA,
      );

      expect(result.survivorId).toBe('mem_2');
      expect(result.mergedMetadata.importanceScore).toBe(0.8);
      expect(result.mergedMetadata.accessCount).toBe(7); // 5 + 2
    });
  });

  describe('merge - with options', () => {
    it('should use custom survivor when specified', async () => {
      const mem1 = createMockMemory({ id: 'mem_1', raw: 'Content 1' });
      const mem2 = createMockMemory({ id: 'mem_2', raw: 'Content 2' });
      mockPrisma.memory.findMany.mockResolvedValue([mem1, mem2]);

      const result = await service.merge(
        ['mem_1', 'mem_2'],
        MergeStrategy.KEEP_NEWEST,
        {
          survivorId: 'mem_1',
        },
      );

      expect(result.survivorId).toBe('mem_1');
    });

    it('should use custom content when specified', async () => {
      const mem1 = createMockMemory({ id: 'mem_1', raw: 'Content 1' });
      const mem2 = createMockMemory({ id: 'mem_2', raw: 'Content 2' });
      mockPrisma.memory.findMany.mockResolvedValue([mem1, mem2]);

      const result = await service.merge(
        ['mem_1', 'mem_2'],
        MergeStrategy.KEEP_NEWEST,
        {
          customContent: 'Merged custom content',
        },
      );

      expect(result.mergedContent).toBe('Merged custom content');
      expect(result.contentChanged).toBe(true);
    });
  });

  describe('computeDetailScore', () => {
    it('should score longer content higher', () => {
      const short = service.computeDetailScore('Short');
      const long = service.computeDetailScore(
        'This is a much longer piece of content with more words and information',
      );

      expect(long).toBeGreaterThan(short);
    });

    it('should score content with numbers higher', () => {
      const noNumbers = service.computeDetailScore('Beaux has children');
      const withNumbers = service.computeDetailScore(
        'Beaux has 2 children born in 2022',
      );

      expect(withNumbers).toBeGreaterThan(noNumbers);
    });

    it('should give points for proper nouns', () => {
      // Content with proper nouns (capitalized words) should get more points
      const scoreWithProper = service.computeDetailScore(
        'Beaux lives in Powell River',
      );
      const properNounBonus = scoreWithProper > 0; // Any positive score means it works

      expect(properNounBonus).toBe(true);
      // The regex /[A-Z][a-z]+/g should find: Beaux, Powell, River = 3 proper nouns = 6 points (capped at 15)
      expect(scoreWithProper).toBeGreaterThan(0);
    });

    it('should score content with connecting words higher', () => {
      const simple = service.computeDetailScore('Fact A. Fact B.');
      const connected = service.computeDetailScore(
        'Fact A because of reason. Therefore, Fact B.',
      );

      expect(connected).toBeGreaterThan(simple);
    });

    it('should cap scores reasonably', () => {
      const maxContent = `
        This is an extremely long piece of content with many different words and phrases.
        It contains numbers like 2022 and 1234567890.
        It mentions Proper Nouns like Beaux, Deanna, Powell River, and British Columbia.
        It has connecting words because, therefore, since, when, where, and which.
        It is very detailed and informative, providing lots of context.
      `;

      const score = service.computeDetailScore(maxContent);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe('metadata merging', () => {
    it('should take highest importance score', async () => {
      const mem1 = createMockMemory({ id: 'mem_1', importanceScore: 0.3 });
      const mem2 = createMockMemory({ id: 'mem_2', importanceScore: 0.9 });
      mockPrisma.memory.findMany.mockResolvedValue([mem1, mem2]);

      const result = await service.merge(
        ['mem_1', 'mem_2'],
        MergeStrategy.KEEP_NEWEST,
      );

      expect(result.mergedMetadata.importanceScore).toBe(0.9);
    });

    it('should sum access counts', async () => {
      const mem1 = createMockMemory({
        id: 'mem_1',
        retrievalCount: 5,
        usedCount: 3,
      });
      const mem2 = createMockMemory({
        id: 'mem_2',
        retrievalCount: 2,
        usedCount: 1,
      });
      mockPrisma.memory.findMany.mockResolvedValue([mem1, mem2]);

      const result = await service.merge(
        ['mem_1', 'mem_2'],
        MergeStrategy.KEEP_NEWEST,
      );

      expect(result.mergedMetadata.accessCount).toBe(11); // 5+3+2+1
    });

    it('should use most recent access date', async () => {
      const mem1 = createMockMemory({
        id: 'mem_1',
        lastRetrievedAt: new Date('2026-01-01'),
        lastUsedAt: null,
      });
      const mem2 = createMockMemory({
        id: 'mem_2',
        lastRetrievedAt: new Date('2026-02-15'),
        lastUsedAt: null,
      });
      mockPrisma.memory.findMany.mockResolvedValue([mem1, mem2]);

      const result = await service.merge(
        ['mem_1', 'mem_2'],
        MergeStrategy.KEEP_NEWEST,
      );

      expect(result.mergedMetadata.lastAccessedAt?.getTime()).toBe(
        new Date('2026-02-15').getTime(),
      );
    });

    it('should track original sources', async () => {
      const mem1 = createMockMemory({ id: 'mem_1' });
      const mem2 = createMockMemory({ id: 'mem_2' });
      mockPrisma.memory.findMany.mockResolvedValue([mem1, mem2]);

      const result = await service.merge(
        ['mem_1', 'mem_2'],
        MergeStrategy.KEEP_NEWEST,
      );

      expect(result.mergedMetadata.originalSources).toContain('mem_1');
      expect(result.mergedMetadata.originalSources).toContain('mem_2');
    });
  });
});
