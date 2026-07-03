import { GenerateContextService } from './generate-context.service';

describe('GenerateContextService', () => {
  let service: GenerateContextService;
  let prisma: any;
  let eventEmitter: any;

  beforeEach(() => {
    prisma = {
      memory: { findMany: jest.fn() },
      $queryRawUnsafe: jest.fn(),
    };
    eventEmitter = { emit: jest.fn() };
    service = new GenerateContextService(prisma, eventEmitter);
  });

  describe('estimateTokens', () => {
    it('should estimate tokens as ~1.3x word count', () => {
      const tokens = service.estimateTokens('hello world foo bar');
      expect(tokens).toBeCloseTo(4 * 1.3, 1);
    });

    it('should return 0 for empty string', () => {
      expect(service.estimateTokens('')).toBe(0);
    });
  });

  describe('isDuplicate', () => {
    it('should detect high-overlap text as duplicate', () => {
      const existing = ['the quick brown fox jumps over the lazy dog'];
      expect(
        service.isDuplicate(
          'the quick brown fox jumps over the lazy cat',
          existing,
        ),
      ).toBe(true);
    });

    it('should not flag unrelated text as duplicate', () => {
      const existing = ['the quick brown fox jumps over the lazy dog'];
      expect(
        service.isDuplicate('python programming language is great', existing),
      ).toBe(false);
    });

    it('should detect empty text as duplicate', () => {
      expect(service.isDuplicate('', [])).toBe(true);
    });

    it('should detect substring containment as duplicate', () => {
      const existing = [
        'user prefers dark mode and large fonts and high contrast',
      ];
      expect(
        service.isDuplicate('user prefers dark mode and large fonts', existing),
      ).toBe(true);
    });
  });

  describe('generate', () => {
    it('should handle empty memory set', async () => {
      prisma.memory.findMany.mockResolvedValue([]);
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      const result = await service.generate({ agentId: 'agent-1' });
      expect(result.memoriesTotal).toBe(0);
      expect(result.memoriesIncluded).toBe(0);
      expect(result.markdown).toContain('# Memory Context');
    });

    it('should filter low-score memories', async () => {
      prisma.memory.findMany.mockResolvedValue([
        {
          id: 'm1',
          raw: 'important fact',
          effectiveScore: 0.9,
          confidence: 0.8,
          layer: 'IDENTITY',
          memoryType: 'FACT',
          subjectType: 'USER',
          usedCount: 5,
          createdAt: new Date(),
          safetyCritical: false,
          archivedReason: null,
          supersededById: null,
          consolidatedInto: null,
        },
        {
          id: 'm2',
          raw: 'low score junk',
          effectiveScore: 0.1,
          confidence: 0.2,
          layer: null,
          memoryType: null,
          subjectType: null,
          usedCount: 0,
          createdAt: new Date(),
          safetyCritical: false,
          archivedReason: null,
          supersededById: null,
          consolidatedInto: null,
        },
      ]);
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      const result = await service.generate({ agentId: 'agent-1' });
      expect(result.memoriesFiltered).toBe(1);
      expect(result.markdown).toContain('important fact');
      expect(result.markdown).not.toContain('low score junk');
    });

    it('should filter superseded memories', async () => {
      prisma.memory.findMany.mockResolvedValue([
        {
          id: 'm1',
          raw: 'superseded memory',
          effectiveScore: 0.9,
          confidence: 0.8,
          layer: null,
          memoryType: null,
          subjectType: null,
          usedCount: 0,
          createdAt: new Date(),
          safetyCritical: false,
          archivedReason: null,
          supersededById: 'm2',
          consolidatedInto: null,
        },
      ]);
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      const result = await service.generate({ agentId: 'agent-1' });
      expect(result.memoriesFiltered).toBe(1);
      expect(result.memoriesIncluded).toBe(0);
    });

    it('should respect token budget', async () => {
      const memories = Array.from({ length: 50 }, (_, i) => ({
        id: `m${i}`,
        raw: `Memory number ${i} with some content padding words here`,
        effectiveScore: 0.9,
        confidence: 0.8,
        layer: 'IDENTITY',
        memoryType: 'FACT',
        subjectType: 'USER',
        usedCount: 1,
        createdAt: new Date(),
        safetyCritical: false,
        archivedReason: null,
        supersededById: null,
        consolidatedInto: null,
      }));
      prisma.memory.findMany.mockResolvedValue(memories);
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      const result = await service.generate({
        agentId: 'agent-1',
        tokenBudget: 50,
      });
      expect(result.tokenCount).toBeLessThanOrEqual(100); // some overhead
    });

    it('should categorize LESSON memories as critical', async () => {
      const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      prisma.memory.findMany.mockResolvedValue([
        {
          id: 'm1',
          raw: 'Never deploy on Friday',
          effectiveScore: 0.9,
          confidence: 0.9,
          layer: null,
          memoryType: 'LESSON',
          subjectType: null,
          usedCount: 3,
          createdAt: oldDate,
          safetyCritical: false,
          archivedReason: null,
          supersededById: null,
          consolidatedInto: null,
        },
      ]);
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      const result = await service.generate({
        agentId: 'agent-1',
        includeStale: true,
      });
      expect(result.categories.keyLessons).toBe(1);
      expect(result.markdown).toContain('Key Lessons');
    });

    it('should emit context.regenerated event', async () => {
      prisma.memory.findMany.mockResolvedValue([]);
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      await service.generate({ agentId: 'agent-1' });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'context.regenerated',
        expect.anything(),
      );
    });

    it('should not write file in dryRun mode', async () => {
      prisma.memory.findMany.mockResolvedValue([]);
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      const result = await service.generate({
        agentId: 'agent-1',
        dryRun: true,
        writePath: '/tmp/test-context.md',
      });
      expect(result.writtenTo).toBeNull();
    });
  });
});
