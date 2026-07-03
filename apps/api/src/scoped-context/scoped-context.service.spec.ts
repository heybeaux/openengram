import { Test, TestingModule } from '@nestjs/testing';
import { ScopedContextService } from './scoped-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { AgentSessionService } from '../agent-session/agent-session.service';
import { MemoryPoolService } from '../memory-pool/memory-pool.service';
import { MemoryAccessLogService } from '../memory-access-log/memory-access-log.service';
import { EmbeddingService } from '../memory/embedding.service';

describe('ScopedContextService', () => {
  let service: ScopedContextService;
  let prisma: any;
  let agentSessionService: any;
  let memoryPoolService: any;
  let accessLogService: any;
  let embeddingService: any;

  beforeEach(async () => {
    prisma = {
      memory: { findMany: jest.fn().mockResolvedValue([]) },
      memoryPoolMembership: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    };

    agentSessionService = {
      findByKey: jest.fn().mockResolvedValue(null),
    };

    memoryPoolService = {
      getAccessiblePoolIds: jest.fn().mockResolvedValue([]),
    };

    accessLogService = {
      logInjected: jest.fn(),
    };

    embeddingService = {
      generate: jest.fn().mockResolvedValue(new Array(768).fill(0.1)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScopedContextService,
        { provide: PrismaService, useValue: prisma },
        { provide: AgentSessionService, useValue: agentSessionService },
        { provide: MemoryPoolService, useValue: memoryPoolService },
        { provide: MemoryAccessLogService, useValue: accessLogService },
        { provide: EmbeddingService, useValue: embeddingService },
      ],
    }).compile();

    service = module.get<ScopedContextService>(ScopedContextService);
  });

  describe('scoreMemories', () => {
    it('should compute finalScore using the weighted formula', async () => {
      const now = new Date();
      const candidates = [
        {
          id: 'mem1',
          raw: 'Test memory',
          memoryType: 'FACT',
          effectiveScore: 0.8,
          safetyCritical: false,
          priority: 3,
          createdAt: now,
          retrievalCount: 5,
          layer: 'SESSION',
        },
      ];

      const scored = await service.scoreMemories(candidates, null);
      expect(scored).toHaveLength(1);
      expect(scored[0].finalScore).toBeGreaterThan(0);

      // Without task embedding, taskSimilarity = 0
      // finalScore = 0.4*0 + 0.3*0.8 + 0.2*1.0(recent) + 0.1*log(6)/10
      const expected = 0.3 * 0.8 + 0.2 * 1.0 + 0.1 * (Math.log(6) / 10);
      expect(scored[0].finalScore).toBeCloseTo(expected, 2);
    });

    it('should apply 1.5x multiplier for CONSTRAINT type', async () => {
      const now = new Date();
      const candidates = [
        {
          id: 'mem1',
          raw: 'Never do X',
          memoryType: 'CONSTRAINT',
          effectiveScore: 0.8,
          safetyCritical: false,
          priority: 1,
          createdAt: now,
          retrievalCount: 0,
          layer: 'IDENTITY',
        },
        {
          id: 'mem2',
          raw: 'Some fact',
          memoryType: 'FACT',
          effectiveScore: 0.8,
          safetyCritical: false,
          priority: 3,
          createdAt: now,
          retrievalCount: 0,
          layer: 'IDENTITY',
        },
      ];

      const scored = await service.scoreMemories(candidates, null);
      // CONSTRAINT should have 1.5x the score of FACT with same inputs
      expect(scored[0].finalScore).toBeCloseTo(scored[1].finalScore * 1.5, 2);
    });

    it('should apply 1.5x multiplier for LESSON type', async () => {
      const now = new Date();
      const candidates = [
        {
          id: 'mem1',
          raw: 'I learned X',
          memoryType: 'LESSON',
          effectiveScore: 0.5,
          safetyCritical: false,
          priority: 1,
          createdAt: now,
          retrievalCount: 0,
          layer: 'IDENTITY',
        },
      ];

      const scored = await service.scoreMemories(candidates, null);
      const baseScore = 0.3 * 0.5 + 0.2 * 1.0 + 0.1 * 0;
      expect(scored[0].finalScore).toBeCloseTo(baseScore * 1.5, 2);
    });

    it('should reduce recency weight for older memories', async () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const candidates = [
        {
          id: 'recent',
          raw: 'Recent',
          memoryType: 'FACT',
          effectiveScore: 0.5,
          safetyCritical: false,
          priority: 3,
          createdAt: now,
          retrievalCount: 0,
          layer: 'SESSION',
        },
        {
          id: 'old',
          raw: 'Old',
          memoryType: 'FACT',
          effectiveScore: 0.5,
          safetyCritical: false,
          priority: 3,
          createdAt: thirtyDaysAgo,
          retrievalCount: 0,
          layer: 'SESSION',
        },
      ];

      const scored = await service.scoreMemories(candidates, null);
      const recent = scored.find((s) => s.id === 'recent')!;
      const old = scored.find((s) => s.id === 'old')!;
      expect(recent.finalScore).toBeGreaterThan(old.finalScore);
    });
  });

  describe('selectByBudget', () => {
    it('should always include safety-critical memories', () => {
      const scored = [
        makeScoredMemory('crit1', {
          safetyCritical: true,
          tokens: 100,
          raw: 'x'.repeat(400),
        }),
        makeScoredMemory('normal1', {
          finalScore: 0.9,
          tokens: 50,
          raw: 'y'.repeat(200),
        }),
      ];

      const { critical } = service.selectByBudget(scored, 200);
      expect(critical.some((m) => m.id === 'crit1')).toBe(true);
    });

    it('should prioritize CONSTRAINT/LESSON in critical bucket', () => {
      const scored = [
        makeScoredMemory('constraint1', {
          memoryType: 'CONSTRAINT',
          finalScore: 0.8,
          tokens: 50,
        }),
        makeScoredMemory('lesson1', {
          memoryType: 'LESSON',
          finalScore: 0.7,
          tokens: 50,
        }),
        makeScoredMemory('fact1', {
          memoryType: 'FACT',
          finalScore: 0.9,
          tokens: 50,
        }),
      ];

      const { critical } = service.selectByBudget(scored, 1000);
      const criticalIds = critical.map((m) => m.id);
      expect(criticalIds).toContain('constraint1');
      expect(criticalIds).toContain('lesson1');
    });

    it('should respect token budget', () => {
      const scored = Array.from({ length: 20 }, (_, i) =>
        makeScoredMemory(`mem${i}`, { finalScore: 1 - i * 0.05, tokens: 100 }),
      );

      const { critical, taskRelevant, background } = service.selectByBudget(
        scored,
        500,
      );
      const totalTokens = [...critical, ...taskRelevant, ...background].reduce(
        (sum, m) => sum + m.tokens,
        0,
      );
      // Should not exceed budget significantly (critical can overflow by 10%)
      expect(totalTokens).toBeLessThanOrEqual(600); // 500 + 10% overflow allowance
    });

    it('should allocate ~50% to task-relevant', () => {
      const scored = Array.from({ length: 50 }, (_, i) =>
        makeScoredMemory(`mem${i}`, {
          finalScore: 1 - i * 0.02,
          tokens: 20,
          memoryType: 'FACT',
        }),
      );

      const { taskRelevant } = service.selectByBudget(scored, 2000);
      const taskTokens = taskRelevant.reduce((sum, m) => sum + m.tokens, 0);
      // Task budget is 50% = 1000 tokens
      expect(taskTokens).toBeLessThanOrEqual(1000);
      expect(taskTokens).toBeGreaterThan(0);
    });
  });

  describe('formatMarkdown', () => {
    it('should include task description in header', () => {
      const result = service.formatMarkdown('Build API', [], [], [], 0);
      expect(result).toContain('Task: Build API');
    });

    it('should include all three sections', () => {
      const critical = [makeScoredMemory('c1', { raw: 'Critical fact' })];
      const taskRelevant = [makeScoredMemory('t1', { raw: 'Task fact' })];
      const background = [makeScoredMemory('b1', { raw: 'Background fact' })];

      const result = service.formatMarkdown(
        'Test',
        critical,
        taskRelevant,
        background,
        100,
      );
      expect(result).toContain('## Critical (always included)');
      expect(result).toContain('- Critical fact');
      expect(result).toContain('## Task-Relevant');
      expect(result).toContain('- Task fact');
      expect(result).toContain('## Background');
      expect(result).toContain('- Background fact');
    });

    it('should omit empty sections', () => {
      const result = service.formatMarkdown('Test', [], [], [], 0);
      expect(result).not.toContain('## Critical');
      expect(result).not.toContain('## Task-Relevant');
      expect(result).not.toContain('## Background');
    });

    it('should show token count', () => {
      const result = service.formatMarkdown(null, [], [], [], 1500);
      expect(result).toContain('1500 tokens');
    });
  });

  describe('generateScopedContext', () => {
    it('should fall back to session taskDescription when not provided', async () => {
      agentSessionService.findByKey.mockResolvedValue({
        sessionKey: 'agent:main:subagent:test',
        taskDescription: 'Build the widget',
      });
      memoryPoolService.getAccessiblePoolIds.mockResolvedValue([]);
      prisma.memory.findMany.mockResolvedValue([]);

      const result = await service.generateScopedContext({
        userId: 'user1',
        agentSessionKey: 'agent:main:subagent:test',
      });

      expect(result.taskDescription).toBe('Build the widget');
    });

    it('should use override taskDescription over session', async () => {
      agentSessionService.findByKey.mockResolvedValue({
        sessionKey: 'agent:main:subagent:test',
        taskDescription: 'Original task',
      });
      memoryPoolService.getAccessiblePoolIds.mockResolvedValue([]);
      prisma.memory.findMany.mockResolvedValue([]);

      const result = await service.generateScopedContext({
        userId: 'user1',
        agentSessionKey: 'agent:main:subagent:test',
        taskDescription: 'Override task',
      });

      expect(result.taskDescription).toBe('Override task');
    });

    it('should return valid response with no memories', async () => {
      memoryPoolService.getAccessiblePoolIds.mockResolvedValue([]);
      prisma.memory.findMany.mockResolvedValue([]);

      const result = await service.generateScopedContext({
        userId: 'user1',
        agentSessionKey: 'agent:main:subagent:test',
      });

      expect(result.memoriesIncluded).toBe(0);
      expect(result.tokenCount).toBe(0);
      expect(result.context).toContain('# Task Context (via Engram)');
    });

    it('should log injected memories', async () => {
      memoryPoolService.getAccessiblePoolIds.mockResolvedValue([]);
      prisma.memory.findMany.mockResolvedValue([
        {
          id: 'mem1',
          raw: 'Test memory content',
          memoryType: 'FACT',
          effectiveScore: 0.8,
          safetyCritical: false,
          priority: 3,
          createdAt: new Date(),
          retrievalCount: 0,
          layer: 'SESSION',
        },
      ]);

      await service.generateScopedContext({
        userId: 'user1',
        agentSessionKey: 'agent:main:subagent:test',
      });

      expect(accessLogService.logInjected).toHaveBeenCalled();
    });

    it('backward compat: no pools returns all user memories', async () => {
      memoryPoolService.getAccessiblePoolIds.mockResolvedValue([]);
      prisma.memory.findMany.mockResolvedValue([]);

      await service.generateScopedContext({
        userId: 'user1',
        agentSessionKey: 'agent:main',
      });

      // Should have queried memories without pool filter
      expect(prisma.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user1' }),
        }),
      );
    });

    it('should use session contextTokenBudget when maxTokens not provided', async () => {
      agentSessionService.findByKey.mockResolvedValue({
        sessionKey: 'agent:main:subagent:test',
        taskDescription: 'Build widget',
        contextTokenBudget: 3000,
      });
      memoryPoolService.getAccessiblePoolIds.mockResolvedValue([]);
      // Create enough memories to test budget is respected
      const memories = Array.from({ length: 50 }, (_, i) => ({
        id: `mem${i}`,
        raw: 'x'.repeat(200), // ~50 tokens each
        memoryType: 'FACT',
        effectiveScore: 0.8 - i * 0.01,
        safetyCritical: false,
        priority: 3,
        createdAt: new Date(),
        retrievalCount: 0,
        layer: 'SESSION',
      }));
      prisma.memory.findMany.mockResolvedValue(memories);

      const result = await service.generateScopedContext({
        userId: 'user1',
        agentSessionKey: 'agent:main:subagent:test',
      });

      // Should respect the 3000 token budget from session
      expect(result.tokenCount).toBeLessThanOrEqual(3300); // 10% overflow for critical
    });

    it('should prefer explicit maxTokens over session contextTokenBudget', async () => {
      agentSessionService.findByKey.mockResolvedValue({
        sessionKey: 'agent:main:subagent:test',
        contextTokenBudget: 4000,
      });
      memoryPoolService.getAccessiblePoolIds.mockResolvedValue([]);
      prisma.memory.findMany.mockResolvedValue([]);

      const result = await service.generateScopedContext({
        userId: 'user1',
        agentSessionKey: 'agent:main:subagent:test',
        maxTokens: 1000,
      });

      // With no memories, can't test budget directly, but it shouldn't error
      expect(result.memoriesIncluded).toBe(0);
    });

    it('should default to 2000 tokens when no session budget and no maxTokens', async () => {
      agentSessionService.findByKey.mockResolvedValue({
        sessionKey: 'agent:main:subagent:test',
        contextTokenBudget: null,
      });
      memoryPoolService.getAccessiblePoolIds.mockResolvedValue([]);
      prisma.memory.findMany.mockResolvedValue([]);

      const result = await service.generateScopedContext({
        userId: 'user1',
        agentSessionKey: 'agent:main:subagent:test',
      });

      expect(result.memoriesIncluded).toBe(0);
    });
  });
});

function makeScoredMemory(id: string, overrides: Partial<any> = {}): any {
  return {
    id,
    raw: overrides.raw ?? `Memory ${id}`,
    memoryType: overrides.memoryType ?? 'FACT',
    effectiveScore: overrides.effectiveScore ?? 0.5,
    safetyCritical: overrides.safetyCritical ?? false,
    priority: overrides.priority ?? 3,
    createdAt: overrides.createdAt ?? new Date(),
    retrievalCount: overrides.retrievalCount ?? 0,
    layer: overrides.layer ?? 'SESSION',
    taskSimilarity: overrides.taskSimilarity ?? 0,
    finalScore: overrides.finalScore ?? 0.5,
    tokens: overrides.tokens ?? Math.ceil((overrides.raw?.length ?? 10) / 4),
  };
}
