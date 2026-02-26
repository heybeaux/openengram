import { ContextSignalService } from './context-signal.service';

describe('ContextSignalService', () => {
  let service: ContextSignalService;
  let mockEntityService: any;

  beforeEach(() => {
    mockEntityService = {
      list: jest.fn().mockResolvedValue({
        entities: [
          { name: 'Engram', aliases: ['engram-memory'] },
          { name: 'Railway', aliases: [] },
          { name: 'Prisma', aliases: ['prisma-orm'] },
        ],
      }),
    };

    service = new ContextSignalService(mockEntityService);
  });

  describe('extract', () => {
    it('should detect entities in query', async () => {
      const signals = await service.extract(
        'How is Engram doing?',
        'user1',
        new Set(),
      );
      expect(signals.entities).toContain('Engram');
      expect(signals.userId).toBe('user1');
    });

    it('should detect multiple entities', async () => {
      const signals = await service.extract(
        'Check Engram and Railway status',
        'user1',
        new Set(),
      );
      expect(signals.entities).toContain('Engram');
      expect(signals.entities).toContain('Railway');
    });

    it('should detect entity aliases', async () => {
      const signals = await service.extract(
        'How is prisma-orm performing?',
        'user1',
        new Set(),
      );
      expect(signals.entities).toContain('Prisma');
    });

    it('should detect topics from keywords', async () => {
      const signals = await service.extract(
        'The database has errors again',
        'user1',
        new Set(),
      );
      expect(signals.topics).toContain('technical');
    });

    it('should detect family topics', async () => {
      const signals = await service.extract(
        'What did my wife say about the kids?',
        'user1',
        new Set(),
      );
      expect(signals.topics).toContain('family');
    });

    it('should detect project topics', async () => {
      const signals = await service.extract(
        'When do we deploy the feature?',
        'user1',
        new Set(),
      );
      expect(signals.topics).toContain('projects');
    });

    it('should include temporal signals', async () => {
      const signals = await service.extract('test', 'user1', new Set());
      expect(typeof signals.hourOfDay).toBe('number');
      expect(typeof signals.dayOfWeek).toBe('number');
      expect(signals.hourOfDay).toBeGreaterThanOrEqual(0);
      expect(signals.hourOfDay).toBeLessThan(24);
    });

    it('should pass through excludeMemoryIds', async () => {
      const exclude = new Set(['mem_1', 'mem_2']);
      const signals = await service.extract('test', 'user1', exclude);
      expect(signals.excludeMemoryIds).toBe(exclude);
    });

    it('should cache entity names', async () => {
      await service.extract('Engram query', 'user1', new Set());
      await service.extract('Another Engram query', 'user1', new Set());
      // Should only call list once due to caching
      expect(mockEntityService.list).toHaveBeenCalledTimes(1);
    });

    it('should work without entity service', async () => {
      const serviceWithout = new ContextSignalService();
      const signals = await serviceWithout.extract(
        'Engram query',
        'user1',
        new Set(),
      );
      expect(signals.entities).toHaveLength(0);
      expect(signals.topics.length).toBeGreaterThanOrEqual(0);
    });

    it('should not match partial words', async () => {
      // "ram" is part of "Engram" but shouldn't independently match "Railway"
      mockEntityService.list.mockResolvedValue({
        entities: [{ name: 'Ram', aliases: [] }],
      });
      service.clearCache();
      const signals = await service.extract(
        'The program is working',
        'user1',
        new Set(),
      );
      // "program" contains "ram" but word boundary should prevent match
      expect(signals.entities).not.toContain('Ram');
    });
  });

  describe('clearCache', () => {
    it('should clear cache for specific user', async () => {
      await service.extract('Engram', 'user1', new Set());
      service.clearCache('user1');
      await service.extract('Engram', 'user1', new Set());
      expect(mockEntityService.list).toHaveBeenCalledTimes(2);
    });

    it('should clear all cache', async () => {
      await service.extract('Engram', 'user1', new Set());
      service.clearCache();
      await service.extract('Engram', 'user1', new Set());
      expect(mockEntityService.list).toHaveBeenCalledTimes(2);
    });
  });
});
