import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConsolidationService } from '../memory/consolidation.service';
import { ImportanceScorerService } from '../memory/intelligence/importance-scorer.service';
import { EmbeddingService } from '../memory/embedding.service';
import { LLMService } from '../llm/llm.service';
import { ConfigService } from '@nestjs/config';

export type DreamCycleStage = 'dedup' | 'staleness' | 'patterns' | 'report';

export interface DreamCycleOptions {
  dryRun?: boolean;
  stages?: DreamCycleStage[];
  userId?: string;
  maxMemories?: number;
}

export interface DreamCycleResult {
  id: string;
  status: 'COMPLETED' | 'FAILED' | 'DRY_RUN';
  durationMs: number;
  scoresRefreshed: number;
  duplicatesMerged: number;
  patternsCreated: number;
  memoriesArchived: number;
  totalActive: number;
  avgEffectiveScore: number;
  stageDetails: Record<string, any>;
  errors: string[];
}

const ALL_STAGES: DreamCycleStage[] = ['dedup', 'staleness', 'patterns', 'report'];

@Injectable()
export class DreamCycleService {
  private readonly dedupThreshold: number;
  private readonly stalenessScoreThreshold: number;
  private readonly stalenessAgeDays: number;
  private readonly maxMergesPerRun: number;
  private readonly maxArchivalsPerRun: number;
  private readonly maxLlmCalls: number;
  private readonly patternClusterMinSize: number;

  constructor(
    private prisma: PrismaService,
    private consolidation: ConsolidationService,
    private scorer: ImportanceScorerService,
    private embedding: EmbeddingService,
    private llm: LLMService,
    private config: ConfigService,
  ) {
    this.dedupThreshold = parseFloat(this.config.get('DREAM_DEDUP_THRESHOLD') ?? '0.85');
    this.stalenessScoreThreshold = parseFloat(this.config.get('DREAM_STALENESS_SCORE') ?? '0.3');
    this.stalenessAgeDays = parseInt(this.config.get('DREAM_STALENESS_DAYS') ?? '30', 10);
    this.maxMergesPerRun = parseInt(this.config.get('DREAM_MAX_MERGES') ?? '200', 10);
    this.maxArchivalsPerRun = parseInt(this.config.get('DREAM_MAX_ARCHIVALS') ?? '50', 10);
    this.maxLlmCalls = parseInt(this.config.get('DREAM_MAX_LLM_CALLS') ?? '100', 10);
    this.patternClusterMinSize = parseInt(this.config.get('DREAM_PATTERN_MIN_CLUSTER') ?? '3', 10);
  }

