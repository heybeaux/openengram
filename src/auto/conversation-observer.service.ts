import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryService } from '../memory/memory.service';
import { ImportanceDetectorService } from './importance-detector.service';
import { AutoExtractorService, ExtractorContext } from './auto-extractor.service';
import {
  ObserveDto,
  ObserveResult,
  ExtractedMemory,
  ImportanceSignal,
} from './dto/observe.dto';
import { MemoryLayer, MemorySource, ImportanceHint } from '@prisma/client';

export interface ObserveContext {
  userName?: string;
}

/**
 * ConversationObserver - Main service for auto-mode memory capture
 * 
 * Observes conversation turns, detects importance signals,
 * extracts memories, and stores them automatically.
 */
@Injectable()
export class ConversationObserverService {
  constructor(
    private prisma: PrismaService,
    private memoryService: MemoryService,
    private importanceDetector: ImportanceDetectorService,
    private autoExtractor: AutoExtractorService,
  ) {}

  /**
   * Observe conversation turns and extract/store memories
   * @param userId - The user ID to store memories for
   * @param dto - The conversation turns and options
   * @param context - Optional context including user name
   */
  async observe(
    userId: string, 
    dto: ObserveDto, 
    context?: ObserveContext,
  ): Promise<ObserveResult> {
    const startTime = Date.now();
    const minImportance = dto.minImportance ?? 0.4;

    // 1. Get user info for extraction context if not provided
    let userName = context?.userName;
    if (!userName) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { externalId: true },
      });
      userName = user?.externalId;
    }

    // 2. Build extraction context
    const extractorContext: ExtractorContext = { userName };

    // 3. Detect importance signals
    const signals = this.importanceDetector.detect(dto.turns);

    // 4. Extract memories from conversation with user context
    const extracted = await this.autoExtractor.extract(dto.turns, signals, extractorContext);

    // 5. Filter by importance threshold
    const toStore = extracted.filter(m => m.importance >= minImportance);
    const skipped = extracted.length - toStore.length;

    // 6. Store memories
    const created = await this.storeMemories(userId, toStore, dto);

    return {
      memories: extracted, // Return all for visibility
      created,
      skipped,
      signals,
      processingMs: Date.now() - startTime,
    };
  }

  /**
   * Store extracted memories via MemoryService
   * Includes source attribution (turn index, timestamp)
   */
  private async storeMemories(
    userId: string,
    memories: ExtractedMemory[],
    dto: ObserveDto,
  ): Promise<number> {
    let created = 0;

    for (const memory of memories) {
      try {
        // Get timestamp from the source turn if available
        const sourceTurn = dto.turns[memory.source.turnIndex];
        const sourceTimestamp = sourceTurn?.timestamp 
          ? new Date(sourceTurn.timestamp) 
          : undefined;

        await this.memoryService.remember(userId, {
          raw: memory.content,
          layer: this.determineLayer(memory),
          importanceHint: this.mapImportanceToHint(memory.importance),
          context: {
            projectId: dto.projectId,
            sessionId: dto.sessionId,
          },
          // Source attribution
          sourceTurnIndex: memory.source.turnIndex,
          sourceTimestamp,
        });
        created++;
      } catch (error) {
        console.error('Failed to store extracted memory:', error);
      }
    }

    return created;
  }

  /**
   * Determine appropriate memory layer based on content and signals
   */
  private determineLayer(memory: ExtractedMemory): MemoryLayer {
    const content = memory.content.toLowerCase();
    const signalTypes = memory.signals.map(s => s.type);

    // Identity layer: Core user facts, preferences, corrections about themselves
    if (
      signalTypes.includes('preference') ||
      /\b(i am|i'm|my name|i work|i live|i have)\b/.test(content) ||
      /\b(always|never|allergic|hate|love)\b/.test(content)
    ) {
      return MemoryLayer.IDENTITY;
    }

    // Project layer: Work-related, project mentions
    if (
      /\b(project|deadline|milestone|deploy|release|sprint)\b/.test(content) ||
      /\b(we're building|working on|developing)\b/.test(content)
    ) {
      return MemoryLayer.PROJECT;
    }

    // Default to session layer
    return MemoryLayer.SESSION;
  }

  /**
   * Map numeric importance (0-1) to ImportanceHint enum
   */
  private mapImportanceToHint(importance: number): ImportanceHint {
    if (importance >= 0.9) return ImportanceHint.CRITICAL;
    if (importance >= 0.7) return ImportanceHint.HIGH;
    if (importance >= 0.5) return ImportanceHint.MEDIUM;
    return ImportanceHint.LOW;
  }

  /**
   * Analyze signals without storing (for preview/debugging)
   */
  analyzeSignals(dto: ObserveDto): {
    signals: ImportanceSignal[];
    aggregateImportance: number;
  } {
    const signals = this.importanceDetector.detect(dto.turns);
    const aggregateImportance = this.importanceDetector.calculateImportance(signals);

    return {
      signals,
      aggregateImportance,
    };
  }
}
