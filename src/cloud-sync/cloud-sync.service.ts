import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CloudLinkService } from '../cloud-link/cloud-link.service';
import { MemoryCreatedEvent } from '../events/event-types';
import { decrypt } from '../common/encryption.util';
import { generateContentHash } from '../common/content-hash.util';
import {
  SyncPushDto,
  SyncPushResponse,
  SyncPushResultItem,
} from './dto/sync-push.dto';
import { randomUUID, createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 200;
const MAX_SYNC_DURATION_MS = 10 * 60 * 1000; // 10 minutes

export interface SyncResult {
  syncedCount: number;
  newCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  lastSyncedAt: string | null;
  durationMs: number;
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

  async triggerSync(accountId: string): Promise<{ message: string }> {
    if (this.syncing) {
      throw new BadRequestException('Sync already in progress');
    }

    // Read link inside the RLS transaction context
    const link = await this.getCloudLink(accountId);
    const syncKey = link.cloudSyncKey
      ? this.decryptApiKey(link.cloudSyncKey)
      : this.decryptApiKey(link.cloudApiKey);
    const instanceId = link.instanceId;

    // Fire-and-forget: run sync in background with a raw PrismaClient
    // to avoid being constrained by the RLS transaction timeout.
    this.syncing = true;
    this.syncAbortController = new AbortController();
    this.syncProgress = { synced: 0, total: 0 };

    const rawPrisma = new PrismaClient();
    const startTime = Date.now();

    // Use setImmediate to escape the RLS transaction context
    setImmediate(async () => {
      try {
        const result = await this.performSyncWithClient(
          rawPrisma,
          syncKey,
          instanceId,
          this.syncAbortController!.signal,
        );
        // Store sync event
        await rawPrisma.syncEvent.create({
          data: {
            accountId,
            direction: 'push',
            status: 'completed',
            totalCount: result.syncedCount,
            newCount: result.newCount,
            updatedCount: result.updatedCount,
            skippedCount: result.skippedCount,
            failedCount: result.errorCount,
            durationMs: result.durationMs,
          },
        });
        this.logger.log(`Sync completed: ${result.syncedCount} synced, ${result.errorCount} errors, ${result.durationMs}ms`);
      } catch (error: any) {
        this.logger.error(`Sync failed: ${error.message}`);
        const durationMs = Date.now() - startTime;
        await rawPrisma.syncEvent.create({
          data: {
            accountId,
            direction: 'push',
            status: 'failed',
            totalCount: 0,
            newCount: 0,
            updatedCount: 0,
            skippedCount: 0,
            failedCount: 0,
            error: error.message,
            durationMs,
          },
        }).catch(() => {});
      } finally {
        this.syncing = false;
        this.syncAbortController = null;
        await rawPrisma.$disconnect();
      }
    });

    return { message: 'Sync started in background' };
  }

  async getSyncHistory(accountId: string, limit = 5) {
    return this.prisma.syncEvent.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
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

      const apiKey = link.cloudSyncKey
        ? this.decryptApiKey(link.cloudSyncKey)
        : this.decryptApiKey(link.cloudApiKey);
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
    accountId: string,
    instanceId: string,
    dto: SyncPushDto,
  ): Promise<SyncPushResponse> {
    const results: SyncPushResultItem[] = [];

    for (const memPayload of dto.memories) {
      try {
        // 1. Resolve cloud agent via SyncAgentMap
        const cloudAgentId = await this.resolveCloudAgent(
          accountId,
          instanceId,
          memPayload.localAgentId || 'default',
          memPayload.agentName || 'Default Agent',
        );

        // 2. Resolve cloud user via SyncUserMap
        const cloudUserId = await this.resolveCloudUser(
          instanceId,
          cloudAgentId,
          memPayload.localUserId || 'default',
          memPayload.userExternalId || 'default',
        );

        // 3. Check contentHash dedup — skip if already exists
        if (memPayload.contentHash) {
          const existing = await this.prisma.memory.findFirst({
            where: {
              userId: cloudUserId,
              contentHash: memPayload.contentHash,
              deletedAt: null,
            },
            select: { id: true },
          });

          if (existing) {
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

        // 4. Check SyncIdMap — already synced this localId? If so, update metadata
        const existingMap = await this.prisma.syncIdMap.findUnique({
          where: {
            instanceId_localMemoryId: {
              instanceId,
              localMemoryId: memPayload.localId,
            },
          },
        });

        if (existingMap) {
          // Update existing cloud memory metadata if content changed
          if (
            memPayload.contentHash &&
            existingMap.contentHash !== memPayload.contentHash
          ) {
            await this.prisma.memory
              .update({
                where: { id: existingMap.cloudMemoryId },
                data: {
                  raw: memPayload.raw,
                  contentHash: memPayload.contentHash,
                  memoryType: (memPayload.memoryType as any) || undefined,
                  effectiveScore: memPayload.effectiveScore ?? undefined,
                  priority: memPayload.priority ?? undefined,
                },
              })
              .catch(() => {});
            await this.upsertSyncIdMap(
              instanceId,
              memPayload.localId,
              existingMap.cloudMemoryId,
              memPayload.contentHash,
            );
            results.push({
              sourceMemoryId: memPayload.localId,
              cloudMemoryId: existingMap.cloudMemoryId,
              status: 'updated',
            });
          } else {
            results.push({
              sourceMemoryId: memPayload.localId,
              cloudMemoryId: existingMap.cloudMemoryId,
              status: 'skipped',
            });
          }
          continue;
        }

        // 5. Create the memory with correct cloud agentId/userId
        const memory = await this.prisma.memory.create({
          data: {
            userId: cloudUserId,
            raw: memPayload.raw,
            layer: memPayload.layer as any,
            source: (memPayload.source as any) || 'EXPLICIT_STATEMENT',
            memoryType: (memPayload.memoryType as any) || undefined,
            importanceHint: (memPayload.importanceHint as any) || undefined,
            importanceScore: memPayload.importanceScore ?? 0.5,
            effectiveScore: memPayload.effectiveScore ?? 0.5,
            priority: memPayload.priority ?? 3,
            contentHash: memPayload.contentHash,
            createdAt: memPayload.createdAt
              ? new Date(memPayload.createdAt)
              : undefined,
          },
        });

        // 6. Create extraction if provided
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

        // 7. Create SyncIdMap entry
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

    // Track this instance
    const createdCount = results.filter((r) => r.status === 'created').length;
    await this.updateCloudInstance(
      accountId,
      instanceId,
      undefined,
      createdCount,
    ).catch((err) => {
      this.logger.warn(`Failed to update cloud instance: ${err.message}`);
    });

    return { results };
  }

  // =========================================================================
  // Agent/User mapping for sync attribution preservation
  // =========================================================================

  /**
   * Look up or create a cloud agent for the given local agent.
   * Returns the cloud agentId.
   */
  private async resolveCloudAgent(
    accountId: string,
    instanceId: string,
    localAgentId: string,
    agentName: string,
  ): Promise<string> {
    // Try existing mapping by localAgentId
    const existing = await this.prisma.syncAgentMap.findUnique({
      where: {
        instanceId_localAgentId: { instanceId, localAgentId },
      },
    });
    if (existing) return existing.cloudAgentId;

    // Try by agentName (same instance, same name = same agent)
    const byName = await this.prisma.syncAgentMap.findUnique({
      where: {
        instanceId_agentName: { instanceId, agentName },
      },
    });
    if (byName) {
      // Create additional localAgentId mapping
      await this.prisma.syncAgentMap
        .create({
          data: {
            instanceId,
            localAgentId,
            cloudAgentId: byName.cloudAgentId,
            agentName,
          },
        })
        .catch(() => {}); // ignore if already exists
      return byName.cloudAgentId;
    }

    // Create new cloud agent for this synced instance
    const rawKey = `eng_sync_${randomUUID().replace(/-/g, '')}`;
    const apiKeyHash = createHash('sha256').update(rawKey).digest('hex');
    const apiKeyHint = `sync_${agentName.slice(0, 12)}`;

    const agent = await this.prisma.agent.create({
      data: {
        name: agentName,
        apiKeyHash,
        apiKeyHint,
        accountId,
      },
    });

    await this.prisma.syncAgentMap.create({
      data: {
        instanceId,
        localAgentId,
        cloudAgentId: agent.id,
        agentName,
      },
    });

    return agent.id;
  }

  /**
   * Look up or create a cloud user for the given local user.
   * Returns the cloud userId.
   */
  private async resolveCloudUser(
    instanceId: string,
    cloudAgentId: string,
    localUserId: string,
    externalId: string,
  ): Promise<string> {
    // Try existing mapping
    const existing = await this.prisma.syncUserMap.findUnique({
      where: {
        instanceId_localUserId: { instanceId, localUserId },
      },
    });
    if (existing) return existing.cloudUserId;

    // Find or create user under the cloud agent
    let user = await this.prisma.user.findUnique({
      where: {
        agentId_externalId: { agentId: cloudAgentId, externalId },
      },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: { agentId: cloudAgentId, externalId },
      });
    }

    await this.prisma.syncUserMap.create({
      data: {
        instanceId,
        localUserId,
        cloudUserId: user.id,
        externalId,
      },
    });

    return user.id;
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

    this.logger.log(
      `Content hash backfill complete: ${updated} memories updated`,
    );
    return { updated };
  }

  // =========================================================================
  // Local-side: Push sync using /v1/sync/push batch endpoint
  // =========================================================================

  private async performSyncWithClient(
    db: PrismaClient | PrismaService,
    apiKey: string,
    instanceId: string | null,
    signal: AbortSignal,
  ): Promise<SyncResult> {
    let syncedCount = 0;
    let newCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    let lastSyncedAt: string | null = null;
    const startTime = Date.now();

    // Count total pending for progress tracking
    const totalPending = await db.memory.count({
      where: { deletedAt: null, cloudSyncedAt: null },
    });
    this.syncProgress = { synced: 0, total: totalPending };

    // Process in batches
    let cursor: string | undefined;
    while (true) {
      if (signal.aborted) {
        this.logger.log(
          `Sync cancelled. Synced ${syncedCount} memories before cancellation.`,
        );
        break;
      }

      if (Date.now() - startTime > MAX_SYNC_DURATION_MS) {
        this.logger.warn(
          `Sync timed out after ${MAX_SYNC_DURATION_MS / 1000}s. Synced ${syncedCount} memories.`,
        );
        break;
      }

      const batch = await db.memory.findMany({
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
          await db.memory.update({
            where: { id: memory.id },
            data: { contentHash: hash },
          });
          (memory as any).contentHash = hash;
        }
      }

      try {
        const result = await this.syncBatchToCloud(batch, apiKey, instanceId);
        syncedCount += result.synced;
        newCount += result.newCount;
        updatedCount += result.updatedCount;
        skippedCount += result.skippedCount;
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

    const durationMs = Date.now() - startTime;
    return {
      syncedCount,
      newCount,
      updatedCount,
      skippedCount,
      errorCount,
      lastSyncedAt,
      durationMs,
    };
  }

  private async syncBatchToCloud(
    memories: any[],
    apiKey: string,
    instanceId: string | null,
  ): Promise<{
    synced: number;
    errors: number;
    newCount: number;
    updatedCount: number;
    skippedCount: number;
  }> {
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
        ...(apiKey.startsWith('esync_')
          ? { 'X-Sync-Key': apiKey }
          : { 'X-AM-API-Key': apiKey }),
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

    const result: SyncPushResponse = await response.json();

    // Mark successfully synced memories
    let synced = 0;
    let errors = 0;
    let newCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    // Use a raw PrismaClient to bypass the RLS transaction wrapper,
    // which would roll back all updates if the sync takes longer than
    // the transaction timeout.
    const rawPrisma = new PrismaClient();
    try {
      for (const item of result.results) {
        if (
          item.status === 'created' ||
          item.status === 'updated' ||
          item.status === 'skipped'
        ) {
          try {
            await rawPrisma.memory.update({
              where: { id: item.sourceMemoryId },
              data: { cloudSyncedAt: new Date() },
            });
          } catch (e: any) {
            this.logger.error(`Failed to mark ${item.sourceMemoryId} as synced: ${e.message}`);
          }
          synced++;
        if (item.status === 'created') newCount++;
        else if (item.status === 'updated') updatedCount++;
        else skippedCount++;
      } else {
          errors++;
        }
      }
    } finally {
      await rawPrisma.$disconnect();
    }

    return { synced, errors, newCount, updatedCount, skippedCount };
  }

  private async upsertSyncIdMap(
    instanceId: string,
    localMemoryId: string,
    cloudMemoryId: string,
    contentHash?: string,
  ): Promise<void> {
    try {
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
    } catch (e: any) {
      // Handle unique constraint violation on (instanceId, cloudMemoryId)
      // This can happen when multiple local memories with the same content
      // map to the same cloud memory via contentHash dedup.
      if (e.code === 'P2002') {
        this.logger.debug(
          `SyncIdMap constraint conflict for local=${localMemoryId} cloud=${cloudMemoryId}, updating existing entry`,
        );
        // Try updating the existing entry that has this cloudMemoryId
        await this.prisma.syncIdMap.updateMany({
          where: { instanceId, cloudMemoryId },
          data: {
            localMemoryId,
            contentHash: contentHash ?? undefined,
            syncedAt: new Date(),
          },
        }).catch(() => {});
      } else {
        throw e;
      }
    }
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

  // =========================================================================
  // Sync event history
  // =========================================================================

  private async storeSyncEvent(
    accountId: string,
    result: SyncResult,
    status: string,
    error?: string,
  ): Promise<void> {
    try {
      await this.prisma.syncEvent.create({
        data: {
          accountId,
          direction: 'push',
          status,
          totalCount: result.syncedCount,
          newCount: result.newCount,
          updatedCount: result.updatedCount,
          skippedCount: result.skippedCount,
          failedCount: result.errorCount,
          error: error ?? null,
          durationMs: result.durationMs,
        },
      });
    } catch (err: any) {
      this.logger.warn(`Failed to store sync event: ${err.message}`);
    }
  }

  // =========================================================================
  // Cloud-side: Instance tracking
  // =========================================================================

  async updateCloudInstance(
    accountId: string,
    instanceId: string,
    instanceName: string | undefined,
    pushCount: number,
  ): Promise<void> {
    // Count total memories for this instance
    const memoryCount = await this.prisma.syncIdMap.count({
      where: { instanceId },
    });

    await this.prisma.cloudInstance.upsert({
      where: {
        accountId_instanceId: { accountId, instanceId },
      },
      create: {
        accountId,
        instanceId,
        instanceName: instanceName ?? null,
        lastSyncAt: new Date(),
        memoryCount,
        lastPushCount: pushCount,
        status: 'active',
      },
      update: {
        instanceName: instanceName ?? undefined,
        lastSyncAt: new Date(),
        memoryCount,
        lastPushCount: pushCount,
        status: 'active',
      },
    });
  }

  async getInstances(accountId: string) {
    return this.prisma.cloudInstance.findMany({
      where: { accountId },
      orderBy: { lastSyncAt: 'desc' },
    });
  }

  // =========================================================================
  // Cloud-side: Serve pull data for local instances
  // =========================================================================

  async handleSyncPull(
    accountId: string,
    instanceId: string,
    since: Date,
    limit: number,
  ): Promise<{ memories: any[]; hasMore: boolean }> {
    // Find all users belonging to this account's agents
    const agents = await this.prisma.agent.findMany({
      where: { accountId },
      select: { id: true },
    });
    const agentIds = agents.map((a) => a.id);

    const users = await this.prisma.user.findMany({
      where: { agentId: { in: agentIds } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);

    // Get memories updated after `since` (including soft-deleted for tombstones)
    const memories = await this.prisma.memory.findMany({
      where: {
        userId: { in: userIds },
        updatedAt: { gt: since },
      },
      select: {
        id: true,
        raw: true,
        layer: true,
        source: true,
        contentHash: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
      orderBy: { updatedAt: 'asc' },
      take: limit + 1,
    });

    const hasMore = memories.length > limit;
    const batch = hasMore ? memories.slice(0, limit) : memories;

    // Map cloud IDs to local IDs via SyncIdMap
    const cloudMemoryIds = batch.map((m) => m.id);
    const syncMaps = await this.prisma.syncIdMap.findMany({
      where: {
        instanceId,
        cloudMemoryId: { in: cloudMemoryIds },
      },
    });
    const cloudToLocalMap = new Map(
      syncMaps.map((s) => [s.cloudMemoryId, s.localMemoryId]),
    );

    return {
      memories: batch.map((m) => ({
        cloudId: m.id,
        localId: cloudToLocalMap.get(m.id) ?? null,
        raw: m.raw,
        layer: m.layer,
        source: m.source,
        contentHash: m.contentHash,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
        deletedAt: m.deletedAt?.toISOString() ?? null,
      })),
      hasMore,
    };
  }

  // =========================================================================
  // Local-side: Pull sync from cloud
  // =========================================================================

  async triggerPull(accountId: string): Promise<{
    pulledCount: number;
    newCount: number;
    updatedCount: number;
    skippedCount: number;
    deletedCount: number;
    durationMs: number;
  }> {
    const link = await this.getCloudLink(accountId);
    const syncKey = link.cloudSyncKey
      ? this.decryptApiKey(link.cloudSyncKey)
      : this.decryptApiKey(link.cloudApiKey);

    const startTime = Date.now();
    const since = link.lastPulledAt?.toISOString() ?? new Date(0).toISOString();

    let pulledCount = 0;
    let newCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let deletedCount = 0;
    let currentSince = since;
    let hasMore = true;
    const newMemoryIds: string[] = [];

    while (hasMore) {
      const response = await fetch(
        `${this.CLOUD_API_BASE}/v1/sync/pull?since=${encodeURIComponent(currentSince)}&limit=100`,
        {
          headers: {
            ...(syncKey.startsWith('esync_')
              ? { 'X-Sync-Key': syncKey }
              : { 'X-AM-API-Key': syncKey }),
            'X-Instance-Id': link.instanceId || 'unknown',
          },
        },
      );

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new BadRequestException(
          `Cloud pull failed: ${response.status} ${body}`,
        );
      }

      const data = (await response.json()) as {
        memories: Array<{
          cloudId: string;
          localId: string | null;
          raw: string;
          layer: string;
          source: string;
          contentHash: string | null;
          createdAt: string;
          updatedAt: string;
          deletedAt: string | null;
        }>;
        hasMore: boolean;
      };

      for (const mem of data.memories) {
        try {
          // Check if we have this content locally by hash
          if (mem.contentHash) {
            const existingByHash = await this.prisma.memory.findFirst({
              where: { contentHash: mem.contentHash, deletedAt: null },
              select: { id: true },
            });
            if (existingByHash) {
              skippedCount++;
              continue;
            }
          }

          // Tombstone propagation
          if (mem.deletedAt && mem.localId) {
            const localMem = await this.prisma.memory.findUnique({
              where: { id: mem.localId },
              select: { id: true, deletedAt: true },
            });
            if (localMem && !localMem.deletedAt) {
              await this.prisma.memory.update({
                where: { id: mem.localId },
                data: { deletedAt: new Date(mem.deletedAt) },
              });
              deletedCount++;
            } else {
              skippedCount++;
            }
            continue;
          }

          // Update existing local memory
          if (mem.localId) {
            const localMem = await this.prisma.memory.findUnique({
              where: { id: mem.localId },
              select: { id: true, contentHash: true },
            });
            if (localMem) {
              if (localMem.contentHash === mem.contentHash) {
                skippedCount++;
                continue;
              }
              await this.prisma.memory.update({
                where: { id: mem.localId },
                data: {
                  raw: mem.raw,
                  contentHash: mem.contentHash,
                },
              });
              newMemoryIds.push(mem.localId);
              updatedCount++;
              continue;
            }
          }

          // Create new local memory — need a userId
          // Use the first user we can find for this account
          const defaultUser = await this.prisma.user.findFirst({
            where: {
              agent: { accountId },
            },
            select: { id: true },
          });

          if (!defaultUser) {
            this.logger.warn('No user found for pull sync, skipping memory');
            skippedCount++;
            continue;
          }

          const created = await this.prisma.memory.create({
            data: {
              userId: defaultUser.id,
              raw: mem.raw,
              layer: mem.layer as any,
              source: (mem.source as any) || 'EXPLICIT_STATEMENT',
              contentHash: mem.contentHash,
              createdAt: new Date(mem.createdAt),
            },
          });
          newMemoryIds.push(created.id);
          newCount++;
        } catch (err: any) {
          this.logger.warn(
            `Pull sync error for cloud memory ${mem.cloudId}: ${err.message}`,
          );
        }

        pulledCount++;
      }

      hasMore = data.hasMore;
      if (data.memories.length > 0) {
        currentSince = data.memories[data.memories.length - 1].updatedAt;
      }
    }

    // Update lastPulledAt
    await this.prisma.cloudLink.update({
      where: { accountId },
      data: { lastPulledAt: new Date() },
    });

    // Trigger re-embedding for new/updated memories
    if (newMemoryIds.length > 0) {
      this.triggerEmbeddingBackfill(newMemoryIds).catch((err) => {
        this.logger.warn(`Embedding backfill failed: ${err.message}`);
      });
    }

    const durationMs = Date.now() - startTime;

    // Store sync event
    await this.storePullSyncEvent(accountId, {
      pulledCount,
      newCount,
      updatedCount,
      skippedCount,
      deletedCount,
      durationMs,
    });

    return {
      pulledCount,
      newCount,
      updatedCount,
      skippedCount,
      deletedCount,
      durationMs,
    };
  }

  private async triggerEmbeddingBackfill(memoryIds: string[]): Promise<void> {
    try {
      const response = await fetch('http://localhost:8080/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memoryIds }),
      });
      if (!response.ok) {
        this.logger.warn(`Embedding backfill returned ${response.status}`);
      }
    } catch (err: any) {
      // Fallback: try the NestJS embedding endpoint
      this.logger.warn(
        `Embedding service unreachable (${err.message}), memories will be embedded on next backfill cycle`,
      );
    }
  }

  private async storePullSyncEvent(
    accountId: string,
    result: {
      pulledCount: number;
      newCount: number;
      updatedCount: number;
      skippedCount: number;
      deletedCount: number;
      durationMs: number;
    },
  ): Promise<void> {
    try {
      await this.prisma.syncEvent.create({
        data: {
          accountId,
          direction: 'pull',
          status: 'completed',
          totalCount: result.pulledCount,
          newCount: result.newCount,
          updatedCount: result.updatedCount,
          skippedCount: result.skippedCount,
          failedCount: result.deletedCount, // reuse failedCount for deleted in pull context
          durationMs: result.durationMs,
        },
      });
    } catch (err: any) {
      this.logger.warn(`Failed to store pull sync event: ${err.message}`);
    }
  }
}
