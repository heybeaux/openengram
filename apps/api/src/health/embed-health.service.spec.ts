import { Test, TestingModule } from '@nestjs/testing';
import { EmbedHealthService } from './embed-health.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('EmbedHealthService', () => {
  let service: EmbedHealthService;
  let mockEmbeddingService: any;
  let mockEventEmitter: any;

  beforeEach(async () => {
    mockEmbeddingService = {
      healthCheck: jest.fn().mockResolvedValue(true),
    };

    mockEventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmbedHealthService,
        { provide: EmbeddingService, useValue: mockEmbeddingService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<EmbedHealthService>(EmbedHealthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getStatus', () => {
    it('should return up when embedding service is healthy', async () => {
      const status = await service.getStatus();

      expect(status.status).toBe('up');
      expect(status.latencyMs).toBeGreaterThanOrEqual(0);
      expect(status.lastUp).toBeInstanceOf(Date);
      expect(status.lastChecked).toBeInstanceOf(Date);
    });

    it('should return down when embedding service is unhealthy', async () => {
      mockEmbeddingService.healthCheck.mockResolvedValue(false);

      const status = await service.getStatus();

      expect(status.status).toBe('down');
      expect(status.latencyMs).toBeNull();
    });

    it('should return down when embedding service throws', async () => {
      mockEmbeddingService.healthCheck.mockRejectedValue(new Error('timeout'));

      const status = await service.getStatus();

      expect(status.status).toBe('down');
      expect(status.latencyMs).toBeNull();
    });

    it('should cache status for 30 seconds', async () => {
      await service.getStatus();
      await service.getStatus();
      await service.getStatus();

      // healthCheck should only be called once due to caching
      expect(mockEmbeddingService.healthCheck).toHaveBeenCalledTimes(1);
    });
  });

  describe('isAvailable', () => {
    it('should return true when up', async () => {
      expect(await service.isAvailable()).toBe(true);
    });

    it('should return false when down', async () => {
      mockEmbeddingService.healthCheck.mockResolvedValue(false);
      expect(await service.isAvailable()).toBe(false);
    });
  });

  describe('refresh', () => {
    it('should force a fresh check bypassing cache', async () => {
      await service.getStatus(); // cached
      await service.refresh(); // forced

      expect(mockEmbeddingService.healthCheck).toHaveBeenCalledTimes(2);
    });

    it('should emit health.degraded when service goes down', async () => {
      mockEmbeddingService.healthCheck.mockResolvedValue(false);

      await service.refresh();

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'health.degraded',
        expect.objectContaining({ service: 'embedding' }),
      );
    });

    it('should emit health.recovered when service comes back up', async () => {
      // First: go down
      mockEmbeddingService.healthCheck.mockResolvedValue(false);
      await service.refresh();

      // Then: come back up
      mockEmbeddingService.healthCheck.mockResolvedValue(true);
      await service.refresh();

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'health.recovered',
        expect.objectContaining({ service: 'embedding' }),
      );
    });

    it('should only log state changes once', async () => {
      mockEmbeddingService.healthCheck.mockResolvedValue(false);

      await service.refresh();
      await service.refresh();

      // Should only emit degraded once, not twice
      const degradedCalls = mockEventEmitter.emit.mock.calls.filter(
        (c: any) => c[0] === 'health.degraded',
      );
      expect(degradedCalls).toHaveLength(1);
    });

    it('should preserve lastUp from previous status when going down', async () => {
      // First: up
      await service.refresh();
      const upStatus = await service.getStatus();
      const lastUpTime = upStatus.lastUp;

      // Then: down
      mockEmbeddingService.healthCheck.mockResolvedValue(false);
      const downStatus = await service.refresh();

      expect(downStatus.lastUp).toEqual(lastUpTime);
    });
  });
});
