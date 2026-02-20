import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryService } from '../memory/memory.service';
import { AwarenessConfig } from './config/awareness.config';
import { MemorySignalService } from './signals/memory-signal.service';
import { GitHubSignalService } from './signals/github-signal.service';
import { LinearSignalService } from './signals/linear-signal.service';
import { PatternDetectorService } from './analysis/pattern-detector.service';
import { InsightGeneratorService, GeneratedInsight } from './analysis/insight-generator.service';
import { BehavioralConsistencyService } from './analysis/behavioral-consistency.service';
import { ProactiveNotificationService } from './proactive-notification.service';
import { InsightFeedbackService } from './insight-feedback.service';
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
 * Supports multi-tenant operation: cycles can be scoped per accountId.
 * The scheduled entry point iterates all accounts automatically.
 *
 * HEY-136: Enhanced with full metadata storage for insights
 * HEY-151: Integrates feedback loop for confidence adjustment
 * HEY-154: Triggers proactive notifications for high-confidence insights
 *
 * Respects resource budgets and can be fully disabled via config.
 */
@Injectable()
export class WakingCycleService {
  private readonly logger = new Logger(WakingCycleService.name);
  private running = false;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly memoryService: MemoryService,
    private readonly memorySignal: MemorySignalService,
    private readonly githubSignal: GitHubSignalService,
    private readonly linearSignal: LinearSignalService,
    private readonly patternDetector: PatternDetectorService,
    private readonly insightGenerator: InsightGeneratorService,
    private readonly behavioralConsistency: BehavioralConsistencyService,
    @Optional() private readonly proactiveNotification?: ProactiveNotificationService,
    @Optional() private readonly insightFeedback?: InsightFeedbackService,
  ) {}

  /**
   * Scheduled entry point. Runs a cycle for each account.
   */
  @Cron(AwarenessConfig.schedule)
  async runScheduled(): Promise<void> {
    if (!AwarenessConfig.enabled) return;

    // Multi-tenant: run a cycle for each account
    const accounts = await this.prisma.account.findMany({ select: { id: true } });
    for (const account of accounts) {
      await this.runCycle(account.id);
    }
  }

  /**
   * Run a single Waking Cycle. Can be called manually for testing.
   * @param accountId — scope cycle to a specific account (multi-tenant).
   *   If omitted, falls back to first account (legacy single-tenant).
   */
  async runCycle(accountId?: string): Promise<{
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
        this._execute(accountId),
        this.timeout(AwarenessConfig.cycleTimeoutMs),
      ]);
      this.clearTimeout();

      const durationMs = Date.now() - startTime;
      this.logger.log(
        `Waking Cycle complete: ${result.observations} observations, ` +
        `${result.patterns} patterns, ${result.insights} insights ` +
        `(${durationMs}ms)`,
      );

      return { ...result, durationMs };
    } catch (error) {
      this.clearTimeout();
      this.logger.error(`Waking Cycle failed: ${error.message}`, error.stack);
      return { observations: 0, patterns: 0, insights: 0, durationMs: Date.now() - startTime };
    } finally {
      this.running = false;
    }
  }

  /**
   * Execute the full cycle pipeline: collect → detect → generate → store.
   * @param accountId — if provided, scope to this account; otherwise use first account (legacy).
   */
  private async _execute(accountId?: string): Promise<{
    observations: number;
    patterns: number;
    insights: number;
  }> {
    // ── 0. Resolve account ────────────────────────────────────────────
    const resolvedAccountId = accountId
      ?? (await this.prisma.account.findFirst())?.id;
    if (!resolvedAccountId) {
      this.logger.warn('No account found — cannot run waking cycle');
      return { observations: 0, patterns: 0, insights: 0 };
    }

    // ── 1. Load checkpoints ───────────────────────────────────────────
    const checkpoints = await this.loadCheckpoints(resolvedAccountId);

    // ── 2. Collect signals ────────────────────────────────────────────
    const allObservations: Observation[] = [];

    const memoryResult = await this.memorySignal.collect(
      checkpoints.get('memory') || null,
      { maxQueries: Math.floor(AwarenessConfig.maxDbQueries * 0.6) },
    );
    allObservations.push(...memoryResult.observations);
    await this.saveCheckpoint(resolvedAccountId, 'memory', memoryResult.checkpoint);

    const githubResult = await this.githubSignal.collect(
      checkpoints.get('github') || null,
      { maxQueries: Math.floor(AwarenessConfig.maxDbQueries * 0.15) }, // 15% budget to GitHub
    );
    allObservations.push(...githubResult.observations);
    await this.saveCheckpoint(resolvedAccountId, 'github', githubResult.checkpoint);

    // Linear signal (optional — collects if configured)
    const linearResult = await this.linearSignal.collect(
      checkpoints.get('linear') || null,
      { maxQueries: Math.floor(AwarenessConfig.maxDbQueries * 0.15) }, // 15% budget to Linear
    );
    allObservations.push(...linearResult.observations);
    await this.saveCheckpoint(resolvedAccountId, 'linear', linearResult.checkpoint);

    // ── 3. Detect patterns ────────────────────────────────────────────
    const patterns = this.patternDetector.detect(allObservations);

    // ── 4. Generate insights ──────────────────────────────────────────
    const insights = await this.insightGenerator.generate(patterns, {
      maxLlmCalls: AwarenessConfig.maxLlmCalls,
      maxInsights: AwarenessConfig.maxInsightsPerCycle,
    });

    // ── 5. Behavioral consistency check (HEY-175) ──────────────────
    try {
      const user = await this.prisma.user.findFirst();
      if (user) {
        const consistencyResult = await this.behavioralConsistency.check(
          user.id,
          { maxLlmCalls: Math.max(0, AwarenessConfig.maxLlmCalls - 1) },
        );
        for (const inconsistency of consistencyResult.inconsistencies) {
          insights.push({
            content: `[Behavioral Consistency] ${inconsistency.description}` +
              (inconsistency.suggestion ? ` — Suggestion: ${inconsistency.suggestion}` : ''),
            insightType: `consistency:${inconsistency.type}`,
            confidence: inconsistency.confidence,
            sourceMemoryIds: inconsistency.evidenceMemoryIds,
            signalSource: 'behavioral_consistency',
            actionable: inconsistency.severity !== 'low',
          });
        }
      }
    } catch (error) {
      this.logger.warn(`Behavioral consistency check failed: ${error.message}`);
    }

    // ── 6. Store insights as INSIGHT layer memories ───────────────────
    await this.storeInsights(resolvedAccountId, insights);

    return {
      observations: allObservations.length,
      patterns: patterns.length,
      insights: insights.length,
    };
  }

  /** Load signal source checkpoints for a specific account. */
  private async loadCheckpoints(accountId: string): Promise<Map<string, Record<string, unknown>>> {
    const states = await this.prisma.awarenessState.findMany({
      where: { accountId },
    });
    const map = new Map<string, Record<string, unknown>>();
    for (const state of states) {
      map.set(state.signalSource, (state.checkpoint as Record<string, unknown>) || {});
    }
    return map;
  }

  /** Persist a signal source checkpoint via upsert, scoped to account. */
  private async saveCheckpoint(
    accountId: string,
    signalSource: string,
    checkpoint: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.awarenessState.upsert({
      where: {
        accountId_signalSource: {
          accountId,
          signalSource,
        },
      },
      update: {
        lastCheckedAt: new Date(),
        checkpoint: checkpoint as any,
      },
      create: {
        accountId,
        signalSource,
        lastCheckedAt: new Date(),
        checkpoint: checkpoint as any,
      },
    });
  }

  /**
   * Store generated insights as INSIGHT layer memories.
   *
   * HEY-136: Stores full insight metadata (type, sources, actionable, etc.)
   * HEY-151: Adjusts confidence based on feedback history for similar insight types
   * HEY-154: Triggers proactive notifications for high-confidence actionable insights
   */
  private async storeInsights(accountId: string, insights: GeneratedInsight[]): Promise<void> {
    if (insights.length === 0) return;

    // Find the first user belonging to this account
    const user = await this.prisma.user.findFirst({
      where: { agent: { accountId } },
    });
    if (!user) {
      this.logger.warn(`No user found for account ${accountId} — cannot store insights`);
      return;
    }

    for (const insight of insights) {
      try {
        // HEY-151: Adjust confidence based on feedback history
        let adjustedConfidence = insight.confidence;
        if (this.insightFeedback) {
          try {
            const stats = await this.insightFeedback.getFeedbackStats(
              user.id,
              insight.insightType,
            );
            if (stats.totalFeedback > 0) {
              adjustedConfidence = Math.max(0, Math.min(1,
                insight.confidence + stats.avgConfidenceAdjustment,
              ));
            }
          } catch (e) {
            this.logger.debug(`Feedback stats lookup failed: ${e.message}`);
          }
        }

        const stored = await this.memoryService.remember(user.id, {
          raw: insight.content,
          layer: 'INSIGHT',
          importanceHint: adjustedConfidence > 0.7 ? ImportanceHint.HIGH : ImportanceHint.MEDIUM,
          source: 'PATTERN_DETECTED',
        });

        // HEY-136: Store full insight metadata
        await this.prisma.memory.update({
          where: { id: stored.id },
          data: {
            confidence: adjustedConfidence,
            metadata: {
              insightType: insight.insightType,
              confidence: adjustedConfidence,
              sourceMemoryIds: insight.sourceMemoryIds,
              signalSource: insight.signalSource,
              actionable: insight.actionable,
              acknowledged: false,
              expiresAt: new Date(
                Date.now() + AwarenessConfig.insightTtlDays * 24 * 60 * 60 * 1000,
              ).toISOString(),
            },
          },
        });

        this.logger.log(
          `Stored insight: "${insight.content.slice(0, 80)}..." (confidence: ${adjustedConfidence.toFixed(2)})`,
        );
      } catch (error) {
        this.logger.debug(`Insight storage skipped/failed: ${error.message}`);
      }
    }

    // HEY-154: Trigger proactive notifications
    if (this.proactiveNotification) {
      try {
        const account = await this.prisma.account.findFirst();
        if (account) {
          await this.proactiveNotification.checkAndNotify(account.id);
        }
      } catch (error) {
        this.logger.warn(`Proactive notification check failed: ${error.message}`);
      }
    }
  }

  /** Returns a promise that rejects after `ms` milliseconds (cycle timeout). */
  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      this.timeoutHandle = setTimeout(
        () => reject(new Error(`Waking Cycle timed out after ${ms}ms`)),
        ms,
      );
    });
  }

  /** Clear the cycle timeout to prevent timer leaks. */
  private clearTimeout(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }
}
