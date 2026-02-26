import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingService } from '../../memory/embedding.service';
import { LLMService } from '../../llm/llm.service';

export interface DedupStageResult {
  merged: number;
  flagged: number;
  scanned: number;
  llmCalls: number;
}

@Injectable()
export class DreamCycleDedupStage {
  private readonly dedupThreshold: number;
  private readonly maxMergesPerRun: number;
  private readonly maxLlmCalls: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
    private readonly llm: LLMService,
    private readonly config: ConfigService,
  ) {
    this.dedupThreshold = parseFloat(
      this.config.get('DREAM_DEDUP_THRESHOLD') ?? '0.85',
    );
    this.maxMergesPerRun = parseInt(
      this.config.get('DREAM_MAX_MERGES') ?? '200',
      10,
    );
    this.maxLlmCalls = parseInt(
      this.config.get('DREAM_MAX_LLM_CALLS') ?? '50',
      10,
    );
  }

  async run(
    userId: string,
    dryRun: boolean,
    maxMemories?: number,
  ): Promise<DedupStageResult> {
    let merged = 0;
    let flagged = 0;
    let llmCalls = 0;

    const memories = await this.prisma.memory.findMany({
      where: {
        userId,
        deletedAt: null,
        consolidatedInto: null,
      },
      select: {
        id: true,
        raw: true,
        memoryType: true,
        importanceScore: true,
        effectiveScore: true,
        createdAt: true,
        layer: true,
      },
      orderBy: { createdAt: 'desc' },
      take: maxMemories ?? 500,
    });

    const scanned = memories.length;
    if (scanned < 2) return { merged: 0, flagged: 0, scanned, llmCalls: 0 };

    const processed = new Set<string>();

    for (const memory of memories) {
      if (processed.has(memory.id)) continue;
      if (merged >= this.maxMergesPerRun) break;

      let embedding: number[];
      try {
        const raw = await this.prisma.$queryRawUnsafe<
          Array<{ embedding: string }>
        >(
          `SELECT embedding::text FROM memory_embeddings WHERE memory_id = $1 AND embedding IS NOT NULL LIMIT 1`,
          memory.id,
        );
        if (!raw.length || !raw[0].embedding) continue;
        embedding = JSON.parse(raw[0].embedding);
      } catch {
        continue;
      }

      const similar = await this.embedding.search(userId, embedding, 10);

      const memoryIds = new Set(memories.map((m) => m.id));
      const matches = similar.filter(
        (s) =>
          s.id !== memory.id &&
          memoryIds.has(s.id) &&
          !processed.has(s.id) &&
          s.score >= this.dedupThreshold,
      );

      if (matches.length === 0) continue;

      const isProtected =
        memory.memoryType === 'CONSTRAINT' || memory.memoryType === 'LESSON';
      const autoMergeThreshold = isProtected ? 0.95 : 0.88;

      for (const match of matches) {
        if (merged >= this.maxMergesPerRun) break;

        const matchMemory = memories.find((m) => m.id === match.id)!;
        const matchIsProtected =
          matchMemory.memoryType === 'CONSTRAINT' ||
          matchMemory.memoryType === 'LESSON';

        if (match.score >= autoMergeThreshold && !matchIsProtected) {
          if (!dryRun) {
            await this.mergeMemories(memory, matchMemory);
          }
          processed.add(match.id);
          merged++;
        } else if (
          match.score >= this.dedupThreshold &&
          llmCalls < this.maxLlmCalls
        ) {
          const shouldMerge = await this.llmMergeDecision(
            memory.raw,
            matchMemory.raw,
          );
          llmCalls++;

          if (shouldMerge) {
            if (!dryRun) {
              await this.mergeMemories(memory, matchMemory);
            }
            processed.add(match.id);
            merged++;
          } else {
            if (!dryRun) {
              await this.prisma.mergeCandidate.create({
                data: {
                  userId,
                  memoryIds: [memory.id, match.id],
                  similarity: match.score,
                  suggestedStrategy: 'KEEP_DETAILED',
                  suggestedSurvivorId:
                    memory.effectiveScore >= matchMemory.effectiveScore
                      ? memory.id
                      : match.id,
                  status: 'PENDING',
                  reviewNotes: 'Dream Cycle: LLM declined auto-merge',
                },
              });
            }
            flagged++;
          }
        }
      }

      processed.add(memory.id);
    }

    return { merged, flagged, scanned, llmCalls };
  }

  private async mergeMemories(
    survivor: {
      id: string;
      raw: string;
      importanceScore: number;
      effectiveScore: number;
    },
    absorbed: {
      id: string;
      raw: string;
      importanceScore: number;
      effectiveScore: number;
    },
  ): Promise<void> {
    const [surv, abs] =
      survivor.effectiveScore >= absorbed.effectiveScore
        ? [survivor, absorbed]
        : [absorbed, survivor];

    const survivorMemory = await this.prisma.memory.findUnique({
      where: { id: surv.id },
      select: { userId: true },
    });

    await this.prisma.memoryMergeEvent.create({
      data: {
        userId: survivorMemory!.userId,
        survivorMemoryId: surv.id,
        absorbedMemoryIds: [abs.id],
        strategy: 'DREAM_CYCLE_AUTO',
        similarity: 0,
        triggeredBy: 'batch',
        originalContents: JSON.stringify({
          survivor: surv.raw,
          absorbed: abs.raw,
        }),
        mergedContent: surv.raw,
        canRollback: true,
      },
    });

    await this.prisma.memory.update({
      where: { id: abs.id },
      data: {
        consolidatedInto: surv.id,
        deletedAt: new Date(),
        lastDreamCycleAt: new Date(),
      },
    });

    await this.prisma.memory.update({
      where: { id: surv.id },
      data: { lastDreamCycleAt: new Date() },
    });
  }

  private async llmMergeDecision(
    contentA: string,
    contentB: string,
  ): Promise<boolean> {
    try {
      const result = await this.llm.json<{
        shouldMerge: boolean;
        reason: string;
      }>(
        [
          {
            role: 'system',
            content: `You are evaluating whether two memories are semantically identical (same core fact, just different wording). Respond with JSON: { "shouldMerge": boolean, "reason": "brief explanation" }`,
          },
          {
            role: 'user',
            content: `Memory A: ${contentA}\n\nMemory B: ${contentB}\n\nAre these the same fact?`,
          },
        ],
        undefined,
        { temperature: 0.1 },
      );
      return result.shouldMerge ?? false;
    } catch {
      return false;
    }
  }
}
