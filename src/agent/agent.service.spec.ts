import { Test, TestingModule } from '@nestjs/testing';
import { AgentService } from './agent.service';
import { PrismaService } from '../prisma/prisma.service';
import { LLMService } from '../llm/llm.service';
import { EmbeddingService } from '../memory/embedding.service';
import { MemoryLayer, MemorySource, SubjectType } from '@prisma/client';

describe('AgentService', () => {
  let service: AgentService;
  let mockPrisma: any;
  let mockLLM: any;
  let mockEmbedding: any;

  const mockAgentId = 'test-agent-rook';

  beforeEach(async () => {
    mockPrisma = {
      memory: {
        create: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      memoryExtraction: {
        create: jest.fn(),
      },
    };

    mockLLM = {
      json: jest.fn(),
    };

    mockEmbedding = {
      generate: jest.fn(),
      store: jest.fn(),
      search: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LLMService, useValue: mockLLM },
        { provide: EmbeddingService, useValue: mockEmbedding },
      ],
    }).compile();

    service = module.get<AgentService>(AgentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('reflect', () => {
    it('should extract insights and create agent memories', async () => {
      // Mock LLM response with insights
      mockLLM.json.mockResolvedValue({
        insights: [
          {
            content: 'I am Rook, an AI assistant',
            category: 'identity',
            importance: 0.9,
            reasoning: 'Agent introduces itself',
          },
          {
            content: 'I should verify data before marking tasks complete',
            category: 'lessons',
            importance: 0.8,
            reasoning: 'Learned from a mistake',
          },
        ],
      });

      // Mock embedding generation (no duplicates)
      mockEmbedding.generate.mockResolvedValue(new Array(1536).fill(0.1));
      mockEmbedding.search.mockResolvedValue([]);
      mockEmbedding.store.mockResolvedValue('embedding-1');

      // Mock memory creation
      mockPrisma.memory.create
        .mockResolvedValueOnce({
          id: 'mem-1',
          userId: mockAgentId,
          raw: 'I am Rook, an AI assistant',
          layer: MemoryLayer.IDENTITY,
          source: MemorySource.AGENT_REFLECTION,
          subjectType: SubjectType.AGENT,
          subjectId: mockAgentId,
          agentId: mockAgentId,
          importanceScore: 0.9,
          confidence: 0.9,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'mem-2',
          userId: mockAgentId,
          raw: 'I should verify data before marking tasks complete',
          layer: MemoryLayer.IDENTITY,
          source: MemorySource.AGENT_REFLECTION,
          subjectType: SubjectType.AGENT,
          subjectId: mockAgentId,
          agentId: mockAgentId,
          importanceScore: 0.8,
          confidence: 0.9,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

      mockPrisma.memoryExtraction.create.mockResolvedValue({});
      mockPrisma.memory.update.mockResolvedValue({});

      const result = await service.reflect(mockAgentId, {
        recentTurns: [
          { role: 'user', content: 'What is your name?' },
          { role: 'assistant', content: 'I am Rook, an AI assistant.' },
          { role: 'user', content: 'You marked the task complete but it wasnt.' },
          {
            role: 'assistant',
            content: 'I apologize. I should verify data before marking tasks complete.',
          },
        ],
        agentName: 'Rook',
      });

      expect(result.memoriesCreated).toHaveLength(2);
      expect(result.insightsExtracted).toBe(2);
      expect(result.categories.identity).toBe(1);
      expect(result.categories.lessons).toBe(1);

      // Verify memories were created with correct subjectType
      expect(mockPrisma.memory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subjectType: SubjectType.AGENT,
            agentId: mockAgentId,
            source: MemorySource.AGENT_REFLECTION,
          }),
        }),
      );
    });

    it('should filter out low importance insights', async () => {
      mockLLM.json.mockResolvedValue({
        insights: [
          {
            content: 'I am Rook',
            category: 'identity',
            importance: 0.9,
            reasoning: 'High importance',
          },
          {
            content: 'User said hello',
            category: 'workingStyle',
            importance: 0.3, // Below default threshold of 0.5
            reasoning: 'Low importance',
          },
        ],
      });

      mockEmbedding.generate.mockResolvedValue(new Array(1536).fill(0.1));
      mockEmbedding.search.mockResolvedValue([]);
      mockEmbedding.store.mockResolvedValue('embedding-1');
      mockPrisma.memory.create.mockResolvedValue({
        id: 'mem-1',
        raw: 'I am Rook',
      });
      mockPrisma.memoryExtraction.create.mockResolvedValue({});
      mockPrisma.memory.update.mockResolvedValue({});

      const result = await service.reflect(mockAgentId, {
        recentTurns: [{ role: 'user', content: 'Hello' }],
      });

      // Only the high importance insight should be created
      expect(result.memoriesCreated).toHaveLength(1);
      expect(result.insightsExtracted).toBe(2);
    });

    it('should deduplicate similar insights', async () => {
      mockLLM.json.mockResolvedValue({
        insights: [
          {
            content: 'I am Rook, an AI assistant',
            category: 'identity',
            importance: 0.9,
            reasoning: 'Identity statement',
          },
        ],
      });

      // Mock embedding search to return a similar existing memory
      mockEmbedding.generate.mockResolvedValue(new Array(1536).fill(0.1));
      mockEmbedding.search.mockResolvedValue([
        { id: 'existing-mem', score: 0.95 }, // Very similar
      ]);

      const result = await service.reflect(mockAgentId, {
        recentTurns: [{ role: 'user', content: 'Who are you?' }],
      });

      // No new memories should be created due to deduplication
      expect(result.memoriesCreated).toHaveLength(0);
      expect(mockPrisma.memory.create).not.toHaveBeenCalled();
    });

    it('should respect maxMemories limit', async () => {
      mockLLM.json.mockResolvedValue({
        insights: [
          { content: 'Insight 1', category: 'identity', importance: 0.9, reasoning: '' },
          { content: 'Insight 2', category: 'identity', importance: 0.9, reasoning: '' },
          { content: 'Insight 3', category: 'identity', importance: 0.9, reasoning: '' },
        ],
      });

      mockEmbedding.generate.mockResolvedValue(new Array(1536).fill(0.1));
      mockEmbedding.search.mockResolvedValue([]);
      mockEmbedding.store.mockResolvedValue('emb');
      mockPrisma.memory.create.mockResolvedValue({ id: 'mem' });
      mockPrisma.memoryExtraction.create.mockResolvedValue({});
      mockPrisma.memory.update.mockResolvedValue({});

      const result = await service.reflect(mockAgentId, {
        recentTurns: [{ role: 'user', content: 'Test' }],
        maxMemories: 2,
      });

      expect(result.memoriesCreated).toHaveLength(2);
      expect(mockPrisma.memory.create).toHaveBeenCalledTimes(2);
    });

    it('should handle LLM failures gracefully', async () => {
      mockLLM.json.mockRejectedValue(new Error('LLM unavailable'));

      const result = await service.reflect(mockAgentId, {
        recentTurns: [{ role: 'user', content: 'Test' }],
      });

      expect(result.memoriesCreated).toHaveLength(0);
      expect(result.insightsExtracted).toBe(0);
    });
  });

  describe('getAgentMemories', () => {
    it('should return agent self-memories', async () => {
      const mockMemories = [
        {
          id: 'mem-1',
          raw: 'I am Rook',
          layer: MemoryLayer.IDENTITY,
          subjectType: SubjectType.AGENT,
          agentId: mockAgentId,
          extraction: { who: 'Rook', what: 'is an AI assistant' },
        },
      ];

      mockPrisma.memory.findMany.mockResolvedValue(mockMemories);

      const result = await service.getAgentMemories(mockAgentId);

      expect(result).toEqual(mockMemories);
      expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            subjectType: SubjectType.AGENT,
            agentId: mockAgentId,
          }),
        }),
      );
    });

    it('should filter by layer when specified', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([]);

      await service.getAgentMemories(mockAgentId, { layer: MemoryLayer.IDENTITY });

      expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            layer: MemoryLayer.IDENTITY,
          }),
        }),
      );
    });
  });

  describe('getAgentContext', () => {
    it('should return formatted context for prompt injection', async () => {
      mockPrisma.memory.findMany.mockResolvedValue([
        { id: '1', raw: 'I am Rook, an AI assistant' },
        { id: '2', raw: 'I should verify data before marking tasks complete' },
      ]);

      const result = await service.getAgentContext(mockAgentId);

      expect(result.context).toContain('## Agent Self-Knowledge');
      expect(result.context).toContain('I am Rook, an AI assistant');
      expect(result.memoriesIncluded).toBe(2);
    });

    it('should respect token limit', async () => {
      // Create many memories that would exceed token limit
      const manyMemories = Array.from({ length: 50 }, (_, i) => ({
        id: `mem-${i}`,
        raw: `This is memory number ${i} with some content that takes up tokens`,
      }));

      mockPrisma.memory.findMany.mockResolvedValue(manyMemories);

      const result = await service.getAgentContext(mockAgentId, 100); // Very low token limit

      // Should truncate based on token limit
      expect(result.context.split('\n').length).toBeLessThan(manyMemories.length + 2);
    });
  });
});
