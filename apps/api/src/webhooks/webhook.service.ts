import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWebhookDto, UpdateWebhookDto } from './dto/webhook.dto';
import { validateWebhookUrlSync } from './url-validator';

@Injectable()
export class WebhookService {
  private readonly maxSubscriptions: number;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.maxSubscriptions = parseInt(
      this.config.get('WEBHOOK_MAX_SUBSCRIPTIONS') ?? '50',
      10,
    );
  }

  async create(userId: string, dto: CreateWebhookDto) {
    // Check per-user limit
    const count = await this.prisma.webhookSubscription.count({
      where: { userId },
    });
    if (count >= this.maxSubscriptions) {
      throw new Error(
        `Maximum webhook subscriptions (${this.maxSubscriptions}) reached`,
      );
    }

    validateWebhookUrlSync(dto.url);

    return this.prisma.webhookSubscription.create({
      data: {
        userId,
        url: dto.url,
        events: dto.events,
        secret: dto.secret,
        maxRetries: dto.maxRetries ?? 3,
        backoffMs: dto.backoffMs ?? 1000,
        filterLayers: dto.filterLayers ?? [],
        filterTags: dto.filterTags ?? [],
        filterMinImportance: dto.filterMinImportance,
      },
    });
  }

  async list(userId: string) {
    return this.prisma.webhookSubscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(id: string, userId: string) {
    const sub = await this.prisma.webhookSubscription.findUnique({
      where: { id },
    });
    if (!sub || sub.userId !== userId) return null;
    return sub;
  }

  async update(id: string, userId: string, dto: UpdateWebhookDto) {
    const sub = await this.getById(id, userId);
    if (!sub) throw new Error('Webhook subscription not found');

    if (dto.url !== undefined) {
      validateWebhookUrlSync(dto.url);
    }

    return this.prisma.webhookSubscription.update({
      where: { id },
      data: {
        ...(dto.url !== undefined && { url: dto.url }),
        ...(dto.events !== undefined && { events: dto.events }),
        ...(dto.secret !== undefined && { secret: dto.secret }),
        ...(dto.active !== undefined && { active: dto.active }),
        ...(dto.maxRetries !== undefined && { maxRetries: dto.maxRetries }),
        ...(dto.backoffMs !== undefined && { backoffMs: dto.backoffMs }),
        ...(dto.filterLayers !== undefined && {
          filterLayers: dto.filterLayers,
        }),
        ...(dto.filterTags !== undefined && { filterTags: dto.filterTags }),
        ...(dto.filterMinImportance !== undefined && {
          filterMinImportance: dto.filterMinImportance,
        }),
      },
    });
  }

  async delete(id: string, userId: string) {
    const sub = await this.getById(id, userId);
    if (!sub) throw new Error('Webhook subscription not found');

    await this.prisma.webhookSubscription.delete({ where: { id } });
    return { deleted: true };
  }

  async getDeliveries(id: string, userId: string, limit = 50) {
    const sub = await this.getById(id, userId);
    if (!sub) throw new Error('Webhook subscription not found');

    return this.prisma.webhookDeliveryLog.findMany({
      where: { subscriptionId: id },
      orderBy: { deliveredAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Get all active subscriptions matching an event type
   */
  async getMatchingSubscriptions(eventType: string) {
    return this.prisma.webhookSubscription.findMany({
      where: {
        active: true,
        events: { has: eventType },
      },
    });
  }

  /**
   * Increment failure count, auto-disable after 100
   */
  async recordFailure(id: string) {
    const sub = await this.prisma.webhookSubscription.update({
      where: { id },
      data: { failureCount: { increment: 1 } },
    });

    if (sub.failureCount >= 100) {
      await this.prisma.webhookSubscription.update({
        where: { id },
        data: { active: false },
      });
    }
  }

  /**
   * Reset failure count on success
   */
  async recordSuccess(id: string) {
    await this.prisma.webhookSubscription.update({
      where: { id },
      data: { failureCount: 0 },
    });
  }
}
