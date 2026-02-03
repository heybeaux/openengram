import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExtractionService, ExtractionContext, EntityWithType } from './extraction.service';

export interface BackfillOptions {
  batchSize?: number;
  dryRun?: boolean;
  delayMs?: number; // Delay between extractions to avoid rate limits
}

export interface BackfillResult {
  processed: number;
  errors: number;
  skipped: number;
  total: number;
  details: Array<{
    memoryId: string;
    status: 'success' | 'error' | 'skipped';
    who?: string | null;
    what?: string | null;
    error?: string;
  }>;
}

/**
 * Service to backfill missing extraction data for existing memories.
 * This is needed because the case sensitivity bug caused 5W1H extraction to fail silently.
 */
@Injectable()
export class BackfillService {
  constructor(
    private prisma: PrismaService,
    private extraction: ExtractionService,
  ) {}

  /**
   * Find all memories with empty 5W1H extraction data
   */
  async findMemoriesNeedingBackfill(): Promise<Array<{
    id: string;
    raw: string;
    userId: string;
    userName: string | null;
  }>> {
    const memories = await this.prisma.memory.findMany({
      where: {
        deletedAt: null,
        extraction: {
          AND: [
            { who: null },
            { what: null },
          ],
        },
      },
      include: {
        extraction: { select: { id: true } },
        user: { select: { externalId: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return memories.map(m => ({
      id: m.id,
      raw: m.raw,
      userId: m.userId,
      userName: m.user.externalId,
    }));
  }

  /**
   * Backfill missing extraction data for memories
   * @param options - Batch size, dry run flag, delay between extractions
   */
  async backfillExtractions(options: BackfillOptions = {}): Promise<BackfillResult> {
    const { batchSize = 50, dryRun = false, delayMs = 500 } = options;

    // Get all memories needing backfill
    const allMemories = await this.findMemoriesNeedingBackfill();
    const total = allMemories.length;

    console.log(`[Backfill] Found ${total} memories needing backfill (dryRun: ${dryRun})`);

    if (total === 0) {
      return { processed: 0, errors: 0, skipped: 0, total: 0, details: [] };
    }

    // Take only the batch size
    const memories = allMemories.slice(0, batchSize);
    const skipped = total - memories.length;

    console.log(`[Backfill] Processing batch of ${memories.length} memories (${skipped} remaining for future batches)`);

    let processed = 0;
    let errors = 0;
    const details: BackfillResult['details'] = [];

    for (let i = 0; i < memories.length; i++) {
      const memory = memories[i];
      const progress = `[${i + 1}/${memories.length}]`;

      try {
        const context: ExtractionContext = {
          userId: memory.userId,
          userName: memory.userName ?? undefined,
        };

        // Extract 5W1H data
        const extracted = await this.extraction.extract(memory.raw, context);

        if (dryRun) {
          console.log(`${progress} [DRY RUN] Would update ${memory.id}: who="${extracted.who}", what="${extracted.what?.substring(0, 50)}..."`);
          details.push({
            memoryId: memory.id,
            status: 'success',
            who: extracted.who,
            what: extracted.what,
          });
          processed++;
        } else {
          // Update extraction record
          await this.prisma.memoryExtraction.update({
            where: { memoryId: memory.id },
            data: {
              who: extracted.who,
              what: extracted.what,
              when: extracted.when ? new Date(extracted.when) : null,
              whereCtx: extracted.where,
              why: extracted.why,
              how: extracted.how,
              topics: extracted.topics,
              extractedAt: new Date(),
            },
          });

          // Store entities if any
          if (extracted.entities && extracted.entities.length > 0) {
            await this.storeEntities(memory.userId, memory.id, extracted.entities);
          }

          console.log(`${progress} Updated ${memory.id}: who="${extracted.who}", what="${extracted.what?.substring(0, 50)}..."`);
          details.push({
            memoryId: memory.id,
            status: 'success',
            who: extracted.who,
            what: extracted.what,
          });
          processed++;
        }

        // Add delay between extractions to avoid rate limits
        if (delayMs > 0 && i < memories.length - 1) {
          await this.sleep(delayMs);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`${progress} Failed ${memory.id}: ${errorMessage}`);
        details.push({
          memoryId: memory.id,
          status: 'error',
          error: errorMessage,
        });
        errors++;
        // Continue with next memory - don't fail the whole batch
      }
    }

    console.log(`[Backfill] Complete: ${processed} processed, ${errors} errors, ${skipped} remaining`);

    return { processed, errors, skipped, total, details };
  }

  /**
   * Store extracted entities and link them to the memory
   * Copied from memory.service.ts to avoid circular dependency
   */
  private async storeEntities(
    userId: string,
    memoryId: string,
    entities: EntityWithType[],
  ): Promise<void> {
    for (const entity of entities) {
      try {
        const normalizedName = entity.name.toLowerCase().trim();

        const existingEntity = await this.prisma.entity.findUnique({
          where: {
            userId_normalizedName_type: {
              userId,
              normalizedName,
              type: entity.type,
            },
          },
        });

        let entityId: string;

        if (existingEntity) {
          entityId = existingEntity.id;
        } else {
          const newEntity = await this.prisma.entity.create({
            data: {
              userId,
              name: entity.name,
              normalizedName,
              type: entity.type,
            },
          });
          entityId = newEntity.id;
        }

        // Link entity to memory
        await this.prisma.memoryEntity.upsert({
          where: {
            memoryId_entityId: { memoryId, entityId },
          },
          create: { memoryId, entityId },
          update: {},
        });
      } catch (error) {
        console.error(`[Backfill] Failed to store entity ${entity.name}:`, error);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
