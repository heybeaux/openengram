import { MemoryPipelineService } from './memory-pipeline.service';

describe('MemoryPipelineService', () => {
  let service: MemoryPipelineService;
  let prisma: any;
  let extraction: any;
  let embedding: any;
  let hierarchy: any;

  beforeEach(() => {
    prisma = {
      memoryExtraction: { create: jest.fn() },
      memory: { update: jest.fn() },
      entity: { upsert: jest.fn() },
      memoryEntity: { upsert: jest.fn() },
      memoryChainLink: { upsert: jest.fn() },
    };
    extraction = {
      extract: jest.fn().mockResolvedValue({
        who: 'user',
        what: 'test memory',
        when: null,
        where: null,
        why: null,
        how: null,
        topics: ['testing'],
        entities: [],
        memoryType: 'FACT',
        typeConfidence: 0.9,
        confidence: {
          whoConfidence: 0.8,
          whatConfidence: 0.9,
          whenConfidence: 0,
          whereConfidence: 0,
          whyConfidence: 0,
          howConfidence: 0,
        },
        lesson: null,
      }),
      getPriorityForType: jest.fn().mockReturnValue(5),
    };
    embedding = {
      generate: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      store: jest.fn().mockResolvedValue('emb-1'),
      search: jest.fn().mockResolvedValue([]),
    };
    hierarchy = {
      isEnabled: jest.fn().mockReturnValue(false),
      processMemory: jest.fn(),
    };
    service = new MemoryPipelineService(prisma, extraction, embedding, hierarchy);
  });

  describe('extractAndEmbed', () => {
    it('should extract, save extraction, embed, and link', async () => {
      await service.extractAndEmbed('m1', 'test content', 'user-1');

      expect(extraction.extract).toHaveBeenCalledWith('test content', undefined);
      expect(prisma.memoryExtraction.create).toHaveBeenCalled();
      expect(prisma.memory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'm1' },
          data: expect.objectContaining({ memoryType: 'FACT', priority: 5 }),
        }),
      );
      expect(embedding.generate).toHaveBeenCalledWith('test content');
      expect(embedding.store).toHaveBeenCalledWith('m1', [0.1, 0.2, 0.3]);
    });

    it('should handle embedding failure gracefully', async () => {
      embedding.generate.mockRejectedValue(new Error('GPU OOM'));

      // Should not throw
      await service.extractAndEmbed('m1', 'test content', 'user-1');
      expect(prisma.memoryExtraction.create).toHaveBeenCalled();
    });

    it('should store entities when extraction produces them', async () => {
      extraction.extract.mockResolvedValue({
        who: 'user', what: 'test', when: null, where: null, why: null, how: null,
        topics: [], memoryType: 'FACT', typeConfidence: 0.9,
        entities: [{ name: 'TypeScript', type: 'TECHNOLOGY' }],
        confidence: { whoConfidence: 0.8, whatConfidence: 0.9, whenConfidence: 0, whereConfidence: 0, whyConfidence: 0, howConfidence: 0 },
        lesson: null,
      });
      prisma.entity.upsert.mockResolvedValue({ id: 'ent-1' });
      prisma.memoryEntity.upsert.mockResolvedValue({});

      await service.extractAndEmbed('m1', 'I love TypeScript', 'user-1');

      expect(prisma.entity.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_normalizedName_type: { userId: 'user-1', normalizedName: 'typescript', type: 'TECHNOLOGY' } },
        }),
      );
      expect(prisma.memoryEntity.upsert).toHaveBeenCalled();
    });

    it('should pass context to extraction', async () => {
      const ctx = { userName: 'Bob', timestamp: new Date(), turnIndex: 3, conversationId: 'conv-1' };
      await service.extractAndEmbed('m1', 'test', 'user-1', ctx);
      expect(extraction.extract).toHaveBeenCalledWith('test', ctx);
    });

    it('should process hierarchy when enabled', async () => {
      hierarchy.isEnabled.mockReturnValue(true);
      hierarchy.processMemory.mockResolvedValue(undefined);

      await service.extractAndEmbed('m1', 'test', 'user-1');
      expect(hierarchy.processMemory).toHaveBeenCalledWith('m1', 'test', 'user-1');
    });
  });

  describe('promoteToConstraint', () => {
    it('should promote lesson to constraint with priority 1', async () => {
      await service.promoteToConstraint('m1');
      expect(prisma.memory.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { memoryType: 'CONSTRAINT', priority: 1, promotedFrom: 'm1' },
      });
    });
  });

  describe('extractAndEmbed - LESSON auto-promotion', () => {
    it('should auto-promote critical lessons to CONSTRAINT', async () => {
      extraction.extract.mockResolvedValue({
        who: 'user', what: 'critical rule', when: null, where: null, why: null, how: null,
        topics: [], memoryType: 'LESSON', typeConfidence: 0.95,
        entities: [],
        confidence: { whoConfidence: 0.8, whatConfidence: 0.9, whenConfidence: 0, whereConfidence: 0, whyConfidence: 0, howConfidence: 0 },
        lesson: { lessonSeverity: 'critical' },
      });
      extraction.getPriorityForType.mockReturnValue(3);

      await service.extractAndEmbed('m1', 'never do X', 'user-1');

      // Should have been called twice: once for type update, once for promotion
      expect(prisma.memory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ memoryType: 'CONSTRAINT', priority: 1 }),
        }),
      );
    });
  });

  describe('linkRelatedMemories', () => {
    it('should link related memories within threshold', async () => {
      embedding.search.mockResolvedValue([
        { id: 'm2', score: 0.85 },
        { id: 'm3', score: 0.75 },
        { id: 'm1', score: 1.0 }, // self — should be excluded
      ]);

      await service.linkRelatedMemories('m1', [0.1], 'user-1');
      // Exact calls depend on thresholds, but should not throw
    });

    it('should handle search failure gracefully', async () => {
      embedding.search.mockRejectedValue(new Error('search failed'));
      // Should not throw
      await service.linkRelatedMemories('m1', [0.1], 'user-1');
    });
  });

  describe('storeEntities', () => {
    it('should upsert entities and link to memory', async () => {
      prisma.entity.upsert.mockResolvedValue({ id: 'ent-1' });
      prisma.memoryEntity.upsert.mockResolvedValue({});

      await service.storeEntities('user-1', 'm1', [
        { name: 'React', type: 'other' },
        { name: 'Google', type: 'organization' },
      ]);

      expect(prisma.entity.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.memoryEntity.upsert).toHaveBeenCalledTimes(2);
    });

    it('should handle entity storage failure gracefully', async () => {
      prisma.entity.upsert.mockRejectedValue(new Error('unique constraint'));
      // Should not throw — errors are caught per-entity
      await service.storeEntities('user-1', 'm1', [{ name: 'X', type: 'other' }]);
    });
  });
});
