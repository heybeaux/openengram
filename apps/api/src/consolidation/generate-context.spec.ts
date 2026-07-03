import { GenerateContextService } from './generate-context.service';
import { PrismaService } from '../prisma/prisma.service';

// Helper to create a mock memory
function mockMemory(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 'mem-1',
    raw: overrides.raw ?? 'Test memory',
    effectiveScore: overrides.effectiveScore ?? 0.8,
    confidence: overrides.confidence ?? 1.0,
    layer: overrides.layer ?? 'IDENTITY',
    memoryType: overrides.memoryType ?? 'FACT',
    subjectType: overrides.subjectType ?? 'USER',
    usedCount: overrides.usedCount ?? 0,
    createdAt: overrides.createdAt ?? new Date(),
    safetyCritical: overrides.safetyCritical ?? false,
    archivedReason: overrides.archivedReason ?? null,
    supersededById: overrides.supersededById ?? null,
    consolidatedInto: overrides.consolidatedInto ?? null,
  };
}

describe('GenerateContextService', () => {
  let service: GenerateContextService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      memory: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    };
    service = new GenerateContextService(prisma as unknown as PrismaService);
  });

  describe('4.1 Staleness Detection', () => {
    it('should exclude stale memories by default', async () => {
      const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
      const staleMemory = mockMemory({
        id: 'stale-1',
        raw: 'Old stale memory that has not been accessed',
        createdAt: twentyDaysAgo,
      });
      const freshMemory = mockMemory({
        id: 'fresh-1',
        raw: 'Recent fresh memory created today',
        createdAt: new Date(),
      });

      prisma.memory.findMany.mockResolvedValue([staleMemory, freshMemory]);

      // First $queryRawUnsafe call = cluster assignments (empty)
      // Second call = access logs query (stale-1 has NO access)
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([]) // cluster assignments
        .mockResolvedValueOnce([]); // no access logs → stale-1 is stale

      const result = await service.generate({ agentId: 'agent-1' });

      expect(result.memoriesStale).toBe(1);
      expect(result.markdown).toContain('Recent fresh memory');
      expect(result.markdown).not.toContain('Old stale memory');
    });

    it('should include stale memories when includeStale=true', async () => {
      const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
      const staleMemory = mockMemory({
        id: 'stale-1',
        raw: 'Old stale memory included via flag',
        createdAt: twentyDaysAgo,
      });

      prisma.memory.findMany.mockResolvedValue([staleMemory]);
      prisma.$queryRawUnsafe.mockResolvedValue([]); // cluster assignments

      const result = await service.generate({
        agentId: 'agent-1',
        includeStale: true,
      });

      expect(result.memoriesStale).toBe(0);
      expect(result.markdown).toContain('Old stale memory included via flag');
    });

    it('should keep old memories that have recent access', async () => {
      const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
      const oldButAccessedMemory = mockMemory({
        id: 'old-accessed-1',
        raw: 'Old memory with recent access still relevant',
        createdAt: twentyDaysAgo,
      });

      prisma.memory.findMany.mockResolvedValue([oldButAccessedMemory]);
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([]) // cluster assignments
        .mockResolvedValueOnce([{ memory_id: 'old-accessed-1' }]); // has recent access

      const result = await service.generate({ agentId: 'agent-1' });

      expect(result.memoriesStale).toBe(0);
      expect(result.markdown).toContain('Old memory with recent access');
    });
  });

  describe('4.2 Section Prioritization with Token Budgets', () => {
    it('should allocate 40/40/20 budget split', async () => {
      prisma.memory.findMany.mockResolvedValue([]);
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      const result = await service.generate({
        agentId: 'agent-1',
        tokenBudget: 4000,
      });

      expect(result.budgetAllocation).toEqual({
        critical: 1600,
        relevant: 1600,
        background: 800,
      });
    });

    it('should respect custom tokenBudget', async () => {
      prisma.memory.findMany.mockResolvedValue([]);
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      const result = await service.generate({
        agentId: 'agent-1',
        tokenBudget: 2000,
      });

      expect(result.budgetAllocation).toEqual({
        critical: 800,
        relevant: 800,
        background: 400,
      });
    });

    it('should prioritize critical memories (identity, lessons) over background', async () => {
      const memories = [
        // Critical: user identity
        mockMemory({
          id: 'identity-1',
          raw: 'User identity fact about the person',
          memoryType: 'FACT',
          subjectType: 'USER',
          layer: 'IDENTITY',
          effectiveScore: 0.9,
          createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        }),
        // Critical: lesson
        mockMemory({
          id: 'lesson-1',
          raw: 'Important lesson learned from experience',
          memoryType: 'LESSON',
          layer: 'META',
          effectiveScore: 0.85,
          createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        }),
        // Background: old project
        mockMemory({
          id: 'project-1',
          raw: 'Old project background information details',
          memoryType: 'TASK',
          layer: 'PROJECT',
          effectiveScore: 0.7,
          createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        }),
      ];

      prisma.memory.findMany.mockResolvedValue(memories);
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([]) // clusters
        .mockResolvedValueOnce(memories.map((m) => ({ memory_id: m.id }))); // all accessed recently

      // Use a very small budget so only critical fits
      const result = await service.generate({
        agentId: 'agent-1',
        tokenBudget: 30,
      });

      // Critical should be included, background might not fit
      expect(
        result.categories.keyLessons + result.categories.userIdentity,
      ).toBeGreaterThan(0);
    });

    it('should default to 4000 tokens when no budget specified', async () => {
      prisma.memory.findMany.mockResolvedValue([]);
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      const result = await service.generate({ agentId: 'agent-1' });

      expect(
        result.budgetAllocation.critical +
          result.budgetAllocation.relevant +
          result.budgetAllocation.background,
      ).toBe(4000);
    });
  });

  describe('4.3 Dedup in Context Output', () => {
    it('should remove near-duplicate memories via embedding similarity', async () => {
      const mem1 = mockMemory({
        id: 'dup-1',
        raw: 'The user prefers dark mode in their editor',
        effectiveScore: 0.9,
      });
      const mem2 = mockMemory({
        id: 'dup-2',
        raw: 'The user likes dark mode for editing code',
        effectiveScore: 0.7,
      });

      prisma.memory.findMany.mockResolvedValue([mem1, mem2]);
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([]) // cluster assignments
        .mockResolvedValueOnce([
          // embedding similarity > 0.92
          {
            id1: 'dup-1',
            id2: 'dup-2',
            similarity: 0.95,
            score1: 0.9,
            score2: 0.7,
          },
        ]);

      const result = await service.generate({ agentId: 'agent-1' });

      expect(result.memoriesDeduped).toBe(1);
      // dup-1 (higher score) should be kept, dup-2 removed
      expect(result.markdown).toContain('dark mode in their editor');
      expect(result.markdown).not.toContain('dark mode for editing code');
    });

    it('should keep both memories when similarity is below threshold', async () => {
      const mem1 = mockMemory({
        id: 'diff-1',
        raw: 'User works on frontend projects with React',
        effectiveScore: 0.8,
      });
      const mem2 = mockMemory({
        id: 'diff-2',
        raw: 'User enjoys backend development with Python',
        effectiveScore: 0.75,
      });

      prisma.memory.findMany.mockResolvedValue([mem1, mem2]);
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([]) // clusters
        .mockResolvedValueOnce([]); // no similar pairs

      const result = await service.generate({ agentId: 'agent-1' });

      expect(result.memoriesDeduped).toBe(0);
    });

    it('should fall back to text dedup when embedding query fails', async () => {
      const mem1 = mockMemory({
        id: 'text-dup-1',
        raw: 'Beaux prefers dark chocolate over milk chocolate',
        effectiveScore: 0.8,
      });
      const mem2 = mockMemory({
        id: 'text-dup-2',
        raw: 'Beaux prefers dark chocolate over milk chocolate always',
        effectiveScore: 0.7,
      });

      prisma.memory.findMany.mockResolvedValue([mem1, mem2]);
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([]) // clusters
        .mockRejectedValueOnce(new Error('no embedding column')); // embedding query fails

      const result = await service.generate({ agentId: 'agent-1' });

      // Text-based dedup should catch this via Jaccard similarity
      expect(result.memoriesIncluded).toBeLessThanOrEqual(1);
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens as word count * 1.3', () => {
      expect(service.estimateTokens('hello world')).toBeCloseTo(2.6);
      expect(service.estimateTokens('one two three four five')).toBeCloseTo(
        6.5,
      );
    });
  });

  describe('isDuplicate', () => {
    it('should detect high Jaccard similarity', () => {
      expect(
        service.isDuplicate('the quick brown fox jumps', [
          'the quick brown fox leaps',
        ]),
      ).toBe(true);
    });

    it('should not flag different texts', () => {
      expect(
        service.isDuplicate('apples and oranges are fruits', [
          'programming languages include python and rust',
        ]),
      ).toBe(false);
    });
  });

  describe('backward compatibility', () => {
    it('should work with no new params (existing behavior)', async () => {
      const mem = mockMemory({ id: 'compat-1', raw: 'Compatible memory text' });
      prisma.memory.findMany.mockResolvedValue([mem]);
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      const result = await service.generate({ agentId: 'agent-1' });

      expect(result.markdown).toContain('Compatible memory text');
      expect(result.memoriesIncluded).toBe(1);
      // New fields exist but don't break
      expect(result.memoriesStale).toBeDefined();
      expect(result.memoriesDeduped).toBeDefined();
      expect(result.budgetAllocation).toBeDefined();
    });
  });
});
