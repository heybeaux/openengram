import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WebhookService } from './webhook.service';
import { PrismaService } from '../prisma/prisma.service';

describe('WebhookService', () => {
  let service: WebhookService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      webhookSubscription: {
        count: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      webhookDeliveryLog: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('50') },
        },
      ],
    }).compile();

    service = module.get(WebhookService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('creates a webhook subscription', async () => {
      mockPrisma.webhookSubscription.count.mockResolvedValue(0);
      mockPrisma.webhookSubscription.create.mockResolvedValue({
        id: 'wh-1',
        userId: 'u1',
        url: 'https://example.com/hook',
        events: ['memory.created'],
      });

      const result = await service.create('u1', {
        url: 'https://example.com/hook',
        events: ['memory.created'],
      });

      expect(result.id).toBe('wh-1');
      expect(mockPrisma.webhookSubscription.create).toHaveBeenCalled();
    });

    it('throws when max subscriptions reached', async () => {
      mockPrisma.webhookSubscription.count.mockResolvedValue(50);

      await expect(
        service.create('u1', {
          url: 'https://example.com/hook',
          events: ['memory.created'],
        }),
      ).rejects.toThrow('Maximum webhook subscriptions');
    });
  });

  describe('list', () => {
    it('returns user subscriptions', async () => {
      mockPrisma.webhookSubscription.findMany.mockResolvedValue([
        { id: 'wh-1' },
      ]);

      const result = await service.list('u1');
      expect(result).toHaveLength(1);
    });
  });

  describe('getById', () => {
    it('returns subscription for correct user', async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue({
        id: 'wh-1',
        userId: 'u1',
      });

      const result = await service.getById('wh-1', 'u1');
      expect(result?.id).toBe('wh-1');
    });

    it('returns null for wrong user', async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue({
        id: 'wh-1',
        userId: 'u2',
      });

      const result = await service.getById('wh-1', 'u1');
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('updates a subscription', async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue({
        id: 'wh-1',
        userId: 'u1',
      });
      mockPrisma.webhookSubscription.update.mockResolvedValue({
        id: 'wh-1',
        active: false,
      });

      const result = await service.update('wh-1', 'u1', { active: false });
      expect(result.active).toBe(false);
    });
  });

  describe('delete', () => {
    it('deletes a subscription', async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue({
        id: 'wh-1',
        userId: 'u1',
      });
      mockPrisma.webhookSubscription.delete.mockResolvedValue({});

      const result = await service.delete('wh-1', 'u1');
      expect(result.deleted).toBe(true);
    });

    it('throws for non-existent subscription', async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(null);

      await expect(service.delete('wh-1', 'u1')).rejects.toThrow('not found');
    });
  });

  describe('getMatchingSubscriptions', () => {
    it('finds active subscriptions for event', async () => {
      mockPrisma.webhookSubscription.findMany.mockResolvedValue([
        { id: 'wh-1', events: ['memory.created'] },
      ]);

      const result = await service.getMatchingSubscriptions('memory.created');
      expect(result).toHaveLength(1);
    });
  });

  describe('recordFailure / recordSuccess', () => {
    it('increments failure count', async () => {
      mockPrisma.webhookSubscription.update.mockResolvedValue({
        id: 'wh-1',
        failureCount: 1,
      });

      await service.recordFailure('wh-1');
      expect(mockPrisma.webhookSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wh-1' },
        }),
      );
    });

    it('auto-disables after 100 failures', async () => {
      mockPrisma.webhookSubscription.update.mockResolvedValue({
        id: 'wh-1',
        failureCount: 100,
      });

      await service.recordFailure('wh-1');
      // Second call should disable
      expect(mockPrisma.webhookSubscription.update).toHaveBeenCalledTimes(2);
    });

    it('resets failure count on success', async () => {
      mockPrisma.webhookSubscription.update.mockResolvedValue({});

      await service.recordSuccess('wh-1');
      expect(mockPrisma.webhookSubscription.update).toHaveBeenCalledWith({
        where: { id: 'wh-1' },
        data: { failureCount: 0 },
      });
    });
  });
});
