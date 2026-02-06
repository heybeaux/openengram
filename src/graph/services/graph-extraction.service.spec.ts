import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GraphExtractionService } from './graph-extraction.service';
import { EntityService } from './entity.service';
import { RelationshipService } from './relationship.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LLMService } from '../../llm/llm.service';
import { VectorService } from '../../vector/vector.service';
import { GraphEntityType, GraphMentionRole, GraphRelationshipType, MemoryLayer, MemorySource, SubjectType } from '@prisma/client';

describe('GraphExtractionService', () => {
  let service: GraphExtractionService;
  let llmService: LLMService;
  let entityService: EntityService;
  let relationshipService: RelationshipService;
  let prisma: PrismaService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'GRAPH_ENABLED') return 'true';
      if (key === 'GRAPH_EXTRACTION_TIMEOUT_MS') return 30000;
      return null;
    }),
  };

  const mockLLMService = {
    chat: jest.fn(),
    embed: jest.fn(),
  };

  const mockVectorService = {
    upsert: jest.fn(),
  };

  const mockEntityService = {
    findByName: jest.fn(),
    findByAlias: jest.fn(),
    addAliases: jest.fn(),
    incrementMentionCount: jest.fn(),
    create: jest.fn(),
    setEmbeddingId: jest.fn(),
  };

  const mockRelationshipService = {
    upsert: jest.fn(),
  };

  const mockPrismaService = {
    graphEntity: {
      findMany: jest.fn(),
    },
    graphEntityMention: {
      upsert: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GraphExtractionService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: LLMService, useValue: mockLLMService },
        { provide: VectorService, useValue: mockVectorService },
        { provide: EntityService, useValue: mockEntityService },
        { provide: RelationshipService, useValue: mockRelationshipService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<GraphExtractionService>(GraphExtractionService);
    llmService = module.get<LLMService>(LLMService);
    entityService = module.get<EntityService>(EntityService);
    relationshipService = module.get<RelationshipService>(RelationshipService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  describe('isEnabled', () => {
    it('should return true when GRAPH_ENABLED is true', () => {
      expect(service.isEnabled()).toBe(true);
    });
  });

  describe('extract', () => {
    it('should extract entities and relationships from text', async () => {
      const content = "Beaux's wife is Deanna. They live in Powell River.";

      // Mock entity extraction response
      mockLLMService.chat.mockResolvedValueOnce({
        content: JSON.stringify([
          { name: 'Beaux', type: 'PERSON', aliases: [], role: 'SUBJECT' },
          { name: 'Deanna', type: 'PERSON', aliases: ['wife'], role: 'OBJECT' },
          { name: 'Powell River', type: 'PLACE', aliases: [], role: 'LOCATION' },
        ]),
      });

      // Mock relationship extraction response
      mockLLMService.chat.mockResolvedValueOnce({
        content: JSON.stringify([
          { source: 'Beaux', target: 'Deanna', type: 'SPOUSE_OF', confidence: 0.95 },
          { source: 'Beaux', target: 'Powell River', type: 'LIVES_IN', confidence: 0.9 },
          { source: 'Deanna', target: 'Powell River', type: 'LIVES_IN', confidence: 0.85 },
        ]),
      });

      const result = await service.extract(content);

      expect(result.entities).toHaveLength(3);
      expect(result.entities[0].name).toBe('Beaux');
      expect(result.entities[0].type).toBe(GraphEntityType.PERSON);

      expect(result.relationships).toHaveLength(3);
      expect(result.relationships[0].source).toBe('Beaux');
      expect(result.relationships[0].target).toBe('Deanna');
      expect(result.relationships[0].type).toBe(GraphRelationshipType.SPOUSE_OF);
    });

    it('should skip relationship extraction with < 2 entities', async () => {
      mockLLMService.chat.mockResolvedValueOnce({
        content: JSON.stringify([
          { name: 'Beaux', type: 'PERSON', aliases: [], role: 'SUBJECT' },
        ]),
      });

      const result = await service.extract('Beaux went to the store.');

      expect(result.entities).toHaveLength(1);
      expect(result.relationships).toHaveLength(0);
      expect(mockLLMService.chat).toHaveBeenCalledTimes(1); // Only entity extraction
    });

    it('should handle LLM errors gracefully', async () => {
      mockLLMService.chat.mockRejectedValue(new Error('LLM error'));

      const result = await service.extract('Test content');

      expect(result.entities).toHaveLength(0);
      expect(result.relationships).toHaveLength(0);
    });

    it('should handle malformed JSON response', async () => {
      mockLLMService.chat.mockResolvedValueOnce({
        content: 'This is not valid JSON',
      });

      const result = await service.extract('Test content');

      expect(result.entities).toHaveLength(0);
    });

    it('should filter out self-referential relationships', async () => {
      mockLLMService.chat.mockResolvedValueOnce({
        content: JSON.stringify([
          { name: 'Beaux', type: 'PERSON', aliases: [], role: 'SUBJECT' },
          { name: 'Work', type: 'CONCEPT', aliases: [], role: 'OBJECT' },
        ]),
      });

      mockLLMService.chat.mockResolvedValueOnce({
        content: JSON.stringify([
          { source: 'Beaux', target: 'Beaux', type: 'RELATED_TO', confidence: 0.5 }, // Self-ref, should be filtered
          { source: 'Beaux', target: 'Work', type: 'RELATED_TO', confidence: 0.8 },
        ]),
      });

      const result = await service.extract('Beaux works hard.');

      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].target).toBe('Work');
    });
  });

  describe('processMemory', () => {
    const mockMemory = {
      id: 'mem-1',
      userId: 'user-1',
      raw: "Beaux's wife is Deanna.",
      layer: MemoryLayer.IDENTITY,
      source: MemorySource.EXPLICIT_STATEMENT,
      subjectType: SubjectType.USER,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should process memory and create graph data', async () => {
      // Mock extraction
      mockLLMService.chat.mockResolvedValueOnce({
        content: JSON.stringify([
          { name: 'Beaux', type: 'PERSON', aliases: [], role: 'SUBJECT' },
          { name: 'Deanna', type: 'PERSON', aliases: [], role: 'OBJECT' },
        ]),
      });

      mockLLMService.chat.mockResolvedValueOnce({
        content: JSON.stringify([
          { source: 'Beaux', target: 'Deanna', type: 'SPOUSE_OF', confidence: 0.95 },
        ]),
      });

      // Mock entity resolution - create new entities
      mockEntityService.findByName.mockResolvedValue(null);
      mockEntityService.findByAlias.mockResolvedValue(null);
      mockPrismaService.graphEntity.findMany.mockResolvedValue([]);
      
      const mockEntity1 = { id: 'entity-1', name: 'Beaux', type: GraphEntityType.PERSON };
      const mockEntity2 = { id: 'entity-2', name: 'Deanna', type: GraphEntityType.PERSON };
      mockEntityService.create.mockResolvedValueOnce(mockEntity1);
      mockEntityService.create.mockResolvedValueOnce(mockEntity2);

      // Mock embedding creation
      mockLLMService.embed.mockResolvedValue({ embedding: [0.1, 0.2], dimensions: 2 });
      mockVectorService.upsert.mockResolvedValue(undefined);
      mockEntityService.setEmbeddingId.mockResolvedValue(undefined);

      // Mock mention creation
      mockPrismaService.graphEntityMention.upsert.mockResolvedValue(undefined);

      // Mock relationship creation
      mockRelationshipService.upsert.mockResolvedValue({ created: true });

      const result = await service.processMemory(mockMemory as any);

      expect(result.memoryId).toBe('mem-1');
      expect(result.entitiesCreated).toBe(2);
      expect(result.relationshipsCreated).toBe(1);
      expect(result.mentionsCreated).toBe(2);
    });

    it('should update existing entities on resolution', async () => {
      mockLLMService.chat.mockResolvedValueOnce({
        content: JSON.stringify([
          { name: 'Beaux', type: 'PERSON', aliases: ['bw'], role: 'SUBJECT' },
        ]),
      });

      // Entity already exists
      const existingEntity = { id: 'entity-1', name: 'Beaux', type: GraphEntityType.PERSON, aliases: [] };
      mockEntityService.findByName.mockResolvedValue(existingEntity);
      mockEntityService.addAliases.mockResolvedValue(undefined);
      mockEntityService.incrementMentionCount.mockResolvedValue(undefined);
      mockPrismaService.graphEntityMention.upsert.mockResolvedValue(undefined);

      const result = await service.processMemory(mockMemory as any);

      expect(result.entitiesUpdated).toBe(1);
      expect(result.entitiesCreated).toBe(0);
      expect(mockEntityService.addAliases).toHaveBeenCalledWith('entity-1', ['bw']);
    });

    it('should resolve entity by alias', async () => {
      mockLLMService.chat.mockResolvedValueOnce({
        content: JSON.stringify([
          { name: 'BW', type: 'PERSON', aliases: [], role: 'SUBJECT' },
        ]),
      });

      // Not found by name, but found by alias
      mockEntityService.findByName.mockResolvedValue(null);
      const existingEntity = { id: 'entity-1', name: 'Beaux Walton', aliases: ['bw'] };
      mockEntityService.findByAlias.mockResolvedValue(existingEntity);
      mockEntityService.incrementMentionCount.mockResolvedValue(undefined);
      mockPrismaService.graphEntityMention.upsert.mockResolvedValue(undefined);

      const result = await service.processMemory(mockMemory as any);

      expect(result.entitiesUpdated).toBe(1);
    });

    it('should return early if extraction disabled', async () => {
      // Create service with disabled config
      const disabledModule: TestingModule = await Test.createTestingModule({
        providers: [
          GraphExtractionService,
          { 
            provide: ConfigService, 
            useValue: { get: (key: string) => key === 'GRAPH_ENABLED' ? 'false' : null }
          },
          { provide: LLMService, useValue: mockLLMService },
          { provide: VectorService, useValue: mockVectorService },
          { provide: EntityService, useValue: mockEntityService },
          { provide: RelationshipService, useValue: mockRelationshipService },
          { provide: PrismaService, useValue: mockPrismaService },
        ],
      }).compile();

      const disabledService = disabledModule.get<GraphExtractionService>(GraphExtractionService);

      const result = await disabledService.processMemory(mockMemory as any);

      expect(result.entitiesCreated).toBe(0);
      expect(mockLLMService.chat).not.toHaveBeenCalled();
    });
  });
});
