import { ProactiveNotificationService } from './proactive-notification.service';
import { PrismaService } from '../prisma/prisma.service';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('ProactiveNotificationService', () => {
  let service: ProactiveNotificationService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      awarenessState: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      memory: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };

    service = new ProactiveNotificationService(prisma as unknown as PrismaService);
    mockFetch.mockReset();
  });

  describe('configure', () => {
    it('should store notification config', async () => {
      prisma.awarenessState.upsert.mockResolvedValue({});
      prisma.awarenessState.findUnique.mockResolvedValue(null);

      const config = await service.configure('acc-1', {
        confidenceThreshold: 0.85,
        enabled: true,
        webhookUrl: 'https://example.com/webhook',
      });

      expect(config.confidenceThreshold).toBe(0.85);
      expect(config.enabled).toBe(true);
      expect(config.webhookUrl).toBe('https://example.com/webhook');

      expect(prisma.awarenessState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            accountId_signalSource: {
              accountId: 'acc-1',
              signalSource: 'notification_config',
            },
          },
        }),
      );
    });

    it('should merge with existing config', async () => {
      prisma.awarenessState.findUnique.mockResolvedValue({
        checkpoint: {
          confidenceThreshold: 0.9,
          enabled: true,
          webhookUrl: 'https://old.com/hook',
        },
      });
      prisma.awarenessState.upsert.mockResolvedValue({});

      const config = await service.configure('acc-1', {
        confidenceThreshold: 0.8,
      });

      expect(config.confidenceThreshold).toBe(0.8);
      expect(config.enabled).toBe(true); // preserved from existing
      expect(config.webhookUrl).toBe('https://old.com/hook'); // preserved
    });
  });

  describe('getConfig', () => {
    it('should return defaults when no config exists', async () => {
      prisma.awarenessState.findUnique.mockResolvedValue(null);

      const config = await service.getConfig('acc-1');

      expect(config.confidenceThreshold).toBe(0.9);
      expect(config.enabled).toBe(false);
    });

    it('should return stored config', async () => {
      prisma.awarenessState.findUnique.mockResolvedValue({
        checkpoint: {
          confidenceThreshold: 0.85,
          enabled: true,
          webhookUrl: 'https://example.com/hook',
        },
      });

      const config = await service.getConfig('acc-2');

      expect(config.confidenceThreshold).toBe(0.85);
      expect(config.enabled).toBe(true);
    });
  });

  describe('checkAndNotify', () => {
    it('should skip when disabled', async () => {
      prisma.awarenessState.findUnique.mockResolvedValue({
        checkpoint: { confidenceThreshold: 0.9, enabled: false },
      });

      const results = await service.checkAndNotify('acc-1');

      expect(results).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should skip when no webhook URL configured', async () => {
      prisma.awarenessState.findUnique.mockResolvedValue({
        checkpoint: { confidenceThreshold: 0.9, enabled: true },
      });

      const results = await service.checkAndNotify('acc-1');

      expect(results).toEqual([]);
    });

    it('should send webhook for high-confidence actionable insights', async () => {
      // Configure with enabled + webhook
      prisma.awarenessState.findUnique.mockResolvedValue({
        checkpoint: {
          confidenceThreshold: 0.9,
          enabled: true,
          webhookUrl: 'https://example.com/hook',
          webhookSecret: 'test-secret',
        },
      });

      prisma.memory.findMany.mockResolvedValue([
        {
          id: 'insight-1',
          raw: 'Important actionable insight',
          confidence: 0.95,
          metadata: {
            insightType: 'pattern_connection',
            actionable: true,
            notified: false,
          },
        },
      ]);

      prisma.memory.update.mockResolvedValue({});

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
      });

      const results = await service.checkAndNotify('acc-1');

      expect(results).toHaveLength(1);
      expect(results[0].delivered).toBe(true);
      expect(results[0].insightId).toBe('insight-1');

      // Verify webhook was called
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/hook',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Engram-Event': 'insight.proactive',
            'X-Engram-Signature': expect.any(String),
          }),
        }),
      );

      // Verify insight marked as notified
      expect(prisma.memory.update).toHaveBeenCalledWith({
        where: { id: 'insight-1' },
        data: {
          metadata: expect.objectContaining({
            notified: true,
            notifiedAt: expect.any(String),
          }),
        },
      });
    });

    it('should skip non-actionable insights', async () => {
      prisma.awarenessState.findUnique.mockResolvedValue({
        checkpoint: {
          confidenceThreshold: 0.9,
          enabled: true,
          webhookUrl: 'https://example.com/hook',
        },
      });

      prisma.memory.findMany.mockResolvedValue([
        {
          id: 'insight-1',
          raw: 'Non-actionable insight',
          confidence: 0.95,
          metadata: { actionable: false },
        },
      ]);

      const results = await service.checkAndNotify('acc-1');

      expect(results).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should skip already-notified insights', async () => {
      prisma.awarenessState.findUnique.mockResolvedValue({
        checkpoint: {
          confidenceThreshold: 0.9,
          enabled: true,
          webhookUrl: 'https://example.com/hook',
        },
      });

      prisma.memory.findMany.mockResolvedValue([
        {
          id: 'insight-1',
          raw: 'Already notified',
          confidence: 0.95,
          metadata: { actionable: true, notified: true },
        },
      ]);

      const results = await service.checkAndNotify('acc-1');

      expect(results).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle webhook delivery failure gracefully', async () => {
      prisma.awarenessState.findUnique.mockResolvedValue({
        checkpoint: {
          confidenceThreshold: 0.9,
          enabled: true,
          webhookUrl: 'https://example.com/hook',
        },
      });

      prisma.memory.findMany.mockResolvedValue([
        {
          id: 'insight-1',
          raw: 'Important insight',
          confidence: 0.95,
          metadata: { actionable: true },
        },
      ]);

      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const results = await service.checkAndNotify('acc-1');

      expect(results).toHaveLength(1);
      expect(results[0].delivered).toBe(false);
      expect(results[0].error).toBe('Connection refused');

      // Should NOT mark as notified on failure
      expect(prisma.memory.update).not.toHaveBeenCalled();
    });

    it('should handle non-OK HTTP responses', async () => {
      prisma.awarenessState.findUnique.mockResolvedValue({
        checkpoint: {
          confidenceThreshold: 0.9,
          enabled: true,
          webhookUrl: 'https://example.com/hook',
        },
      });

      prisma.memory.findMany.mockResolvedValue([
        {
          id: 'insight-1',
          raw: 'Insight',
          confidence: 0.95,
          metadata: { actionable: true },
        },
      ]);

      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const results = await service.checkAndNotify('acc-1');

      expect(results[0].delivered).toBe(false);
      expect(results[0].error).toBe('HTTP 500');
    });
  });
});