  async run(options: DreamCycleOptions = {}): Promise<DreamCycleResult> {
    const {
      dryRun = false,
      stages = ALL_STAGES,
      maxMemories,
    } = options;

    const userId = options.userId || this.config.get<string>('DEFAULT_USER_ID') || 'default';
    const startTime = Date.now();
    const stageDetails: Record<string, any> = {};
    const errors: string[] = [];
    let scoresRefreshed = 0;
    let duplicatesMerged = 0;
    let patternsCreated = 0;
    let memoriesArchived = 0;
    let llmCallsUsed = 0;

    // Create report record
    const report = await this.prisma.dreamCycleReport.create({
      data: {
        userId,
        startedAt: new Date(),
        dryRun,
        status: 'RUNNING',
      },
    });

    // Create consolidation job for tracking
    const job = await this.prisma.consolidationJob.create({
      data: {
        userId,
        type: 'NIGHTLY',
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });

    this.log('Starting Dream Cycle', { userId, dryRun, stages, reportId: report.id });

    try {
      // Stage 1: Semantic dedup
      if (stages.includes('dedup')) {
        this.log('Stage 1: Semantic dedup scan');
        try {
          const dedupResult = await this.runDedupStage(userId, dryRun, maxMemories);
          duplicatesMerged = dedupResult.merged;
          llmCallsUsed += dedupResult.llmCalls;
          stageDetails.dedup = dedupResult;
          this.log('Stage 1 complete', dedupResult);
        } catch (err) {
          const msg = `Dedup stage failed: ${err instanceof Error ? err.message : String(err)}`;
          errors.push(msg);
          this.log(msg, undefined, 'error');
        }
      }

      // Stage 2: Staleness pruning
      if (stages.includes('staleness')) {
        this.log('Stage 2: Staleness pruning');
        try {
          const pruneResult = await this.runStalenessStage(userId, dryRun);
          memoriesArchived = pruneResult.archived;
          scoresRefreshed = pruneResult.scoresRefreshed;
          stageDetails.staleness = pruneResult;
          this.log('Stage 2 complete', pruneResult);
        } catch (err) {
          const msg = `Staleness stage failed: ${err instanceof Error ? err.message : String(err)}`;
          errors.push(msg);
          this.log(msg, undefined, 'error');
        }
      }

      // Stage 3: Pattern extraction
      if (stages.includes('patterns') && llmCallsUsed < this.maxLlmCalls) {
        this.log('Stage 3: Pattern extraction');
        try {
          const patternResult = await this.runPatternStage(
            userId,
            dryRun,
            this.maxLlmCalls - llmCallsUsed,
          );
          patternsCreated = patternResult.patternsCreated;
          llmCallsUsed += patternResult.llmCalls;
          stageDetails.patterns = patternResult;
          this.log('Stage 3 complete', patternResult);
        } catch (err) {
          const msg = `Pattern stage failed: ${err instanceof Error ? err.message : String(err)}`;
          errors.push(msg);
          this.log(msg, undefined, 'error');
        }
      }

      // Stage 4: Generate report
      if (stages.includes('report')) {
        this.log('Stage 4: Generating consolidation report');
        const totalActive = await this.prisma.memory.count({
          where: { userId, deletedAt: null },
        });
        const avgResult = await this.prisma.memory.aggregate({
          where: { userId, deletedAt: null },
          _avg: { effectiveScore: true },
        });
        stageDetails.report = {
          totalActive,
          avgEffectiveScore: avgResult._avg.effectiveScore ?? 0,
        };
      }

      const durationMs = Date.now() - startTime;
      const totalActive = stageDetails.report?.totalActive ?? 0;
      const avgEffectiveScore = stageDetails.report?.avgEffectiveScore ?? 0;
      const status = dryRun ? 'DRY_RUN' : errors.length > 0 ? 'COMPLETED' : 'COMPLETED';

      // Update report
      await this.prisma.dreamCycleReport.update({
        where: { id: report.id },
        data: {
          completedAt: new Date(),
          durationMs,
          scoresRefreshed,
          duplicatesMerged,
          patternsCreated,
          memoriesArchived,
          totalActive,
          avgEffectiveScore,
          stageDetails,
          errors,
          status: dryRun ? 'DRY_RUN' : 'COMPLETED',
        },
      });

      // Update consolidation job
      await this.prisma.consolidationJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          memoriesProcessed: scoresRefreshed + duplicatesMerged + memoriesArchived,
          patternsDetected: patternsCreated,
          memoriesMerged: duplicatesMerged,
        },
      });

      this.log('Dream Cycle complete', {
        durationMs,
        scoresRefreshed,
        duplicatesMerged,
        patternsCreated,
        memoriesArchived,
        errors: errors.length,
      });

