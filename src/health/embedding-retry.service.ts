import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EmbedHealthService } from './embed-health.service';
import { EmbeddingService } from '../memory/embedding.service';

/**
 * Background service that retries embedding generation for memories
 * that were created without embeddings (due to engram-embed being down).
 * 
 * Runs every 5 minutes. Only attempts if engram-embed is available.
 */
@Injectable()
export class EmbeddingRetryService {
  private readonly logger = new Logger(EmbeddingRetryService.name);
  private readonly batchSize = 20;

  constructor(
    private prisma: PrismaService,
    private embedHealth: EmbedHealthService,
    private embeddingService: EmbeddingService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async retryPendingEmbeddings(): Promise<void> {
    // Only attempt if embed is available
    const available = await this.embedHealth.isAvailable();
    if (!available) return;

    // Find memories without embeddings
    const pending = await this.prisma.memory.findMany({
      where: {
        embeddingId: null,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      take: this.batchSize,
      select: { id: true, raw: true, userId: true, layer: true, importanceScore: true },
    });

    if (pending.length === 0) return;

    this.logger.log(`Retrying embeddings for ${pending.length} memories`);
    let success = 0;
    let failed = 0;

    for (const memory of pending) {
      try {
        const embedding = await this.embeddingService.generate(memory.raw);
        const embeddingId = await this.embeddingService.store(memory.id, embedding, {
          userId: memory.userId,
          layer: memory.layer,
          importance: memory.importanceScore,
        });

        await this.prisma.memory.update({
          where: { id: memory.id },
          data: { embeddingId },
        });

        success++;
      } catch (err) {
        failed++;
        if (failed >= 3) {
          // If multiple failures, embed is probably down again — stop trying
          this.logger.warn(`Embedding retry: ${failed} failures, stopping batch`);
          break;
        }
      }
    }

    if (success > 0) {
      this.logger.log(`Embedding retry complete: ${success} succeeded, ${failed} failed`);
    }
  }
}
