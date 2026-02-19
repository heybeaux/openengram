import { Test, TestingModule } from '@nestjs/testing';
import { InsightGeneratorService, GeneratedInsight } from './insight-generator.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LLMService } from '../../llm/llm.service';
import { DetectedPattern } from './pattern-detector.service';

describe('InsightGeneratorService', () => {
  let service: InsightGeneratorService;
  let prisma: jest.Mocked<PrismaService>;
  let llmService: jest.Mocked<LLMService>;

  const makePattern = (overrides: Partial<DetectedPattern> = {}): DetectedPattern => ({
    type: 'recurring_pattern',
    description: 'Test pattern detected',
    confidence: 0.8,
    relatedMemoryIds: ['mem-1', 'mem-2'],
    sourceObservations: [{ id: 'obs-1', source: 'memory', content: 'test', observedAt: new Date() }],
    actionable: true,
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      memory: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as any;

    llmService = {
      chat: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InsightGeneratorService,
        { provide: PrismaService, useValue: prisma },
        { provide: LLMService, useValue: llmService },
      ],
    }).compile();

    service = module.get<InsightGeneratorService>(InsightGeneratorService);
  });

  describe('generate', () => {
    it('should return empty array for empty patterns', async () => {
      const result = await service.generate([], { maxLlmCalls: 1, maxInsights: 5 });
      expect(result).toEqual([]);
    });

    it('should filter out low-confidence patterns', async () => {
      const lowConfidence = makePattern({ confidence: 0.1, type: 'recurring_pattern' });

      // validateSources returns empty
      (prisma.memory.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.generate([lowConfidence], { maxLlmCalls: 1, maxInsights: 5 });
      expect(result).toEqual([]);
    });

    it('should passthrough non-pattern_connection types without LLM call', async () => {
      const pattern = makePattern({
        type: 'recurring_pattern',
        confidence: 0.8,
        relatedMemoryIds: ['mem-1'],
      });

      (prisma.memory.findMany as jest.Mock).mockResolvedValue([{ id: 'mem-1' }] as any);

      const result = await service.generate([pattern], { maxLlmCalls: 1, maxInsights: 5 });

      expect(llmService.chat).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Test pattern detected');
      expect(result[0].insightType).toBe('recurring_pattern');
      expect(result[0].sourceMemoryIds).toEqual(['mem-1']);
    });

    it('should use LLM for pattern_connection type', async () => {
      const pattern = makePattern({
        type: 'pattern_connection',
        confidence: 0.7,
        relatedMemoryIds: ['mem-1', 'mem-2'],
      });

      // Mock validateSources
      (prisma.memory.findMany as jest.Mock)
        .mockResolvedValueOnce([
          { id: 'mem-1', raw: 'Memory about X', layer: 'SESSION', createdAt: new Date(), agentId: null },
          { id: 'mem-2', raw: 'Memory about Y', layer: 'SESSION', createdAt: new Date(), agentId: null },
        ] as any)
        .mockResolvedValueOnce([{ id: 'mem-1' }, { id: 'mem-2' }] as any); // validateSources

      llmService.chat.mockResolvedValue({
        content: JSON.stringify({
          insights: [{
            content: 'X and Y are connected via Z',
            confidence: 0.75,
            actionable: true,
            type: 'pattern_connection',
          }],
        }),
        model: 'gpt-4o-mini',
      });

      const result = await service.generate([pattern], { maxLlmCalls: 1, maxInsights: 5 });

      expect(llmService.chat).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('X and Y are connected via Z');
      expect(result[0].confidence).toBe(0.75);
    });

    it('should respect maxInsights budget', async () => {
      const patterns = Array.from({ length: 10 }, (_, i) =>
        makePattern({
          type: 'recurring_pattern',
          confidence: 0.9 - i * 0.01,
          description: `Pattern ${i}`,
          relatedMemoryIds: [`mem-${i}`],
        }),
      );

      (prisma.memory.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.generate(patterns, { maxLlmCalls: 0, maxInsights: 3 });
      expect(result).toHaveLength(3);
    });

    it('should fall back to passthrough when LLM fails', async () => {
      const pattern = makePattern({
        type: 'pattern_connection',
        confidence: 0.8,
        description: 'Fallback description',
        relatedMemoryIds: ['mem-1'],
      });

      (prisma.memory.findMany as jest.Mock)
        .mockResolvedValueOnce([]) // synthesizeWithLlm memory fetch
        .mockResolvedValueOnce([{ id: 'mem-1' }] as any); // validateSources for passthrough

      llmService.chat.mockRejectedValue(new Error('LLM unavailable'));

      const result = await service.generate([pattern], { maxLlmCalls: 1, maxInsights: 5 });

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Fallback description');
    });

    it('should handle LLM returning JSON in markdown code block', async () => {
      const pattern = makePattern({
        type: 'pattern_connection',
        confidence: 0.7,
        relatedMemoryIds: ['mem-1'],
      });

      (prisma.memory.findMany as jest.Mock)
        .mockResolvedValueOnce([
          { id: 'mem-1', raw: 'test', layer: 'SESSION', createdAt: new Date(), agentId: null },
        ] as any)
        .mockResolvedValueOnce([{ id: 'mem-1' }] as any);

      llmService.chat.mockResolvedValue({
        content: '```json\n{"insights": [{"content": "Wrapped insight", "confidence": 0.6, "actionable": false, "type": "knowledge_gap"}]}\n```',
        model: 'gpt-4o-mini',
      });

      const result = await service.generate([pattern], { maxLlmCalls: 1, maxInsights: 5 });

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Wrapped insight');
    });

    it('should sort patterns by confidence (highest first)', async () => {
      const low = makePattern({ confidence: 0.5, description: 'Low', relatedMemoryIds: ['m1'] });
      const high = makePattern({ confidence: 0.9, description: 'High', relatedMemoryIds: ['m2'] });

      (prisma.memory.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.generate([low, high], { maxLlmCalls: 0, maxInsights: 2 });

      expect(result[0].content).toBe('High');
      expect(result[1].content).toBe('Low');
    });

    it('should validate source memory IDs and drop deleted ones', async () => {
      const pattern = makePattern({
        type: 'recurring_pattern',
        confidence: 0.8,
        relatedMemoryIds: ['mem-exists', 'mem-deleted'],
      });

      (prisma.memory.findMany as jest.Mock).mockResolvedValue([{ id: 'mem-exists' }] as any);

      const result = await service.generate([pattern], { maxLlmCalls: 0, maxInsights: 5 });

      expect(result[0].sourceMemoryIds).toEqual(['mem-exists']);
    });

    it('should not call LLM when maxLlmCalls is 0', async () => {
      const pattern = makePattern({
        type: 'pattern_connection',
        confidence: 0.9,
        relatedMemoryIds: ['mem-1'],
      });

      (prisma.memory.findMany as jest.Mock).mockResolvedValue([{ id: 'mem-1' }] as any);

      const result = await service.generate([pattern], { maxLlmCalls: 0, maxInsights: 5 });

      expect(llmService.chat).not.toHaveBeenCalled();
      // pattern_connection with 0 LLM budget goes to passthrough
      expect(result).toHaveLength(1);
    });
  });
});