      return {
        id: report.id,
        status,
        durationMs,
        scoresRefreshed,
        duplicatesMerged,
        patternsCreated,
        memoriesArchived,
        totalActive,
        avgEffectiveScore,
        stageDetails,
        errors,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.prisma.dreamCycleReport.update({
        where: { id: report.id },
        data: { status: 'FAILED', errors: [...errors, msg], completedAt: new Date() },
      });
      await this.prisma.consolidationJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', error: msg, completedAt: new Date() },
      });
      throw err;
    }
  }

  // ─── Stage 1: Semantic Dedup ───────────────────────────────────────

  private async runDedupStage(
    userId: string,
    dryRun: boolean,
    maxMemories?: number,
  ): Promise<{ merged: number; flagged: number; scanned: number; llmCalls: number }> {
    let merged = 0;
    let flagged = 0;
    let llmCalls = 0;

    // Fetch active memories with embeddings
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

    // Use pgvector to find similar pairs efficiently
    const processed = new Set<string>();

    for (const memory of memories) {
      if (processed.has(memory.id)) continue;
      if (merged >= this.maxMergesPerRun) break;

      // Find similar memories using stored embeddings
      let embedding: number[];
      try {
        const raw = await this.prisma.$queryRawUnsafe<Array<{ embedding: string }>>(
          `SELECT embedding::text FROM memories WHERE id = $1 AND embedding IS NOT NULL`,
          memory.id,
        );
        if (!raw.length || !raw[0].embedding) continue;
        embedding = JSON.parse(raw[0].embedding);
      } catch {
        continue;
      }

      const similar = await this.embedding.search(userId, embedding, 10);

      // Find matches above threshold that are in our active set
      const memoryIds = new Set(memories.map(m => m.id));
      const matches = similar.filter(
        s => s.id !== memory.id &&
             memoryIds.has(s.id) &&
             !processed.has(s.id) &&
             s.score >= this.dedupThreshold,
      );

      if (matches.length === 0) continue;

      // Determine auto-merge threshold based on memory types
      const isProtected = memory.memoryType === 'CONSTRAINT' || memory.memoryType === 'LESSON';
      const autoMergeThreshold = isProtected ? 0.98 : 0.95;

      for (const match of matches) {
        if (merged >= this.maxMergesPerRun) break;

        const matchMemory = memories.find(m => m.id === match.id)!;
        const matchIsProtected = matchMemory.memoryType === 'CONSTRAINT' || matchMemory.memoryType === 'LESSON';

        if (match.score >= autoMergeThreshold && !matchIsProtected) {
          // Auto-merge: high confidence
          if (!dryRun) {
            await this.mergeMemories(memory, matchMemory);
          }
          processed.add(match.id);
          merged++;
        } else if (match.score >= this.dedupThreshold && llmCalls < this.maxLlmCalls) {
          // LLM-assisted merge decision
          const shouldMerge = await this.llmMergeDecision(memory.raw, matchMemory.raw);
          llmCalls++;

          if (shouldMerge) {
            if (!dryRun) {
              await this.mergeMemories(memory, matchMemory);
            }
            processed.add(match.id);
            merged++;
          } else {
            // Flag as candidate for review
            if (!dryRun) {
              await this.prisma.mergeCandidate.create({
                data: {
                  userId,
                  memoryIds: [memory.id, match.id],
                  similarity: match.score,
                  suggestedStrategy: 'KEEP_DETAILED',
                  suggestedSurvivorId: memory.effectiveScore >= matchMemory.effectiveScore ? memory.id : match.id,
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
    survivor: { id: string; raw: string; importanceScore: number; effectiveScore: number },
    absorbed: { id: string; raw: string; importanceScore: number; effectiveScore: number },
  ): Promise<void> {
    // Pick the one with higher effective score as survivor
    let [surv, abs] = survivor.effectiveScore >= absorbed.effectiveScore
      ? [survivor, absorbed]
      : [absorbed, survivor];

    const survivorMemory = await this.prisma.memory.findUnique({ where: { id: surv.id }, select: { userId: true } });

    // Create merge event for rollback
    await this.prisma.memoryMergeEvent.create({
      data: {
        userId: survivorMemory!.userId,
        survivorMemoryId: surv.id,
        absorbedMemoryIds: [abs.id],
        strategy: 'DREAM_CYCLE_AUTO',
        similarity: 0,
        triggeredBy: 'batch',
        originalContents: JSON.stringify({ survivor: surv.raw, absorbed: abs.raw }),
        mergedContent: surv.raw,
        canRollback: true,
      },
    });

    // Soft-delete the absorbed memory
    await this.prisma.memory.update({
      where: { id: abs.id },
      data: {
        consolidatedInto: surv.id,
        deletedAt: new Date(),
        lastDreamCycleAt: new Date(),
      },
    });

    // Update survivor's timestamp
    await this.prisma.memory.update({
      where: { id: surv.id },
      data: { lastDreamCycleAt: new Date() },
    });
  }

  private async llmMergeDecision(contentA: string, contentB: string): Promise<boolean> {
    try {
      const result = await this.llm.json<{ shouldMerge: boolean; reason: string }>(
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
      return false; // Fail safe: don't merge
    }
  }

  // ─── Stage 2: Staleness Pruning ────────────────────────────────────

  private async runStalenessStage(
    userId: string,
    dryRun: boolean,
  ): Promise<{ archived: number; scoresRefreshed: number; candidates: number }> {
    let archived = 0;
    let scoresRefreshed = 0;

    // First refresh effective scores
    const activeMemories = await this.prisma.memory.findMany({
      where: { userId, deletedAt: null },
    });

    const now = new Date();
    const cutoffDate = new Date(now.getTime() - this.stalenessAgeDays * 24 * 60 * 60 * 1000);

    // Refresh scores
    for (const memory of activeMemories) {
      const scoreComponents = this.scorer.computeScore(memory, now);
      if (Math.abs(scoreComponents.effectiveScore - memory.effectiveScore) > 0.01) {
        if (!dryRun) {
          await this.prisma.memory.update({
            where: { id: memory.id },
            data: {
              effectiveScore: scoreComponents.effectiveScore,
              scoreComputedAt: now,
            },
          });
        }
        scoresRefreshed++;
      }
    }

    // Find stale memories
    const staleMemories = activeMemories.filter(m => {
      // Protected types are never auto-archived
      if (m.userPinned || m.safetyCritical) return false;
      if (m.memoryType === 'CONSTRAINT' || m.memoryType === 'LESSON') return false;

      const score = this.scorer.computeScore(m, now);
      if (score.effectiveScore >= this.stalenessScoreThreshold) return false;

      // Must be old enough
      if (m.createdAt > cutoffDate) return false;

      // Must not have been accessed recently
      const lastAccess = m.lastRetrievedAt || m.lastUsedAt;
      if (lastAccess && lastAccess > cutoffDate) return false;

      // Must have low usage
      const totalUsage = (m.retrievalCount ?? 0) + (m.usedCount ?? 0);
      if (totalUsage >= 3) return false;

      return true;
    });

    const candidates = staleMemories.length;

    // Archive up to max
    const toArchive = staleMemories.slice(0, this.maxArchivalsPerRun);
    for (const memory of toArchive) {
      if (!dryRun) {
        await this.prisma.memory.update({
          where: { id: memory.id },
          data: {
            deletedAt: now,
            archivedReason: 'staleness_pruning',
            lastDreamCycleAt: now,
          },
        });
      }
      archived++;
    }

    return { archived, scoresRefreshed, candidates };
  }

  // ─── Stage 3: Pattern Extraction ──────────────────────────────────

  private async runPatternStage(
    userId: string,
    dryRun: boolean,
    remainingLlmBudget: number,
  ): Promise<{ patternsCreated: number; clustersFound: number; llmCalls: number }> {
    let patternsCreated = 0;
    let llmCalls = 0;

    // Use existing consolidation service to find clusters
    const result = await this.consolidation.promoteRecurringPatterns(userId, {
      dryRun: true, // Always dry-run first to get clusters
      minOccurrences: this.patternClusterMinSize,
      similarityThreshold: 0.65,
    });

    const clustersFound = result.clustersFound;

    if (clustersFound === 0 || remainingLlmBudget <= 0) {
      return { patternsCreated: 0, clustersFound, llmCalls: 0 };
    }

    // For each cluster, extract a pattern summary
    for (const detail of result.details) {
      if (llmCalls >= remainingLlmBudget) break;

      // Fetch the actual memory contents
      const memories = await this.prisma.memory.findMany({
        where: { id: { in: [detail.canonicalId, ...detail.duplicateIds] }, deletedAt: null },
        select: { id: true, raw: true },
      });

      if (memories.length < this.patternClusterMinSize) continue;

      // Check if a pattern for these memories already exists
      const existingPattern = await this.prisma.memory.findFirst({
        where: {
          userId,
          source: 'PATTERN_DETECTED',
          deletedAt: null,
          patternSourceIds: { hasSome: memories.map(m => m.id) },
        },
      });

      if (existingPattern) continue;

      // Extract pattern via LLM
      const memoriesText = memories.map((m, i) => `${i + 1}. ${m.raw}`).join('\n');
      try {
        const pattern = await this.llm.json<{ summary: string; confidence: number }>(
          [
            {
              role: 'system',
              content: `You are analyzing a cluster of related memories to extract a higher-order pattern or insight. Identify what these memories collectively reveal about the user's behavior, preferences, or situation. Write a single concise statement. Respond with JSON: { "summary": "pattern statement", "confidence": 0.0-1.0 }`,
            },
            {
              role: 'user',
              content: `Memories:\n${memoriesText}`,
            },
          ],
          undefined,
          { temperature: 0.3 },
        );
        llmCalls++;

        if (pattern.summary && pattern.confidence >= 0.6) {
          if (!dryRun) {
            // Create the pattern memory
            await this.prisma.memory.create({
              data: {
                userId,
                raw: pattern.summary,
                layer: 'IDENTITY',
                source: 'PATTERN_DETECTED',
                memoryType: 'FACT',
                importanceScore: Math.min(0.9, 0.5 + (memories.length * 0.05)),
                effectiveScore: Math.min(0.9, 0.5 + (memories.length * 0.05)),
                confidence: pattern.confidence,
                patternSourceIds: memories.map(m => m.id),
                lastDreamCycleAt: new Date(),
              },
            });

            // Create chain links from source memories
            const patternMemory = await this.prisma.memory.findFirst({
              where: { userId, raw: pattern.summary, source: 'PATTERN_DETECTED' },
              select: { id: true },
            });

            if (patternMemory) {
              for (const mem of memories) {
                await this.prisma.memoryChainLink.create({
                  data: {
                    sourceId: mem.id,
                    targetId: patternMemory.id,
                    linkType: 'SUPPORTS',
                    confidence: pattern.confidence,
                    createdBy: 'dream-cycle',
                  },
                }).catch(() => {}); // Ignore if link already exists
              }
            }
          }
          patternsCreated++;
        }
      } catch (err) {
        this.log(`Pattern extraction failed for cluster`, { error: String(err) }, 'error');
      }
    }

    return { patternsCreated, clustersFound, llmCalls };
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private log(message: string, data?: any, level: 'log' | 'error' = 'log'): void {
    const fn = level === 'error' ? console.error : console.log;
    fn(`[DreamCycle] ${message}`, data ? JSON.stringify(data) : '');
  }
}
