import { MonitoringService } from './monitoring.service';

describe('MonitoringService', () => {
  let service: MonitoringService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      memory: { count: jest.fn().mockResolvedValue(500) },
      monitoringSnapshot: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      dreamCycleReport: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    service = new MonitoringService(mockPrisma);
  });

  describe('recordEmbeddingFailure', () => {
    it('should track embedding failures', async () => {
      service.recordEmbeddingFailure('text-embedding-3-small');
      service.recordEmbeddingFailure('text-embedding-3-small');
      service.recordEmbeddingFailure('nomic-embed-text');

      const metrics = await service.getMetrics();
      expect(metrics.embeddingFailures.countLastHour).toBe(3);
      expect(metrics.embeddingFailures.byModel['text-embedding-3-small']).toBe(2);
      expect(metrics.embeddingFailures.byModel['nomic-embed-text']).toBe(1);
    });
  });

  describe('recordApiError', () => {
    it('should track 5xx errors', async () => {
      service.recordApiError(500, '/v1/observe');
      service.recordApiError(503, '/v1/memories/query');

      const metrics = await service.getMetrics();
      expect(metrics.apiErrors.count5xxLastHour).toBe(2);
    });
  });

  describe('getMetrics', () => {
    it('should return current memory count', async () => {
      const metrics = await service.getMetrics();
      expect(metrics.memoryCount.current).toBe(500);
      expect(metrics.memoryCount.previousSnapshot).toBeNull();
      expect(metrics.memoryCount.delta).toBeNull();
    });

    it('should calculate delta from previous snapshot', async () => {
      mockPrisma.monitoringSnapshot.findFirst.mockResolvedValue({
        metrics: { memoryCount: { current: 600 } },
      });

      const metrics = await service.getMetrics();
      expect(metrics.memoryCount.delta).toBe(-100); // 500 - 600
      expect(metrics.memoryCount.previousSnapshot).toBe(600);
    });

    it('should include dream cycle status', async () => {
      mockPrisma.dreamCycleReport.findFirst.mockResolvedValue({
        completedAt: new Date('2026-02-10T05:00:00Z'),
        durationMs: 45000,
        status: 'COMPLETED',
      });

      const metrics = await service.getMetrics();
      expect(metrics.dreamCycle.lastStatus).toBe('COMPLETED');
      expect(metrics.dreamCycle.lastDurationMs).toBe(45000);
      expect(metrics.dreamCycle.lastSuccessfulRun).toBe('2026-02-10T05:00:00.000Z');
    });
  });

  describe('getAlerts', () => {
    it('should return no alerts when everything is healthy', async () => {
      const alerts = await service.getAlerts();
      expect(alerts).toEqual([]);
    });

    it('should alert on high embedding failure count', async () => {
      // Record 15 failures
      for (let i = 0; i < 15; i++) {
        service.recordEmbeddingFailure('test-model');
      }

      const alerts = await service.getAlerts();
      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe('embedding_failures');
      expect(alerts[0].level).toBe('critical');
    });

    it('should alert on memory count drop > 100', async () => {
      mockPrisma.monitoringSnapshot.findFirst.mockResolvedValue({
        metrics: { memoryCount: { current: 643 } },
      });
      // current is 500, previous was 643 = -143 drop

      const alerts = await service.getAlerts();
      const dropAlert = alerts.find((a) => a.type === 'memory_count_drop');
      expect(dropAlert).toBeDefined();
      expect(dropAlert!.level).toBe('critical');
      expect(dropAlert!.message).toContain('143');
    });

    it('should alert on high 5xx error rate', async () => {
      for (let i = 0; i < 55; i++) {
        service.recordApiError(500, '/test');
      }

      const alerts = await service.getAlerts();
      const errorAlert = alerts.find((a) => a.type === 'api_error_rate');
      expect(errorAlert).toBeDefined();
      expect(errorAlert!.level).toBe('critical');
    });

    it('should warn on elevated 5xx error rate', async () => {
      for (let i = 0; i < 15; i++) {
        service.recordApiError(500, '/test');
      }

      const alerts = await service.getAlerts();
      const errorAlert = alerts.find((a) => a.type === 'api_error_rate');
      expect(errorAlert).toBeDefined();
      expect(errorAlert!.level).toBe('warning');
    });

    it('should alert on failed dream cycle', async () => {
      mockPrisma.dreamCycleReport.findFirst.mockResolvedValue({
        completedAt: null,
        durationMs: null,
        status: 'FAILED',
      });

      const alerts = await service.getAlerts();
      const dreamAlert = alerts.find((a) => a.type === 'dream_cycle_failed');
      expect(dreamAlert).toBeDefined();
      expect(dreamAlert!.level).toBe('warning');
    });
  });

  describe('takeSnapshot', () => {
    it('should persist metrics and alerts to database', async () => {
      await service.takeSnapshot();
      expect(mockPrisma.monitoringSnapshot.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metrics: expect.any(Object),
          alerts: expect.any(Array),
        }),
      });
    });
  });
});
