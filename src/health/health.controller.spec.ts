import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';
import { EmbedHealthService } from './embed-health.service';
import { MonitoringService } from '../monitoring/monitoring.service';

describe('HealthController', () => {
  let controller: HealthController;
  let mockPrisma: any;
  let mockEmbedHealth: any;
  let mockMonitoring: any;

  beforeEach(async () => {
    mockPrisma = {
      memory: {
        count: jest.fn().mockResolvedValue(42),
      },
      dreamCycleReport: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    mockEmbedHealth = {
      getStatus: jest.fn().mockResolvedValue({
        status: 'up',
        latencyMs: 5,
        lastUp: new Date(),
      }),
    };

    mockMonitoring = {
      getAlerts: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmbedHealthService, useValue: mockEmbedHealth },
        { provide: MonitoringService, useValue: mockMonitoring },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('check', () => {
    it('should return healthy when all dependencies are up', async () => {
      const result = await controller.check();

      expect(result.status).toBe('healthy');
      expect(result.dependencies.database.status).toBe('up');
      expect(result.dependencies.database.memoryCount).toBe(42);
      expect(result.dependencies.engramEmbed.status).toBe('up');
      expect(result.uptime).toBeGreaterThanOrEqual(0);
      expect(result.memory.heapUsed).toMatch(/\d+MB/);
    });

    it('should throw 503 when database is down', async () => {
      mockPrisma.memory.count.mockRejectedValue(
        new Error('Connection refused'),
      );

      await expect(controller.check()).rejects.toThrow(HttpException);
      try {
        await controller.check();
      } catch (e) {
        expect(e.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        const response = e.getResponse();
        expect(response.status).toBe('unhealthy');
        expect(response.dependencies.database.status).toBe('down');
      }
    });

    it('should return degraded when embed service is down', async () => {
      mockEmbedHealth.getStatus.mockResolvedValue({
        status: 'down',
        latencyMs: null,
        lastUp: null,
      });

      const result = await controller.check();

      expect(result.status).toBe('degraded');
      expect(result.dependencies.engramEmbed.status).toBe('down');
    });

    it('should return degraded when critical monitoring alerts exist', async () => {
      mockMonitoring.getAlerts.mockResolvedValue([
        { level: 'critical', message: 'High memory usage' },
      ]);

      const result = await controller.check();

      expect(result.status).toBe('degraded');
      expect(result.monitoring.hasCriticalAlerts).toBe(true);
      expect(result.monitoring.alertCount).toBe(1);
    });

    it('should include dream cycle info when available', async () => {
      const completedAt = new Date('2026-02-14T03:00:00Z');
      mockPrisma.dreamCycleReport.findFirst.mockResolvedValue({
        completedAt,
        status: 'completed',
      });

      const result = await controller.check();

      expect(result.dreamCycle).toEqual({
        lastRun: completedAt.toISOString(),
        status: 'completed',
      });
    });

    it('should handle dream cycle table not existing', async () => {
      mockPrisma.dreamCycleReport.findFirst.mockRejectedValue(
        new Error('Table does not exist'),
      );

      const result = await controller.check();

      expect(result.dreamCycle).toBeNull();
    });

    it('should handle monitoring service errors gracefully', async () => {
      mockMonitoring.getAlerts.mockRejectedValue(new Error('Not ready'));

      const result = await controller.check();

      expect(result.status).toBe('healthy');
      expect(result.monitoring.alertCount).toBe(0);
    });
  });
});
