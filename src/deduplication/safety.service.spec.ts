import { Test, TestingModule } from '@nestjs/testing';
import { SafetyService, DEFAULT_SAFETY_CONFIG } from './safety.service';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryType } from '@prisma/client';
import { SafetyReasonType } from './dto/deduplication.dto';

describe('SafetyService', () => {
  let service: SafetyService;
  let prismaService: jest.Mocked<PrismaService>;

  const mockPrisma = {
    memory: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [SafetyService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<SafetyService>(SafetyService);
    prismaService = module.get(PrismaService);
  });

  describe('checkMemorySafety', () => {
    it('should protect CONSTRAINT type memories', async () => {
      mockPrisma.memory.findUnique.mockResolvedValue({
        id: 'mem_1',
        raw: 'Never do this',
        memoryType: MemoryType.CONSTRAINT,
        importanceScore: 0.5,
        lastRetrievedAt: null,
        userPinned: false,
      });

      const result = await service.checkMemorySafety('mem_1');

      expect(result.isProtected).toBe(true);
      expect(result.canAutoMerge).toBe(false);
      expect(result.reasons).toContainEqual({
        type: SafetyReasonType.PROTECTED_TYPE,
        memoryType: MemoryType.CONSTRAINT,
      });
    });

    it('should detect allergy keywords', async () => {
      mockPrisma.memory.findUnique.mockResolvedValue({
        id: 'mem_1',
        raw: 'I have a severe peanut allergy',
        memoryType: MemoryType.FACT,
        importanceScore: 0.5,
        lastRetrievedAt: null,
        userPinned: false,
      });

      const result = await service.checkMemorySafety('mem_1');

      expect(result.isProtected).toBe(true);
      expect(result.canAutoMerge).toBe(false);
      expect(result.reasons.some((r) => r.type === SafetyReasonType.PROTECTED_KEYWORD)).toBe(true);
    });

    it('should detect medication keywords', async () => {
      mockPrisma.memory.findUnique.mockResolvedValue({
        id: 'mem_1',
        raw: 'I take blood pressure medication daily',
        memoryType: MemoryType.FACT,
        importanceScore: 0.5,
        lastRetrievedAt: null,
        userPinned: false,
      });

      const result = await service.checkMemorySafety('mem_1');

      expect(result.isProtected).toBe(true);
      expect(result.reasons.some((r) => r.keyword === 'medication')).toBe(true);
    });

    it('should flag high-importance memories for review', async () => {
      mockPrisma.memory.findUnique.mockResolvedValue({
        id: 'mem_1',
        raw: 'Important fact',
        memoryType: MemoryType.FACT,
        importanceScore: 0.95,
        lastRetrievedAt: null,
        userPinned: false,
      });

      const result = await service.checkMemorySafety('mem_1');

      expect(result.requiresReview).toBe(true);
      expect(result.canAutoMerge).toBe(false);
      expect(result.reasons.some((r) => r.type === SafetyReasonType.HIGH_IMPORTANCE)).toBe(true);
    });

    it('should flag LESSON type for review', async () => {
      mockPrisma.memory.findUnique.mockResolvedValue({
        id: 'mem_1',
        raw: 'I learned that...',
        memoryType: MemoryType.LESSON,
        importanceScore: 0.5,
        lastRetrievedAt: null,
        userPinned: false,
      });

      const result = await service.checkMemorySafety('mem_1');

      expect(result.requiresReview).toBe(true);
      expect(result.reasons.some((r) => r.type === SafetyReasonType.REQUIRES_REVIEW)).toBe(true);
    });

    it('should flag recently accessed memories', async () => {
      mockPrisma.memory.findUnique.mockResolvedValue({
        id: 'mem_1',
        raw: 'Recently used',
        memoryType: MemoryType.FACT,
        importanceScore: 0.5,
        lastRetrievedAt: new Date(), // Just now
        userPinned: false,
      });

      const result = await service.checkMemorySafety('mem_1');

      expect(result.reasons.some((r) => r.type === SafetyReasonType.RECENTLY_ACCESSED)).toBe(true);
    });

    it('should flag user-pinned memories', async () => {
      mockPrisma.memory.findUnique.mockResolvedValue({
        id: 'mem_1',
        raw: 'Pinned memory',
        memoryType: MemoryType.FACT,
        importanceScore: 0.5,
        lastRetrievedAt: null,
        userPinned: true,
      });

      const result = await service.checkMemorySafety('mem_1');

      expect(result.requiresReview).toBe(true);
      expect(result.reasons.some((r) => r.type === SafetyReasonType.MANUALLY_EDITED)).toBe(true);
    });

    it('should allow auto-merge for regular FACT memories', async () => {
      mockPrisma.memory.findUnique.mockResolvedValue({
        id: 'mem_1',
        raw: 'Beaux lives in Powell River',
        memoryType: MemoryType.FACT,
        importanceScore: 0.5,
        lastRetrievedAt: null,
        userPinned: false,
      });

      const result = await service.checkMemorySafety('mem_1');

      expect(result.isProtected).toBe(false);
      expect(result.canAutoMerge).toBe(true);
      expect(result.requiresReview).toBe(false);
      expect(result.reasons.length).toBe(0);
    });

    it('should throw for non-existent memory', async () => {
      mockPrisma.memory.findUnique.mockResolvedValue(null);

      await expect(service.checkMemorySafety('mem_nonexistent')).rejects.toThrow('Memory not found');
    });
  });

  describe('checkMultipleSafety', () => {
    it('should check multiple memories', async () => {
      mockPrisma.memory.findUnique
        .mockResolvedValueOnce({
          id: 'mem_1',
          raw: 'Safe content',
          memoryType: MemoryType.FACT,
          importanceScore: 0.5,
          lastRetrievedAt: null,
          userPinned: false,
        })
        .mockResolvedValueOnce({
          id: 'mem_2',
          raw: 'Has allergy info',
          memoryType: MemoryType.FACT,
          importanceScore: 0.5,
          lastRetrievedAt: null,
          userPinned: false,
        });

      const results = await service.checkMultipleSafety(['mem_1', 'mem_2']);

      expect(results.length).toBe(2);
      expect(results[0].canAutoMerge).toBe(true);
      expect(results[1].isProtected).toBe(true);
    });
  });

  describe('canAutoMergePair', () => {
    it('should return true when both memories can auto-merge', async () => {
      mockPrisma.memory.findUnique.mockResolvedValue({
        id: 'mem_1',
        raw: 'Safe content',
        memoryType: MemoryType.FACT,
        importanceScore: 0.5,
        lastRetrievedAt: null,
        userPinned: false,
      });

      const result = await service.canAutoMergePair('mem_1', 'mem_2');

      expect(result.canAutoMerge).toBe(true);
      expect(result.reasons.length).toBe(0);
    });

    it('should return false when either memory is protected', async () => {
      mockPrisma.memory.findUnique
        .mockResolvedValueOnce({
          id: 'mem_1',
          raw: 'Safe',
          memoryType: MemoryType.FACT,
          importanceScore: 0.5,
          lastRetrievedAt: null,
          userPinned: false,
        })
        .mockResolvedValueOnce({
          id: 'mem_2',
          raw: 'Contains allergy warning',
          memoryType: MemoryType.FACT,
          importanceScore: 0.5,
          lastRetrievedAt: null,
          userPinned: false,
        });

      const result = await service.canAutoMergePair('mem_1', 'mem_2');

      expect(result.canAutoMerge).toBe(false);
    });
  });

  describe('containsProtectedKeywords', () => {
    it('should detect single keyword', () => {
      const result = service.containsProtectedKeywords('I have a nut allergy');

      expect(result.contains).toBe(true);
      expect(result.keywords).toContain('allergy');
    });

    it('should detect multiple keywords', () => {
      const result = service.containsProtectedKeywords(
        'My medication causes an allergic reaction',
      );

      expect(result.contains).toBe(true);
      expect(result.keywords.length).toBeGreaterThan(0);
    });

    it('should be case-insensitive', () => {
      const result = service.containsProtectedKeywords('ALLERGY WARNING');

      expect(result.contains).toBe(true);
    });

    it('should return false for safe content', () => {
      const result = service.containsProtectedKeywords('The weather is nice today');

      expect(result.contains).toBe(false);
      expect(result.keywords.length).toBe(0);
    });
  });

  describe('isProtectedType', () => {
    it('should return true for CONSTRAINT', () => {
      expect(service.isProtectedType(MemoryType.CONSTRAINT)).toBe(true);
    });

    it('should return false for FACT', () => {
      expect(service.isProtectedType(MemoryType.FACT)).toBe(false);
    });

    it('should return false for null', () => {
      expect(service.isProtectedType(null)).toBe(false);
    });
  });

  describe('requiresReviewType', () => {
    it('should return true for LESSON', () => {
      expect(service.requiresReviewType(MemoryType.LESSON)).toBe(true);
    });

    it('should return true for CONSTRAINT', () => {
      expect(service.requiresReviewType(MemoryType.CONSTRAINT)).toBe(true);
    });

    it('should return false for FACT', () => {
      expect(service.requiresReviewType(MemoryType.FACT)).toBe(false);
    });
  });

  describe('updateConfig', () => {
    it('should update safety configuration', () => {
      service.updateConfig({
        protectedKeywords: ['custom_keyword'],
        protectedImportanceThreshold: 0.8,
      });

      const config = service.getConfig();
      expect(config.protectedKeywords).toContain('custom_keyword');
      expect(config.protectedImportanceThreshold).toBe(0.8);
    });
  });

  describe('getConfig', () => {
    it('should return current configuration', () => {
      const config = service.getConfig();

      expect(config.protectedTypes).toEqual(DEFAULT_SAFETY_CONFIG.protectedTypes);
      expect(config.protectedKeywords).toEqual(DEFAULT_SAFETY_CONFIG.protectedKeywords);
    });
  });
});
