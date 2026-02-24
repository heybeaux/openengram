import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AwarenessConfig } from './config/awareness.config';
import * as crypto from 'crypto';

export interface NotificationConfig {
  confidenceThreshold: number;
  enabled: boolean;
  webhookUrl?: string;
  webhookSecret?: string;
}

export interface NotificationResult {
  insightId: string;
  content: string;
  confidence: number;
  delivered: boolean;
  error?: string;
}

/**
 * HEY-154: Proactive Notifications
 *
 * When insights exceed a configurable confidence threshold and are actionable,
 * push them to configured webhook channels. Integrates with the existing
 * webhook delivery system.
 */
@Injectable()
export class ProactiveNotificationService implements OnModuleDestroy {
  private readonly logger = new Logger(ProactiveNotificationService.name);

  /**
   * In-memory notification configs per account.
   * In production, these would be persisted — for MVP, stored in metadata
   * on a well-known AwarenessState row.
   */
  private readonly configs = new Map<string, NotificationConfig>();

  constructor(private readonly prisma: PrismaService) {}

  onModuleDestroy(): void {
    if (this.configs.size > 0) {
      this.logger.warn(
        `Shutting down with ${this.configs.size} notification config(s) in memory`,
      );
    }
  }

  /**
   * Configure notification settings for an account.
   */
  async configure(
    accountId: string,
    config: Partial<NotificationConfig>,
  ): Promise<NotificationConfig> {
    const existing = await this.getConfig(accountId);
    const merged: NotificationConfig = {
      confidenceThreshold: config.confidenceThreshold ?? existing.confidenceThreshold,
      enabled: config.enabled ?? existing.enabled,
      webhookUrl: config.webhookUrl ?? existing.webhookUrl,
      webhookSecret: config.webhookSecret ?? existing.webhookSecret,
    };

    // Persist config in AwarenessState checkpoint as JSON
    await this.prisma.awarenessState.upsert({
      where: {
        accountId_signalSource: {
          accountId,
          signalSource: 'notification_config',
        },
      },
      update: {
        checkpoint: merged as any,
        lastCheckedAt: new Date(),
      },
      create: {
        accountId,
        signalSource: 'notification_config',
        lastCheckedAt: new Date(),
        checkpoint: merged as any,
      },
    });

    this.configs.set(accountId, merged);
    this.logger.log(
      `Notification config updated for account ${accountId}: ` +
      `threshold=${merged.confidenceThreshold}, enabled=${merged.enabled}`,
    );

    return merged;
  }

  /**
   * Get notification config for an account.
   */
  async getConfig(accountId: string): Promise<NotificationConfig> {
    // Check cache first
    if (this.configs.has(accountId)) {
      return this.configs.get(accountId)!;
    }

    // Load from DB
    const state = await this.prisma.awarenessState.findUnique({
      where: {
        accountId_signalSource: {
          accountId,
          signalSource: 'notification_config',
        },
      },
    });

    const config: NotificationConfig = state?.checkpoint
      ? (state.checkpoint as any as NotificationConfig)
      : {
          confidenceThreshold: 0.9,
          enabled: false,
        };

    this.configs.set(accountId, config);
    return config;
  }

  /**
   * Check newly stored insights and send notifications for high-confidence
   * actionable ones. Called after each Waking Cycle completes.
   */
  async checkAndNotify(accountId: string): Promise<NotificationResult[]> {
    const config = await this.getConfig(accountId);
    if (!config.enabled || !config.webhookUrl) {
      return [];
    }

    // Find recent unacknowledged insights above threshold
    const insights = await this.prisma.memory.findMany({
      where: {
        layer: 'INSIGHT',
        deletedAt: null,
        confidence: { gte: config.confidenceThreshold },
      },
    });

    const results: NotificationResult[] = [];

    for (const insight of insights) {
      const metadata = (insight.metadata as Record<string, any>) || {};

      // Skip non-actionable or already notified
      if (!metadata.actionable) continue;
      if (metadata.notified) continue;

      const result = await this.deliverNotification(config, insight, metadata);
      results.push(result);

      // Mark as notified
      if (result.delivered) {
        await this.prisma.memory.update({
          where: { id: insight.id },
          data: {
            metadata: {
              ...metadata,
              notified: true,
              notifiedAt: new Date().toISOString(),
            },
          },
        });
      }
    }

    if (results.length > 0) {
      this.logger.log(
        `Sent ${results.filter(r => r.delivered).length}/${results.length} notifications for account ${accountId}`,
      );
    }

    return results;
  }

  /**
   * Deliver a single notification via webhook.
   */
  private async deliverNotification(
    config: NotificationConfig,
    insight: any,
    metadata: Record<string, any>,
  ): Promise<NotificationResult> {
    const payload = {
      event: 'insight.proactive',
      timestamp: new Date().toISOString(),
      insight: {
        id: insight.id,
        content: insight.raw,
        confidence: insight.confidence,
        insightType: metadata.insightType,
        actionable: metadata.actionable,
        sourceMemoryIds: metadata.sourceMemoryIds || [],
      },
    };

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Engram-Event': 'insight.proactive',
      };

      if (config.webhookSecret) {
        const body = JSON.stringify(payload);
        headers['X-Engram-Signature'] = crypto
          .createHmac('sha256', config.webhookSecret)
          .update(body)
          .digest('hex');
      }

      const response = await fetch(config.webhookUrl!, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return {
        insightId: insight.id,
        content: insight.raw,
        confidence: insight.confidence,
        delivered: true,
      };
    } catch (error: any) {
      this.logger.warn(
        `Failed to deliver notification for insight ${insight.id}: ${error.message}`,
      );
      return {
        insightId: insight.id,
        content: insight.raw,
        confidence: insight.confidence,
        delivered: false,
        error: error.message,
      };
    }
  }
}
