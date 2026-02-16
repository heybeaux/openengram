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
import { generateContentHash } from '../common/content-hash.util';
import { SyncPushDto, SyncPushResponse, SyncPushResultItem } from './dto/sync-push.dto';
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
      return await this.performSync(apiKey, link.instanceId, this.syncAbortController.signal);
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
        include: { extraction: true, entities: { include: { entity: true } } },
      });
      if (!memory || memory.deletedAt) return;

      // Ensure contentHash is set
      if (!memory.contentHash) {
        const contentHash = generateContentHash(memory.raw);
        await this.prisma.memory.update({
          where: { id: memory.id },
          data: { contentHash },
        });
        (memory as any).contentHash = contentHash;
      }

      await this.syncBatchToCloud([memory], apiKey, link.instanceId);
    } catch (error: any) {
      this.logger.warn(
        `Auto-sync failed for memory ${event.memoryId}: ${error.message}`,
      );
    }
  }

  // =========================================================================
  // Cloud-side: Handle incoming sync push from local instances
  // =========================================================================

  async handleSyncPush(
    userId: string,
    instanceId: string,
    dto: SyncPushDto,
  ): Promise<SyncPushResponse> {
    const results: SyncPushResultItem[] = [];

    for (const memPayload of dto.memories) {
      try {
        // 1. Check contentHash dedup — skip if already exists
        if (memPayload.contentHash) {
          const existing = await this.prisma.memory.findFirst({
            where: {
              userId,
              contentHash: memPayload.contentHash,
              deletedAt: null,
            },
            select: { id: true },
          });

          if (existing) {
            // Ensure SyncIdMap entry exists
            await this.upsertSyncIdMap(
              instanceId,
              memPayload.localId,
              existing.id,
              memPayload.contentHash,
            );
            results.push({
              sourceMemoryId: memPayload.localId,
              cloudMemoryId: existing.id,
              status: 'skipped',
            });
            continue;
          }
        }

        // 2. Check SyncIdMap — already synced this localId?
        const existingMap = await this.prisma.syncIdMap.findUnique({
          where: {
            instanceId_localMemoryId: {
              instanceId,
              localMemoryId: memPayload.localId,
            },
          },
        });

        if (existingMap) {
          results.push({
            sourceMemoryId: memPayload.localId,
            cloudMemoryId: existingMap.cloudMemoryId,
            status: 'skipped',
          });
          continue;
        }

        // 3. Create the memory
        const memory = await this.prisma.memory.create({
          data: {
            userId,
            raw: memPayload.raw,
            layer: memPayload.layer as any,
            source: (memPayload.source as any) || 'EXPLICIT_STATEMENT',
            memoryType: memPayload.memoryType as any || undefined,
            importanceHint: memPayload.importanceHint as any || undefined,
            importanceScore: memPayload.importanceScore ?? 0.5,
            effectiveScore: memPayload.effectiveScore ?? 0.5,
            priority: memPayload.priority ?? 3,
            contentHash: memPayload.contentHash,
            createdAt: memPayload.createdAt ? new Date(memPayload.createdAt) : undefined,
          },
        });

        // 4. Create extraction if provided
        if (memPayload.extraction) {
          const ext = memPayload.extraction;
          await this.prisma.memoryExtraction.create({
            data: {
              memoryId: memory.id,
              who: ext.who,
              what: ext.what,
              when: ext.when ? new Date(ext.when) : undefined,
              whereCtx: ext.whereCtx,
              why: ext.why,
              how: ext.how,
              topics: ext.topics ?? [],
            },
          });
        }

        // 5. Create SyncIdMap entry
        await this.upsertSyncIdMap(
          instanceId,
          memPayload.localId,
          memory.id,
          memPayload.contentHash,
        );

        results.push({
          sourceMemoryId: memPayload.localId,
          cloudMemoryId: memory.id,
          status: 'created',
        });
      } catch (error: any) {
        this.logger.warn(
          `Failed to ingest synced memory ${memPayload.localId}: ${error.message}`,
        );
        results.push({
          sourceMemoryId: memPayload.localId,
          status: 'failed',
          error: error.message,
        });
      }
    }

    return { results };
  }

  // =========================================================================
  // Content hash backfill
  // =========================================================================

  async backfillContentHashes(batchSize = 500): Promise<{ updated: number }> {
    let updated = 0;
    let cursor: string | undefined;

    while (true) {
      const memories = await this.prisma.memory.findMany({
        where: { contentHash: null, deletedAt: null },
        select: { id: true, raw: true },
        take: batchSize,
        orderBy: { id: 'asc' },
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (memories.length === 0) break;

      for (const mem of memories) {
        const hash = generateContentHash(mem.raw);
        await this.prisma.memory.update({
          where: { id: mem.id },
          data: { contentHash: hash },
        });
        updated++;
      }

      cursor = memories[memories.length - 1].id;
      this.logger.log(`Backfilled ${updated} content hashes...`);
    }

    this.logger.log(`Content hash backfill complete: ${updated} memories updated`);
    return { updated };
  }

  // =========================================================================
  // Local-side: Push sync using /v1/sync/push batch endpoint
  // =========================================================================

  private async performSync(apiKey: string, instanceId: string | null, signal: AbortSignal): Promise<SyncResult> {
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
      if (signal.aborted) {
        this.logger.log(`Sync cancelled. Synced ${syncedCount} memories before cancellation.`);
        break;
      }

      if (Date.now() - startTime > MAX_SYNC_DURATION_MS) {
        this.logger.warn(`Sync timed out after ${MAX_SYNC_DURATION_MS / 1000}s. Synced ${syncedCount} memories.`);
        break;
      }

      const batch = await this.prisma.memory.findMany({
        where: {
          deletedAt: null,
          cloudSyncedAt: null,
        },
        include: { extraction: true, entities: { include: { entity: true } } },
        take: BATCH_SIZE,
        orderBy: { createdAt: 'asc' },
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (batch.length === 0) break;

      // Ensure all memories have contentHash
      for (const memory of batch) {
        if (!memory.contentHash) {
          const hash = generateContentHash(memory.raw);
          await this.prisma.memory.update({
            where: { id: memory.id },
            data: { contentHash: hash },
          });
          (memory as any).contentHash = hash;
        }
      }

      try {
        const result = await this.syncBatchToCloud(batch, apiKey, instanceId);
        syncedCount += result.synced;
        errorCount += result.errors;
        this.syncProgress.synced = syncedCount;
        if (result.synced > 0) {
          lastSyncedAt = new Date().toISOString();
        }
      } catch (error: any) {
        errorCount += batch.length;
        this.logger.warn(`Batch sync failed: ${error.message}`);
        // On 401/403, stop entirely
        if (error.message?.includes('invalid or expired')) {
          break;
        }
      }

      cursor = batch[batch.length - 1].id;

      if (batch.length === BATCH_SIZE) {
        await this.delay(BATCH_DELAY_MS);
      }
    }

    return { syncedCount, errorCount, lastSyncedAt };
  }

  private async syncBatchToCloud(
    memories: any[],
    apiKey: string,
    instanceId: string | null,
  ): Promise<{ synced: number; errors: number }> {
    const effectiveInstanceId = instanceId || 'unknown';

    const payload: SyncPushDto = {
      memories: memories.map((m) => ({
        raw: m.raw,
        layer: m.layer,
        memoryType: m.memoryType ?? undefined,
        source: m.source,
        importanceHint: m.importanceHint ?? undefined,
        importanceScore: m.importanceScore,
        effectiveScore: m.effectiveScore,
        priority: m.priority,
        contentHash: m.contentHash || generateContentHash(m.raw),
        localId: m.id,
        instanceId: effectiveInstanceId,
        createdAt: m.createdAt.toISOString(),
        extraction: m.extraction
          ? {
              who: m.extraction.who ?? undefined,
              what: m.extraction.what ?? undefined,
              when: m.extraction.when?.toISOString() ?? undefined,
              whereCtx: m.extraction.whereCtx ?? undefined,
              why: m.extraction.why ?? undefined,
              how: m.extraction.how ?? undefined,
              topics: m.extraction.topics ?? [],
            }
          : undefined,
        entities: m.entities?.map((me: any) => ({
          name: me.entity.name,
          type: me.entity.type,
          normalizedName: me.entity.normalizedName,
        })),
      })),
      syncProtocolVersion: 2,
    };

    const response = await fetch(`${this.CLOUD_API_BASE}/v1/sync/push`, {
      method: 'POST',
      headers: {
        'X-AM-API-Key': apiKey,
        'X-Instance-Id': effectiveInstanceId,
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

    const result: SyncPushResponse = await response.json() as any;

    // Mark successfully synced memories
    let synced = 0;
    let errors = 0;
    for (const item of result.results) {
      if (item.status === 'created' || item.status === 'skipped') {
        await this.prisma.memory.update({
          where: { id: item.sourceMemoryId },
          data: { cloudSyncedAt: new Date() },
        });
        synced++;
      } else {
        errors++;
      }
    }

    return { synced, errors };
  }

  private async upsertSyncIdMap(
    instanceId: string,
    localMemoryId: string,
    cloudMemoryId: string,
    contentHash?: string,
  ): Promise<void> {
    await this.prisma.syncIdMap.upsert({
      where: {
        instanceId_localMemoryId: { instanceId, localMemoryId },
      },
      create: {
        instanceId,
        localMemoryId,
        cloudMemoryId,
        contentHash: contentHash ?? null,
      },
      update: {
        cloudMemoryId,
        contentHash: contentHash ?? undefined,
        syncedAt: new Date(),
      },
    });
  }

  private async getInstanceId(): Promise<string | null> {
    const link = await this.prisma.cloudLink.findFirst({
      select: { instanceId: true },
    });
    return link?.instanceId ?? null;
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
