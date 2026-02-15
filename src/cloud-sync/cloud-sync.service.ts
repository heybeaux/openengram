import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CloudLinkService } from '../cloud-link/cloud-link.service';
import { MemoryCreatedEvent } from '../events/event-types';

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 500;

export interface SyncResult {
  syncedCount: number;
  errorCount: number;
  lastSyncedAt: string | null;
}

export interface SyncStatus {
  lastSyncedAt: string | null;
  totalMemories: number;
  syncedCount: number;
  pendingCount: number;
  autoSync: boolean;
}

@Injectable()
export class CloudSyncService {
  private readonly logger = new Logger(CloudSyncService.name);
  private readonly CLOUD_API_BASE = 'https://api.openengram.ai';
  private syncing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudLinkService: CloudLinkService,
  ) {}

  async triggerSync(accountId: string): Promise<SyncResult> {
    if (this.syncing) {
      throw new BadRequestException('Sync already in progress');
    }

    const link = await this.getCloudLink(accountId);
    const apiKey = this.decryptApiKey(link.cloudApiKey);

    this.syncing = true;
    try {
      return await this.performSync(apiKey);
    } finally {
      this.syncing = false;
    }
  }

  async getSyncStatus(accountId: string): Promise<SyncStatus> {
    const link = await this.prisma.cloudLink.findUnique({
      where: { accountId },
    });

    if (!link) {
      throw new BadRequestException('Instance not linked to cloud');
    }

    const [totalMemories, syncedCount, lastSynced] = await Promise.all([
      this.prisma.memory.count({ where: { deletedAt: null } }),
      this.prisma.memory.count({
        where: { deletedAt: null, cloudSyncedAt: { not: null } },
      }),
      this.prisma.memory.findFirst({
        where: { cloudSyncedAt: { not: null } },
        orderBy: { cloudSyncedAt: 'desc' },
        select: { cloudSyncedAt: true },
      }),
    ]);

    return {
      lastSyncedAt: lastSynced?.cloudSyncedAt?.toISOString() ?? null,
      totalMemories,
      syncedCount,
      pendingCount: totalMemories - syncedCount,
      autoSync: link.autoSync,
    };
  }

  async setAutoSync(accountId: string, enabled: boolean): Promise<void> {
    const link = await this.prisma.cloudLink.findUnique({
      where: { accountId },
    });
    if (!link) {
      throw new BadRequestException('Instance not linked to cloud');
    }
    await this.prisma.cloudLink.update({
      where: { accountId },
      data: { autoSync: enabled },
    });
  }

  @OnEvent('memory.created')
  async handleMemoryCreated(event: MemoryCreatedEvent): Promise<void> {
    try {
      // Find an account with auto-sync enabled
      const link = await this.prisma.cloudLink.findFirst({
        where: { autoSync: true },
      });
      if (!link) return;

      const apiKey = this.decryptApiKey(link.cloudApiKey);
      const memory = await this.prisma.memory.findUnique({
        where: { id: event.memoryId },
        include: { extraction: true },
      });
      if (!memory || memory.deletedAt) return;

      await this.syncSingleMemory(memory, apiKey);
    } catch (error) {
      this.logger.warn(
        `Auto-sync failed for memory ${event.memoryId}: ${error.message}`,
      );
    }
  }

  private async performSync(apiKey: string): Promise<SyncResult> {
    let syncedCount = 0;
    let errorCount = 0;
    let lastSyncedAt: string | null = null;

    // Process in batches
    let cursor: string | undefined;
    while (true) {
      const batch = await this.prisma.memory.findMany({
        where: {
          deletedAt: null,
          cloudSyncedAt: null,
        },
        include: { extraction: true },
        take: BATCH_SIZE,
        orderBy: { createdAt: 'asc' },
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (batch.length === 0) break;

      for (const memory of batch) {
        try {
          await this.syncSingleMemory(memory, apiKey);
          syncedCount++;
          lastSyncedAt = new Date().toISOString();
        } catch (error) {
          errorCount++;
          this.logger.warn(
            `Failed to sync memory ${memory.id}: ${error.message}`,
          );
        }
      }

      cursor = batch[batch.length - 1].id;

      // Delay between batches to avoid hammering the cloud API
      if (batch.length === BATCH_SIZE) {
        await this.delay(BATCH_DELAY_MS);
      }
    }

    return { syncedCount, errorCount, lastSyncedAt };
  }

  private async syncSingleMemory(memory: any, apiKey: string): Promise<void> {
    const payload = {
      content: memory.raw,
      layer: memory.layer,
      source: memory.source,
      metadata: {
        originalId: memory.id,
        createdAt: memory.createdAt.toISOString(),
        importanceScore: memory.importanceScore,
        effectiveScore: memory.effectiveScore,
        topics: memory.extraction?.topics ?? [],
      },
    };

    const response = await fetch(`${this.CLOUD_API_BASE}/v1/observe`, {
      method: 'POST',
      headers: {
        'X-AM-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (response.status === 401 || response.status === 403) {
        throw new Error('Cloud API key is invalid or expired');
      }
      if (response.status === 429) {
        throw new Error('Cloud API rate limit exceeded');
      }
      throw new Error(`Cloud API error ${response.status}: ${body}`);
    }

    // Mark as synced
    await this.prisma.memory.update({
      where: { id: memory.id },
      data: { cloudSyncedAt: new Date() },
    });
  }

  private async getCloudLink(accountId: string) {
    const link = await this.prisma.cloudLink.findUnique({
      where: { accountId },
    });
    if (!link) {
      throw new BadRequestException('Instance not linked to cloud');
    }
    return link;
  }

  private decryptApiKey(encrypted: string): string {
    // Use the same decryption as CloudLinkService
    const { createDecipheriv, scryptSync } = require('crypto');
    const key = process.env.ENCRYPTION_KEY || 'engram-default-encryption-key-change-me';
    const derivedKey = scryptSync(key, 'engram-salt', 32);
    const [ivHex, encHex] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const enc = Buffer.from(encHex, 'hex');
    const decipher = createDecipheriv('aes-256-cbc', derivedKey, iv);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
