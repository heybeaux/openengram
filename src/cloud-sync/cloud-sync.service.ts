import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CloudLinkService } from '../cloud-link/cloud-link.service';
import { MemoryCreatedEvent } from '../events/event-types';
import { decrypt } from '../common/encryption.util';
import { randomUUID } from 'crypto';

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 500;
const MAX_SYNC_DURATION_MS = 10 * 60 * 1000; // 10 minutes

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
  syncing: boolean;
  progress?: { synced: number; total: number };
}

@Injectable()
export class CloudSyncService {
  private readonly logger = new Logger(CloudSyncService.name);
  private readonly CLOUD_API_BASE = 'https://api.openengram.ai';
  private syncing = false;
  private syncAbortController: AbortController | null = null;
  private syncProgress = { synced: 0, total: 0 };

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
    this.syncAbortController = new AbortController();
    this.syncProgress = { synced: 0, total: 0 };
    try {
      return await this.performSync(apiKey, this.syncAbortController.signal);
    } finally {
      this.syncing = false;
      this.syncAbortController = null;
    }
  }

  cancelSync(): void {
    if (this.syncAbortController) {
      this.syncAbortController.abort();
      this.logger.log('Sync cancellation requested');
    }
  }

  isSyncing(): boolean {
    return this.syncing;
  }

  getSyncProgress(): { synced: number; total: number } {
    return { ...this.syncProgress };
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
      syncing: this.syncing,
      ...(this.syncing ? { progress: this.getSyncProgress() } : {}),
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

  private async performSync(apiKey: string, signal: AbortSignal): Promise<SyncResult> {
    let syncedCount = 0;
    let errorCount = 0;
    let lastSyncedAt: string | null = null;
    const startTime = Date.now();

    // Count total pending for progress tracking
    const totalPending = await this.prisma.memory.count({
      where: { deletedAt: null, cloudSyncedAt: null },
    });
    this.syncProgress = { synced: 0, total: totalPending };

    // Process in batches
    let cursor: string | undefined;
    while (true) {
      // Check cancellation
      if (signal.aborted) {
        this.logger.log(`Sync cancelled. Synced ${syncedCount} memories before cancellation.`);
        break;
      }

      // Check timeout
      if (Date.now() - startTime > MAX_SYNC_DURATION_MS) {
        this.logger.warn(`Sync timed out after ${MAX_SYNC_DURATION_MS / 1000}s. Synced ${syncedCount} memories.`);
        break;
      }

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
        if (signal.aborted) break;

        try {
          await this.syncSingleMemory(memory, apiKey);
          syncedCount++;
          this.syncProgress.synced = syncedCount;
          lastSyncedAt = new Date().toISOString();
        } catch (error: any) {
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

  private async getInstanceId(): Promise<string | null> {
    const link = await this.prisma.cloudLink.findFirst({
      select: { instanceId: true },
    });
    return link?.instanceId ?? null;
  }

  private async syncSingleMemory(memory: any, apiKey: string): Promise<void> {
    const instanceId = await this.getInstanceId();
    const payload = {
      content: memory.raw,
      layer: memory.layer,
      source: memory.source,
      metadata: {
        originalId: memory.id,
        originalMemoryId: memory.id,
        sourceInstanceId: instanceId,
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

    // Only mark as synced after verified 2xx response
    if (response.status >= 200 && response.status < 300) {
      await this.prisma.memory.update({
        where: { id: memory.id },
        data: { cloudSyncedAt: new Date() },
      });
    }
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
    return decrypt(encrypted);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
