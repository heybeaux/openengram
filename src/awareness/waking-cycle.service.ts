import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryService } from '../memory/memory.service';
import { AwarenessConfig } from './config/awareness.config';
import { MemorySignalService } from './signals/memory-signal.service';
import { GitHubSignalService } from './signals/github-signal.service';
import { PatternDetectorService } from './analysis/pattern-detector.service';
import { InsightGeneratorService, GeneratedInsight } from './analysis/insight-generator.service';
import { Observation } from './signals/signal.interface';
import { ImportanceHint } from '@prisma/client';

/**
 * Waking Cycle — the core orchestrator for the Awareness module.
 *
 * Runs on a configurable schedule and:
 * 1. Collects observations from signal sources
 * 2. Detects patterns across observations + existing memories
 * 3. Generates insights (INSIGHT layer memories)
 * 4. Stores them via the standard memory pipeline
 *
 * Respects resource budgets and can be fully disabled via config.
 */
@Injectable()
export class WakingCycleService {
  private readonly logger = new Logger(WakingCycleService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly memoryService: MemoryService,
    private readonly memorySignal: MemorySignalService,
    private readonly githubSignal: GitHubSignalService,
    private readonly patternDetector: PatternDetectorService,
    private readonly insightGenerator: InsightGeneratorService,
  ) {}

  /**
   * Scheduled entry point. Decorating with @Cron here for discoverability,
   * but the actual schedule is controlled via AwarenessConfig.
   */
  @Cron(AwarenessConfig.schedule)
  async runScheduled(): Promise<void> {
    if (!AwarenessConfig.enabled) return;
    await this.runCycle();
  }

  /**
   * Run a single Waking Cycle. Can be called manually for testing.
   */
  async runCycle(): Promise<{
    observations: number;
    patterns: number;
    insights: number;
    durationMs: number;
  }> {
    if (this.running) {
      this.logger.warn('Waking Cycle already running — skipping');
      return { observations: 0, patterns: 0, insights: 0, durationMs: 0 };
    }

    this.running = true;
    const startTime = Date.now();

    try {
      this.logger.log('Waking Cycle starting...');

      // Apply timeout
      const result = await Promise.race([
        this._execute(),
        this.timeout(AwarenessConfig.cycleTimeoutMs),
      ]);

      const durationMs = Date.now() - startTime;
      this.logger.log(
        `Waking Cycle complete: ${result.observations} observations, ` +
        `${result.patterns} patterns, ${result.insights} insights ` +
        `(${durationMs}ms)`,
      );

      return { ...result, durationMs };
    } catch (error) {
      this.logger.error(`Waking Cycle failed: ${error.message}`, error.stack);
      return { observations: 0, patterns: 0, insights: 0, durationMs: Date.now() - startTime };
    } finally {
      this.running = false;
    }
  }

  /** Execute the full cycle pipeline: collect → detect → generate → store. */
  private async _execute(): Promise<{
    observations: number;
    patterns: number;
    insights: number;
  }> {
    // ── 1. Load checkpoints ───────────────────────────────────────────
    const checkpoints = await this.loadCheckpoints();

    // ── 2. Collect signals ────────────────────────────────────────────
    const allObservations: Observation[] = [];

    const memoryResult = await this.memorySignal.collect(
      checkpoints.get('memory') || null,
      { maxQueries: Math.floor(AwarenessConfig.maxDbQueries * 0.6) }, // 60% budget to memory signal
    );
    allObservations.push(...memoryResult.observations);
    await this.saveCheckpoint('memory', memoryResult.checkpoint);

    // GitHub signal (optional — collects if configured)
    const githubResult = await this.githubSignal.collect(
      checkpoints.get('github') || null,
      { maxQueries: Math.floor(AwarenessConfig.maxDbQueries * 0.3) }, // 30% budget to GitHub
    );
    allObservations.push(...githubResult.observations);
    await this.saveCheckpoint('github', githubResult.checkpoint);

    // ── 3. Detect patterns ────────────────────────────────────────────
    const patterns = this.patternDetector.detect(allObservations);

    // ── 4. Generate insights ──────────────────────────────────────────
    const insights = await this.insightGenerator.generate(patterns, {
      maxLlmCalls: AwarenessConfig.maxLlmCalls,
      maxInsights: AwarenessConfig.maxInsightsPerCycle,
    });

    // ── 5. Store insights as INSIGHT layer memories ───────────────────
    await this.storeInsights(insights);

    return {
      observations: allObservations.length,
      patterns: patterns.length,
      insights: insights.length,
    };
  }

  /** Load all signal source checkpoints from the database. */
  private async loadCheckpoints(): Promise<Map<string, Record<string, unknown>>> {
    const states = await this.prisma.awarenessState.findMany();
    const map = new Map<string, Record<string, unknown>>();
    for (const state of states) {
      map.set(state.signalSource, (state.checkpoint as Record<string, unknown>) || {});
    }
    return map;
  }

  /** Persist a signal source checkpoint via upsert. */
  private async saveCheckpoint(
    signalSource: string,
    checkpoint: Record<string, unknown>,
  ): Promise<void> {
    // We need an accountId — for MVP, use the first account
    // TODO: Make this multi-tenant aware
    const account = await this.prisma.account.findFirst();
    if (!account) {
      this.logger.warn('No account found — cannot save checkpoint');
      return;
    }

    await this.prisma.awarenessState.upsert({
      where: {
        accountId_signalSource: {
          accountId: account.id,
          signalSource,
        },
      },
      update: {
        lastCheckedAt: new Date(),
        checkpoint: checkpoint as any,
      },
      create: {
        accountId: account.id,
        signalSource,
        lastCheckedAt: new Date(),
        checkpoint: checkpoint as any,
      },
    });
  }

  /**
   * Store generated insights as INSIGHT layer memories via the standard
   * memory pipeline (MemoryService.remember). This ensures insights get:
   * - Full embedding generation (required for active surfacing in recall)
   * - Entity extraction and knowledge graph integration
   * - Three-tier dedup (replaces our manual exact-match check)
   * - Event emission (memory.created)
   */
  private async storeInsights(insights: GeneratedInsight[]): Promise<void> {
    if (insights.length === 0) return;

    // Find a default user for storing insights
    // TODO: Make this configurable / multi-tenant
    const user = await this.prisma.user.findFirst();
    if (!user) {
      this.logger.warn('No user found — cannot store insights');
      return;
    }

    for (const insight of insights) {
      try {
        await this.memoryService.remember(user.id, {
          raw: insight.content,
          layer: 'INSIGHT',
          importanceHint: insight.confidence > 0.7 ? ImportanceHint.HIGH : ImportanceHint.MEDIUM,
          source: 'PATTERN_DETECTED',
          // TODO: Pass patternSourceIds once metadata JSON column is available
        });

        this.logger.log(`Stored insight: "${insight.content.slice(0, 80)}..." (confidence: ${insight.confidence})`);
      } catch (error) {
        // Dedup rejections are expected — the pipeline's three-tier dedup
        // handles exact matches, semantic matches, and reinforcement
        this.logger.debug(`Insight storage skipped/failed: ${error.message}`);
      }
    }
  }

  /** Returns a promise that rejects after `ms` milliseconds (cycle timeout). */
  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Waking Cycle timed out after ${ms}ms`)), ms),
    );
  }
}
