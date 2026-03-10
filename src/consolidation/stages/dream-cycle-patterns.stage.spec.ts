import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DreamCyclePatternsStage,
  PatternsStageResult,
} from './dream-cycle-patterns.stage';
import { PrismaService } from '../../prisma/prisma.service';
import { ConsolidationService } from '../../memory/consolidation.service';
import { LLMService } from '../../llm/llm.service';

describe('DreamCyclePatternsStage', () => {
  let stage: DreamCyclePatternsStage;
  let prisma: any;
  let consolidation: any;
  let llm: any;
  let eventEmitter: any;

  const userId = 'user-1';

  beforeEach(async () => {
    prisma = {
      memory: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'pattern-1' }),
      },
      memoryChainLink: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    consolidation = {
      promoteRecurringPatterns: jest.fn().mockResolvedValue({
        clustersFound: 0,
        details: [],
      }),
    };

    llm = {
      json: jest.fn(),
    };

    eventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DreamCyclePatternsStage,
        { provide: PrismaService, useValue: prisma },
        { provide: ConsolidationService, useValue: consolidation },
        { provide: LLMService, useValue: llm },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'DREAM_PATTERN_MIN_SIZE') return '3';
              return undefined;
            }),
          },
        },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    stage = module.get<DreamCyclePatternsStage>(DreamCyclePatternsStage);
  });

  describe('run()', () => {
    it('should return zero results when no clusters found', async () => {
      const result = await stage.run(userId, false, 5);

      expect(result).toEqual({
        patternsCreated: 0,
        clustersFound: 0,
        llmCalls: 0,
      });
      expect(consolidation.promoteRecurringPatterns).toHaveBeenCalledWith(
        userId,
        {
          dryRun: true,
          minOccurrences: 3,
          similarityThreshold: 0.65,
        },
      );
    });

    it('should return zero results when LLM budget is zero', async () => {
      consolidation.promoteRecurringPatterns.mockResolvedValue({
        clustersFound: 2,
        details: [{ canonicalId: 'c1', duplicateIds: ['d1', 'd2', 'd3'] }],
      });

      const result = await stage.run(userId, false, 0);

      expect(result.patternsCreated).toBe(0);
      expect(result.llmCalls).toBe(0);
      expect(result.clustersFound).toBe(2);
    });

    it('should create pattern when LLM returns high confidence', async () => {
      consolidation.promoteRecurringPatterns.mockResolvedValue({
        clustersFound: 1,
        details: [{ canonicalId: 'c1', duplicateIds: ['d1', 'd2'] }],
      });

      prisma.memory.findMany.mockResolvedValue([
        { id: 'c1', raw: 'Memory 1' },
        { id: 'd1', raw: 'Memory 2' },
        { id: 'd2', raw: 'Memory 3' },
      ]);

      // No existing pattern
      prisma.memory.findFirst
        .mockResolvedValueOnce(null) // existingPattern check
        .mockResolvedValueOnce({ id: 'pattern-1' }); // find created pattern

      llm.json.mockResolvedValue({
        summary: 'User frequently works on project Alpha',
        confidence: 0.85,
      });

      const result = await stage.run(userId, false, 5);

      expect(result.patternsCreated).toBe(1);
      expect(result.llmCalls).toBe(1);
      expect(prisma.memory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId,
            layer: 'IDENTITY',
            source: 'PATTERN_DETECTED',
            memoryType: 'FACT',
          }),
        }),
      );
    });

    it('should skip pattern with low confidence', async () => {
      consolidation.promoteRecurringPatterns.mockResolvedValue({
        clustersFound: 1,
        details: [{ canonicalId: 'c1', duplicateIds: ['d1', 'd2'] }],
      });

      prisma.memory.findMany.mockResolvedValue([
        { id: 'c1', raw: 'Mem 1' },
        { id: 'd1', raw: 'Mem 2' },
        { id: 'd2', raw: 'Mem 3' },
      ]);
      prisma.memory.findFirst.mockResolvedValue(null);

      llm.json.mockResolvedValue({
        summary: 'Weak pattern',
        confidence: 0.3,
      });

      const result = await stage.run(userId, false, 5);

      expect(result.patternsCreated).toBe(0);
      expect(prisma.memory.create).not.toHaveBeenCalled();
    });

    it('should skip cluster with existing pattern', async () => {
      consolidation.promoteRecurringPatterns.mockResolvedValue({
        clustersFound: 1,
        details: [{ canonicalId: 'c1', duplicateIds: ['d1', 'd2'] }],
      });

      prisma.memory.findMany.mockResolvedValue([
        { id: 'c1', raw: 'Mem 1' },
        { id: 'd1', raw: 'Mem 2' },
        { id: 'd2', raw: 'Mem 3' },
      ]);

      // Existing pattern found
      prisma.memory.findFirst.mockResolvedValue({ id: 'existing-pattern' });

      const result = await stage.run(userId, false, 5);

      expect(result.patternsCreated).toBe(0);
      expect(llm.json).not.toHaveBeenCalled();
    });

    it('should skip cluster below minimum size', async () => {
      consolidation.promoteRecurringPatterns.mockResolvedValue({
        clustersFound: 1,
        details: [{ canonicalId: 'c1', duplicateIds: ['d1'] }],
      });

      // Only 2 memories found (below min size of 3)
      prisma.memory.findMany.mockResolvedValue([
        { id: 'c1', raw: 'Mem 1' },
        { id: 'd1', raw: 'Mem 2' },
      ]);
      prisma.memory.findFirst.mockResolvedValue(null);

      const result = await stage.run(userId, false, 5);

      expect(result.patternsCreated).toBe(0);
      expect(llm.json).not.toHaveBeenCalled();
    });

    it('should not create memories in dry run mode', async () => {
      consolidation.promoteRecurringPatterns.mockResolvedValue({
        clustersFound: 1,
        details: [{ canonicalId: 'c1', duplicateIds: ['d1', 'd2'] }],
      });

      prisma.memory.findMany.mockResolvedValue([
        { id: 'c1', raw: 'Mem 1' },
        { id: 'd1', raw: 'Mem 2' },
        { id: 'd2', raw: 'Mem 3' },
      ]);
      prisma.memory.findFirst.mockResolvedValue(null);

      llm.json.mockResolvedValue({
        summary: 'Pattern found',
        confidence: 0.8,
      });

      const result = await stage.run(userId, true, 5);

      expect(result.patternsCreated).toBe(1);
      expect(result.llmCalls).toBe(1);
      expect(prisma.memory.create).not.toHaveBeenCalled();
    });

    it('should respect LLM budget limit', async () => {
      consolidation.promoteRecurringPatterns.mockResolvedValue({
        clustersFound: 3,
        details: [
          { canonicalId: 'c1', duplicateIds: ['d1', 'd2'] },
          { canonicalId: 'c2', duplicateIds: ['d3', 'd4'] },
          { canonicalId: 'c3', duplicateIds: ['d5', 'd6'] },
        ],
      });

      prisma.memory.findMany.mockResolvedValue([
        { id: 'c1', raw: 'Mem 1' },
        { id: 'd1', raw: 'Mem 2' },
        { id: 'd2', raw: 'Mem 3' },
      ]);
      prisma.memory.findFirst.mockResolvedValue(null);

      llm.json.mockResolvedValue({
        summary: 'Pattern',
        confidence: 0.8,
      });

      const result = await stage.run(userId, true, 1);

      // Should only make 1 LLM call despite 3 clusters
      expect(result.llmCalls).toBe(1);
    });

    it('should handle LLM errors gracefully', async () => {
      consolidation.promoteRecurringPatterns.mockResolvedValue({
        clustersFound: 1,
        details: [{ canonicalId: 'c1', duplicateIds: ['d1', 'd2'] }],
      });

      prisma.memory.findMany.mockResolvedValue([
        { id: 'c1', raw: 'Mem 1' },
        { id: 'd1', raw: 'Mem 2' },
        { id: 'd2', raw: 'Mem 3' },
      ]);
      prisma.memory.findFirst.mockResolvedValue(null);

      llm.json.mockRejectedValue(new Error('LLM service unavailable'));

      const result = await stage.run(userId, false, 5);

      expect(result.patternsCreated).toBe(0);
      expect(result.llmCalls).toBe(0); // llmCalls incremented after the call
    });

    it('should create chain links from source memories to pattern', async () => {
      consolidation.promoteRecurringPatterns.mockResolvedValue({
        clustersFound: 1,
        details: [{ canonicalId: 'c1', duplicateIds: ['d1', 'd2'] }],
      });

      const memories = [
        { id: 'c1', raw: 'Mem 1' },
        { id: 'd1', raw: 'Mem 2' },
        { id: 'd2', raw: 'Mem 3' },
      ];
      prisma.memory.findMany.mockResolvedValue(memories);
      prisma.memory.findFirst
        .mockResolvedValueOnce(null) // no existing pattern
        .mockResolvedValueOnce({ id: 'pattern-1' }); // find created pattern

      llm.json.mockResolvedValue({
        summary: 'Pattern about Alpha',
        confidence: 0.75,
      });

      await stage.run(userId, false, 5);

      // Should create 3 chain links (one per source memory)
      expect(prisma.memoryChainLink.create).toHaveBeenCalledTimes(3);
      expect(prisma.memoryChainLink.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            targetId: 'pattern-1',
            linkType: 'SUPPORTS',
            createdBy: 'dream-cycle',
          }),
        }),
      );
    });

    it('should emit dream.pattern_found event', async () => {
      consolidation.promoteRecurringPatterns.mockResolvedValue({
        clustersFound: 1,
        details: [{ canonicalId: 'c1', duplicateIds: ['d1', 'd2'] }],
      });

      prisma.memory.findMany.mockResolvedValue([
        { id: 'c1', raw: 'Mem 1' },
        { id: 'd1', raw: 'Mem 2' },
        { id: 'd2', raw: 'Mem 3' },
      ]);
      prisma.memory.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'pattern-1' });

      llm.json.mockResolvedValue({
        summary: 'Found pattern',
        confidence: 0.9,
      });

      await stage.run(userId, false, 5);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'dream.pattern_found',
        expect.objectContaining({
          patternId: 'pattern-1',
          description: 'Found pattern',
        }),
      );
    });
  });
});
