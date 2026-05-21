import { Test, TestingModule } from '@nestjs/testing';
import { MemoryGraphService } from './memory-graph.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  memory: {
    findMany: jest.fn(),
  },
  graphEntityMention: {
    findMany: jest.fn(),
  },
  graphRelationship: {
    findMany: jest.fn(),
  },
  memoryChainLink: {
    findMany: jest.fn(),
  },
  agent: {
    findMany: jest.fn(),
  },
};

describe('MemoryGraphService', () => {
  let service: MemoryGraphService;

  beforeEach(async () => {
    jest.clearAllMocks();
describe('MemoryGraphService', () => {
  let service: MemoryGraphService;
  let prisma: any;

  const now = new Date('2026-03-10T00:00:00Z');

  const mockMemories = [
    {
      id: 'mem-1',
      userId: 'user-1',
      raw: 'Memory about project Alpha',
      layer: 'SESSION',
      source: 'EXPLICIT_STATEMENT',
      importanceScore: 0.8,
      effectiveScore: 0.7,
      safetyCritical: false,
      consolidated: false,
      userPinned: false,
      confidence: 0.9,
      createdAt: now,
      extraction: null,
    },
    {
      id: 'mem-2',
      userId: 'user-1',
      raw: 'Another memory about Alpha',
      layer: 'SESSION',
      source: 'AGENT_OBSERVATION',
      importanceScore: 0.5,
      effectiveScore: 0.4,
      safetyCritical: false,
      consolidated: false,
      userPinned: false,
      confidence: 0.8,
      createdAt: new Date('2026-03-09T00:00:00Z'),
      extraction: {
        who: 'Beaux',
        what: 'worked on Alpha',
        when: now,
        whereCtx: 'office',
        why: 'deadline',
        how: 'coding',
        topics: ['project'],
        memoryType: 'EVENT',
      },
    },
  ];

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      memory: {
        findMany: jest.fn().mockResolvedValue(mockMemories),
      },
      graphEntityMention: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      graphRelationship: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      memoryChainLink: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryGraphService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MemoryGraphService>(MemoryGraphService);
  });

  const baseMemory = (id: string, overrides: any = {}) => ({
    id,
    raw: `memory ${id}`,
    layer: 'SEMANTIC',
    source: 'EXPLICIT_STATEMENT',
    userId: 'user-1',
    importanceScore: 0.5,
    effectiveScore: 0.5,
    safetyCritical: false,
    consolidated: false,
    userPinned: false,
    confidence: 0.8,
    createdAt: new Date('2026-01-01'),
    extraction: null,
    ...overrides,
  });

  it('should return nodes, edges, and entities for a user', async () => {
    mockPrisma.memory.findMany.mockResolvedValue([
      baseMemory('m1'),
      baseMemory('m2'),
    ]);
    mockPrisma.graphEntityMention.findMany.mockResolvedValue([]);
    mockPrisma.graphRelationship.findMany.mockResolvedValue([]);
    mockPrisma.memoryChainLink.findMany.mockResolvedValue([]);

    const result = await service.getGraphData('user-1');

    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toEqual([]);
    expect(result.entities).toEqual([]);
  });

  it('should create shared-entity edges between memories mentioning the same entity', async () => {
    mockPrisma.memory.findMany.mockResolvedValue([
      baseMemory('m1'),
      baseMemory('m2'),
    ]);
    mockPrisma.graphEntityMention.findMany.mockResolvedValue([
      {
        memoryId: 'm1',
        entity: { id: 'e1', name: 'Coffee', type: 'CONCEPT', mentionCount: 5 },
      },
      {
        memoryId: 'm2',
        entity: { id: 'e1', name: 'Coffee', type: 'CONCEPT', mentionCount: 5 },
      },
    ]);
    mockPrisma.graphRelationship.findMany.mockResolvedValue([]);
    mockPrisma.memoryChainLink.findMany.mockResolvedValue([]);

    const result = await service.getGraphData('user-1');

    expect(result.edges.length).toBeGreaterThanOrEqual(1);
    const sharedEdge = result.edges.find((e) =>
      e.linkType.startsWith('shared:'),
    );
    expect(sharedEdge).toBeDefined();
    expect(sharedEdge!.linkType).toBe('shared:Coffee');
  });

  it('should include chain link edges', async () => {
    mockPrisma.memory.findMany.mockResolvedValue([
      baseMemory('m1'),
      baseMemory('m2'),
    ]);
    mockPrisma.graphEntityMention.findMany.mockResolvedValue([]);
    mockPrisma.graphRelationship.findMany.mockResolvedValue([]);
    mockPrisma.memoryChainLink.findMany.mockResolvedValue([
      {
        id: 'chain-1',
        sourceId: 'm1',
        targetId: 'm2',
        linkType: 'FOLLOW_UP',
        confidence: 0.9,
        createdAt: new Date(),
      },
    ]);

    const result = await service.getGraphData('user-1');

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].linkType).toBe('FOLLOW_UP');
  });

  it('should include entity relationship edges', async () => {
    mockPrisma.memory.findMany.mockResolvedValue([baseMemory('m1')]);
    mockPrisma.graphEntityMention.findMany.mockResolvedValue([
      {
        memoryId: 'm1',
        entity: { id: 'e1', name: 'A', type: 'PERSON', mentionCount: 1 },
      },
      {
        memoryId: 'm1',
        entity: { id: 'e2', name: 'B', type: 'ORG', mentionCount: 1 },
      },
    ]);
    mockPrisma.graphRelationship.findMany.mockResolvedValue([
      {
        id: 'rel-1',
        sourceEntityId: 'e1',
        targetEntityId: 'e2',
        type: 'WORKS_AT',
        weight: 0.95,
        createdAt: new Date(),
      },
    ]);
    mockPrisma.memoryChainLink.findMany.mockResolvedValue([]);

    const result = await service.getGraphData('user-1');

    const relEdge = result.edges.find((e) => e.linkType === 'WORKS_AT');
    expect(relEdge).toBeDefined();
    expect(relEdge!.confidence).toBe(0.95);
  });

  it('should include agent memories when includeAgent is true', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      accountId: 'account-1',
    });
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'agent-user-1' });
    mockPrisma.memory.findMany.mockResolvedValue([
      baseMemory('m1', { userId: 'user-1' }),
      baseMemory('m2', { userId: 'agent-user-1' }),
    ]);
    mockPrisma.graphEntityMention.findMany.mockResolvedValue([]);
    mockPrisma.graphRelationship.findMany.mockResolvedValue([]);
    mockPrisma.memoryChainLink.findMany.mockResolvedValue([]);

    const result = await service.getGraphData('user-1', 500, true);

    expect(result.stats).toEqual({ human: 1, agent: 1 });
    expect(result.nodes.find((n) => n.memorySource === 'agent')).toBeDefined();
  });

  it('should not include stats when includeAgent is false', async () => {
    mockPrisma.memory.findMany.mockResolvedValue([baseMemory('m1')]);
    mockPrisma.graphEntityMention.findMany.mockResolvedValue([]);
    mockPrisma.memoryChainLink.findMany.mockResolvedValue([]);

    const result = await service.getGraphData('user-1', 500, false);

    expect(result.stats).toBeUndefined();
  });

  it('should cap shared-entity edges at 10 memories per entity', async () => {
    // Create 12 memories all sharing an entity
    const memories = Array.from({ length: 12 }, (_, i) => baseMemory(`m${i}`));
    mockPrisma.memory.findMany.mockResolvedValue(memories);

    const mentions = memories.map((m) => ({
      memoryId: m.id,
      entity: { id: 'e1', name: 'Thing', type: 'CONCEPT', mentionCount: 12 },
    }));
    mockPrisma.graphEntityMention.findMany.mockResolvedValue(mentions);
    mockPrisma.graphRelationship.findMany.mockResolvedValue([]);
    mockPrisma.memoryChainLink.findMany.mockResolvedValue([]);

    const result = await service.getGraphData('user-1');

    // 10 choose 2 = 45 max edges
    expect(result.edges.length).toBeLessThanOrEqual(45);
  });

  it('should handle extraction data in nodes', async () => {
    const mem = baseMemory('m1', {
      extraction: {
        who: 'Beaux',
        what: 'drinks coffee',
        when: new Date('2026-01-01'),
        whereCtx: 'home',
        why: 'needs caffeine',
        how: 'drip',
        topics: ['coffee'],
        memoryType: 'PREFERENCE',
      },
    });
    mockPrisma.memory.findMany.mockResolvedValue([mem]);
    mockPrisma.graphEntityMention.findMany.mockResolvedValue([]);
    mockPrisma.memoryChainLink.findMany.mockResolvedValue([]);

    const result = await service.getGraphData('user-1');

    expect(result.nodes[0].extraction).toEqual({
      who: 'Beaux',
      what: 'drinks coffee',
      when: '2026-01-01T00:00:00.000Z',
      where: 'home',
      why: 'needs caffeine',
      how: 'drip',
      topics: ['coffee'],
      memoryType: 'PREFERENCE',
    });
  });

  it('should respect the limit parameter', async () => {
    mockPrisma.memory.findMany.mockResolvedValue([baseMemory('m1')]);
    mockPrisma.graphEntityMention.findMany.mockResolvedValue([]);
    mockPrisma.memoryChainLink.findMany.mockResolvedValue([]);

    await service.getGraphData('user-1', 10);

    expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 }),
    );
  describe('getGraphData()', () => {
    it('should return nodes and empty edges when no entities exist', async () => {
      const result = await service.getGraphData('user-1');

      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toEqual([]);
      expect(result.entities).toEqual([]);
      expect(result.nodes[0].id).toBe('mem-1');
      expect(result.nodes[0].raw).toBe('Memory about project Alpha');
    });

    it('should build shared-entity edges between memories mentioning the same entity', async () => {
      prisma.graphEntityMention.findMany.mockResolvedValue([
        {
          memoryId: 'mem-1',
          entity: {
            id: 'ent-1',
            name: 'Alpha',
            type: 'PROJECT',
            mentionCount: 5,
          },
        },
        {
          memoryId: 'mem-2',
          entity: {
            id: 'ent-1',
            name: 'Alpha',
            type: 'PROJECT',
            mentionCount: 5,
          },
        },
      ]);

      const result = await service.getGraphData('user-1');

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Alpha');
      // Should have a shared-entity edge between mem-1 and mem-2
      const sharedEdges = result.edges.filter((e) =>
        e.linkType.startsWith('shared:'),
      );
      expect(sharedEdges).toHaveLength(1);
      expect(sharedEdges[0].linkType).toBe('shared:Alpha');
    });

    it('should include entity relationship edges', async () => {
      prisma.graphEntityMention.findMany.mockResolvedValue([
        {
          memoryId: 'mem-1',
          entity: { id: 'ent-1', name: 'Alpha', type: 'PROJECT', mentionCount: 2 },
        },
        {
          memoryId: 'mem-2',
          entity: { id: 'ent-2', name: 'Beta', type: 'PROJECT', mentionCount: 1 },
        },
      ]);

      prisma.graphRelationship.findMany.mockResolvedValue([
        {
          id: 'rel-1',
          sourceEntityId: 'ent-1',
          targetEntityId: 'ent-2',
          type: 'RELATED_TO',
          weight: 0.8,
          createdAt: now,
        },
      ]);

      const result = await service.getGraphData('user-1');

      const relEdges = result.edges.filter((e) => e.linkType === 'RELATED_TO');
      expect(relEdges).toHaveLength(1);
      expect(relEdges[0].source).toBe('ent-1');
      expect(relEdges[0].target).toBe('ent-2');
    });

    it('should include memory chain link edges', async () => {
      prisma.memoryChainLink.findMany.mockResolvedValue([
        {
          id: 'chain-1',
          sourceId: 'mem-1',
          targetId: 'mem-2',
          linkType: 'FOLLOWS',
          confidence: 0.9,
          createdAt: now,
        },
      ]);

      const result = await service.getGraphData('user-1');

      const chainEdges = result.edges.filter((e) => e.linkType === 'FOLLOWS');
      expect(chainEdges).toHaveLength(1);
      expect(chainEdges[0].source).toBe('mem-1');
      expect(chainEdges[0].target).toBe('mem-2');
    });

    it('should respect limit parameter', async () => {
      const result = await service.getGraphData('user-1', 100);

      expect(prisma.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('should include agent memories when includeAgent is true', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        agentId: 'agent-1',
      });
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-agent',
        agentId: 'agent-1',
        externalId: 'rook',
      });

      const result = await service.getGraphData('user-1', 500, true);

      expect(prisma.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: { in: ['user-1', 'user-agent'] },
          }),
        }),
      );
      expect(result.stats).toBeDefined();
      expect(result.stats!.human).toBe(2);
      expect(result.stats!.agent).toBe(0);
    });

    it('should not include stats when includeAgent is false', async () => {
      const result = await service.getGraphData('user-1', 500, false);

      expect(result.stats).toBeUndefined();
    });

    it('should handle extraction data in nodes', async () => {
      const result = await service.getGraphData('user-1');

      const nodeWithExtraction = result.nodes.find((n) => n.id === 'mem-2');
      expect(nodeWithExtraction!.extraction).toEqual({
        who: 'Beaux',
        what: 'worked on Alpha',
        when: now.toISOString(),
        where: 'office',
        why: 'deadline',
        how: 'coding',
        topics: ['project'],
        memoryType: 'EVENT',
      });
    });

    it('should set primaryEntityType from first entity', async () => {
      prisma.graphEntityMention.findMany.mockResolvedValue([
        {
          memoryId: 'mem-1',
          entity: { id: 'ent-1', name: 'Beaux', type: 'PERSON', mentionCount: 3 },
        },
      ]);

      const result = await service.getGraphData('user-1');

      const node = result.nodes.find((n) => n.id === 'mem-1');
      expect(node!.primaryEntityType).toBe('person');
    });

    it('should default primaryEntityType to "other" when no entities', async () => {
      const result = await service.getGraphData('user-1');

      expect(result.nodes[0].primaryEntityType).toBe('other');
    });

    it('should cap shared-entity edges at 10 memories per entity', async () => {
      // Create 12 memories
      const manyMemories = Array.from({ length: 12 }, (_, i) => ({
        id: `mem-${i}`,
        userId: 'user-1',
        raw: `Memory ${i}`,
        layer: 'SESSION',
        source: 'EXPLICIT_STATEMENT',
        importanceScore: 0.5,
        effectiveScore: 0.5,
        safetyCritical: false,
        consolidated: false,
        userPinned: false,
        confidence: 0.8,
        createdAt: new Date(now.getTime() - i * 86400000),
        extraction: null,
      }));
      prisma.memory.findMany.mockResolvedValue(manyMemories);

      // All mention same entity
      prisma.graphEntityMention.findMany.mockResolvedValue(
        manyMemories.map((m) => ({
          memoryId: m.id,
          entity: { id: 'ent-1', name: 'Test', type: 'CONCEPT', mentionCount: 12 },
        })),
      );

      const result = await service.getGraphData('user-1');

      // With 10 capped memories, max edges = C(10,2) = 45
      const sharedEdges = result.edges.filter((e) =>
        e.linkType.startsWith('shared:'),
      );
      expect(sharedEdges.length).toBeLessThanOrEqual(45);
    });

    it('should filter out chain links where source or target is outside memory set', async () => {
      prisma.memoryChainLink.findMany.mockResolvedValue([
        {
          id: 'chain-1',
          sourceId: 'mem-1',
          targetId: 'mem-external',
          linkType: 'FOLLOWS',
          confidence: 0.9,
          createdAt: now,
        },
      ]);

      const result = await service.getGraphData('user-1');

      const chainEdges = result.edges.filter((e) => e.linkType === 'FOLLOWS');
      expect(chainEdges).toHaveLength(0);
    });
  });
});
