import { Test, TestingModule } from '@nestjs/testing';
import { MemorySignalService } from './memory-signal.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('MemorySignalService', () => {
  let service: MemorySignalService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    prisma = {
      memory: { findMany: jest.fn().mockResolvedValue([]) },
      graphEntity: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemorySignalService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MemorySignalService>(MemorySignalService);
  });

  it('should have name "memory"', () => {
    expect(service.name).toBe('memory');
  });

  describe('collect', () => {
    it('should return empty observations when no data', async () => {
      const result = await service.collect(null, { maxQueries: 10 });

      expect(result.observations).toEqual([]);
      expect(result.checkpoint).toHaveProperty('lastCheckedAt');
    });

    it('should use checkpoint.lastCheckedAt when provided', async () => {
      const checkpoint = { lastCheckedAt: '2026-01-01T00:00:00.000Z' };

      await service.collect(checkpoint, { maxQueries: 10 });

      // First query (recent memories) should use the checkpoint date
      expect(prisma.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gt: new Date('2026-01-01T00:00:00.000Z') },
          }),
        }),
      );
    });

    it('should default to 4 hours ago when no checkpoint', async () => {
      const before = Date.now() - 4 * 60 * 60 * 1000;

      await service.collect(null, { maxQueries: 10 });

      const call = prisma.memory.findMany.mock.calls[0][0];
      const sinceDate = (call as any).where.createdAt.gt as Date;
      // Should be roughly 4 hours ago (within 5s tolerance)
      expect(Math.abs(sinceDate.getTime() - before)).toBeLessThan(5000);
    });

    it('should create observation for recent memories', async () => {
      prisma.memory.findMany
        .mockResolvedValueOnce([
          { id: 'm1', raw: 'hello world testing', layer: 'SESSION', createdAt: new Date(), userId: 'u1', agentId: null },
          { id: 'm2', raw: 'another memory item', layer: 'CORE', createdAt: new Date(), userId: 'u1', agentId: 'agent1' },
        ] as any)
        .mockResolvedValueOnce([]) // stale
        .mockResolvedValueOnce([]) // entities (graphEntity, but we mock memory)
        .mockResolvedValueOnce([]) // diverse
        .mockResolvedValueOnce([]); // older

      // graphEntity mock
      prisma.graphEntity.findMany.mockResolvedValue([]);

      const result = await service.collect(null, { maxQueries: 10 });

      expect(result.observations.length).toBeGreaterThanOrEqual(1);
      const newMemObs = result.observations.find(o => o.id.startsWith('new-memories'));
      expect(newMemObs).toBeDefined();
      expect(newMemObs!.relatedMemoryIds).toEqual(['m1', 'm2']);
    });

    it('should create observation for stale memories', async () => {
      prisma.memory.findMany
        .mockResolvedValueOnce([]) // recent
        .mockResolvedValueOnce([
          { id: 'stale-1', raw: 'old forgotten memory', createdAt: new Date('2025-01-01'), importanceScore: 0.7 },
        ] as any)
        .mockResolvedValueOnce([]) // diverse
        .mockResolvedValueOnce([]); // older

      prisma.graphEntity.findMany.mockResolvedValue([]);

      const result = await service.collect(null, { maxQueries: 10 });

      const staleObs = result.observations.find(o => o.id.startsWith('stale-memories'));
      expect(staleObs).toBeDefined();
      expect(staleObs!.content).toContain('1 important memories');
    });

    it('should create observation for hot entities', async () => {
      prisma.memory.findMany.mockResolvedValue([]);
      prisma.graphEntity.findMany.mockResolvedValue([
        { id: 'e1', name: 'Engram', type: 'PROJECT', mentionCount: 15 },
        { id: 'e2', name: 'Beaux', type: 'PERSON', mentionCount: 10 },
      ] as any);

      const result = await service.collect(null, { maxQueries: 10 });

      const entityObs = result.observations.find(o => o.id.startsWith('hot-entities'));
      expect(entityObs).toBeDefined();
      expect(entityObs!.content).toContain('Engram');
      expect(entityObs!.content).toContain('Beaux');
    });

    it('should respect maxQueries budget', async () => {
      // With budget of 1, should only make 1 query
      prisma.memory.findMany.mockResolvedValue([]);
      prisma.graphEntity.findMany.mockResolvedValue([]);

      const result = await service.collect(null, { maxQueries: 1 });

      // Only the first query (recent memories) should run
      expect(prisma.memory.findMany).toHaveBeenCalledTimes(1);
      expect(result.checkpoint.queriesUsed).toBe(1);
    });

    it('should update checkpoint with current state', async () => {
      prisma.memory.findMany.mockResolvedValue([]);
      prisma.graphEntity.findMany.mockResolvedValue([]);

      const result = await service.collect(null, { maxQueries: 10 });

      expect(result.checkpoint).toHaveProperty('lastCheckedAt');
      expect(result.checkpoint).toHaveProperty('queriesUsed');
      expect(result.checkpoint).toHaveProperty('observationCount');
    });
  });
});
