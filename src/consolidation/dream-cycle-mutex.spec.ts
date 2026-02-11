import { DreamCycleService } from './dream-cycle.service';

describe('DreamCycleService - Mutex', () => {
  let service: DreamCycleService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      $queryRawUnsafe: jest.fn(),
      dreamCycleRun: {
        create: jest.fn().mockResolvedValue({ id: 'run-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      dreamCycleReport: {
        create: jest.fn().mockResolvedValue({ id: 'report-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      consolidationJob: {
        create: jest.fn().mockResolvedValue({ id: 'job-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      memory: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _avg: { effectiveScore: 0 } }),
      },
    };

    const mockConfig = {
      get: jest.fn().mockReturnValue(undefined),
    };

    service = new DreamCycleService(
      mockPrisma,
      { promoteRecurringPatterns: jest.fn() } as any, // consolidation
      {
        computeScore: jest.fn().mockReturnValue({ effectiveScore: 0.5 }),
      } as any, // scorer
      { search: jest.fn().mockResolvedValue([]) } as any, // embedding
      { json: jest.fn() } as any, // llm
      mockConfig as any, // config
    );
  });

  describe('acquireLock', () => {
    it('should return true when lock is acquired', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ acquired: true }]);
      const result = await service.acquireLock();
      expect(result).toBe(true);
    });

    it('should return false when lock is held by another process', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ acquired: false }]);
      const result = await service.acquireLock();
      expect(result).toBe(false);
    });
  });

  describe('run - mutex behavior', () => {
    it('should skip gracefully when another instance is running', async () => {
      // Lock not acquired
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ acquired: false }]);

      const result = await service.run({ userId: 'test-user' });

      expect(result.status).toBe('SKIPPED');
      expect(result.id).toBe('skipped');
      expect(result.errors).toContain(
        'Skipped: another Dream Cycle instance is already running',
      );
      // Should NOT have created a run record
      expect(mockPrisma.dreamCycleRun.create).not.toHaveBeenCalled();
    });

    it('should proceed when lock is acquired', async () => {
      // Lock acquired
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ acquired: true }]) // acquireLock
        .mockResolvedValueOnce([{}]); // releaseLock

      const result = await service.run({
        userId: 'test-user',
        stages: ['report'],
      });

      expect(result.status).not.toBe('SKIPPED');
      expect(mockPrisma.dreamCycleRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'RUNNING' }),
        }),
      );
      // Should mark run as completed
      expect(mockPrisma.dreamCycleRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
    });

    it('should release lock and mark run as FAILED on error', async () => {
      // Lock acquired
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ acquired: true }]) // acquireLock
        .mockResolvedValueOnce([{}]); // releaseLock

      // Make memory.findMany throw to cause a failure in user auto-discovery
      mockPrisma.memory.findMany.mockRejectedValueOnce(new Error('DB down'));

      // No userId, no DEFAULT_USER_ID → triggers auto-discover which will fail
      await expect(service.run({})).rejects.toThrow('DB down');

      // Should have marked run as FAILED
      expect(mockPrisma.dreamCycleRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED' }),
        }),
      );
    });

    it('should track run record with instance ID', async () => {
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ acquired: true }])
        .mockResolvedValueOnce([{}]);

      await service.run({ userId: 'test-user', stages: ['report'] });

      expect(mockPrisma.dreamCycleRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'RUNNING',
            instanceId: expect.stringContaining('-'), // hostname-pid
          }),
        }),
      );
    });
  });
});
