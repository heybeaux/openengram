import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ContextualRecallService } from '../memory/contextual-recall.service';
import { RECALL_QUERIES, LATENCY_QUERIES, EvalQuery } from './eval-fixtures';

export interface EvalQueryResult {
  id: number;
  query: string;
  pass: boolean;
  recall: number;
  precision: number;
  latencyMs: number;
  fragmentsFound: string[];
  fragmentsMissed: string[];
}

export interface EvalRunResult {
  id: string;
  timestamp: Date;
  recallScore: number;
  recallTotal: number;
  recallPassed: number;
  latencyP50Ms: number;
  latencyP95Ms: number | null;
  contextGrade: string | null;
  triggeredBy: string | null;
  details: EvalQueryResult[];
}

export interface RegressionReport {
  hasRegression: boolean;
  latestRun: { recallScore: number; latencyP50Ms: number } | null;
  baseline: { avgRecallScore: number; avgLatencyP50Ms: number } | null;
  recallDelta: number | null;
  latencyDelta: number | null;
  flags: string[];
}

@Injectable()
export class EvalService {
  private readonly logger = new Logger(EvalService.name);
  private readonly userId: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly contextualRecall: ContextualRecallService,
    private readonly config: ConfigService,
  ) {
    this.userId = this.config.get<string>('EVAL_USER_ID', 'Beaux');
  }

  /**
   * Run the full eval suite: recall queries + latency measurement.
   */
  async runEval(triggeredBy: string = 'manual'): Promise<EvalRunResult> {
    this.logger.log(`Starting eval run (triggeredBy: ${triggeredBy})`);

    const queryResults: EvalQueryResult[] = [];
    const allLatencies: number[] = [];

    // Run recall queries
    for (const testCase of RECALL_QUERIES) {
      const result = await this.runSingleQuery(testCase);
      queryResults.push(result);
      allLatencies.push(result.latencyMs);
    }

    // Run additional latency-only queries
    for (const query of LATENCY_QUERIES) {
      const start = Date.now();
      try {
        await this.contextualRecall.recall(this.userId, {
          text: query,
          sessionKey: `eval-latency-${Date.now()}`,
        });
      } catch {
        // latency still counts even on error
      }
      allLatencies.push(Date.now() - start);
    }

    // Calculate metrics
    const recallTotal = queryResults.length;
    const recallPassed = queryResults.filter((r) => r.pass).length;
    const recallScore = recallTotal > 0 ? recallPassed / recallTotal : 0;

    allLatencies.sort((a, b) => a - b);
    const latencyP50Ms = this.percentile(allLatencies, 50);
    const latencyP95Ms = this.percentile(allLatencies, 95);

    // Grade based on F1 (using recall score as proxy since we track pass/fail)
    const contextGrade = this.gradeFromScore(recallScore);

    // Store in database
    const run = await this.prisma.evalRun.create({
      data: {
        recallScore: Math.round(recallScore * 1000) / 1000,
        recallTotal,
        recallPassed,
        latencyP50Ms,
        latencyP95Ms,
        contextGrade,
        triggeredBy,
        details: queryResults as any,
      },
    });

    this.logger.log(
      `Eval complete: ${recallPassed}/${recallTotal} passed (${contextGrade}), p50=${latencyP50Ms}ms, p95=${latencyP95Ms}ms`,
    );

    return {
      id: run.id,
      timestamp: run.timestamp,
      recallScore,
      recallTotal,
      recallPassed,
      latencyP50Ms,
      latencyP95Ms,
      contextGrade,
      triggeredBy,
      details: queryResults,
    };
  }

  /**
   * Get recent eval run history.
   */
  async getHistory(limit: number = 20) {
    return this.prisma.evalRun.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  /**
   * Detect regression by comparing latest run to average of last 3 runs.
   * Flags if recall drops >5% or latency increases >50%.
   */
  async detectRegression(): Promise<RegressionReport> {
    const runs = await this.prisma.evalRun.findMany({
      orderBy: { timestamp: 'desc' },
      take: 4, // latest + 3 for baseline
    });

    if (runs.length < 2) {
      return {
        hasRegression: false,
        latestRun: null,
        baseline: null,
        recallDelta: null,
        latencyDelta: null,
        flags: ['Insufficient data (need at least 2 runs)'],
      };
    }

    const latest = runs[0];
    const baselineRuns = runs.slice(1, 4); // up to 3 previous runs

    const avgRecallScore =
      baselineRuns.reduce((s, r) => s + r.recallScore, 0) / baselineRuns.length;
    const avgLatencyP50Ms =
      baselineRuns.reduce((s, r) => s + r.latencyP50Ms, 0) /
      baselineRuns.length;

    const recallDelta = latest.recallScore - avgRecallScore;
    const latencyDelta =
      avgLatencyP50Ms > 0
        ? (latest.latencyP50Ms - avgLatencyP50Ms) / avgLatencyP50Ms
        : 0;

    const flags: string[] = [];
    if (recallDelta < -0.05) {
      flags.push(
        `Recall dropped ${(Math.abs(recallDelta) * 100).toFixed(1)}% (threshold: 5%)`,
      );
    }
    if (latencyDelta > 0.5) {
      flags.push(
        `Latency increased ${(latencyDelta * 100).toFixed(1)}% (threshold: 50%)`,
      );
    }

    return {
      hasRegression: flags.length > 0,
      latestRun: {
        recallScore: latest.recallScore,
        latencyP50Ms: latest.latencyP50Ms,
      },
      baseline: {
        avgRecallScore: Math.round(avgRecallScore * 1000) / 1000,
        avgLatencyP50Ms: Math.round(avgLatencyP50Ms),
      },
      recallDelta: Math.round(recallDelta * 1000) / 1000,
      latencyDelta: Math.round(latencyDelta * 1000) / 1000,
      flags,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async runSingleQuery(testCase: EvalQuery): Promise<EvalQueryResult> {
    const start = Date.now();
    let memories: Array<{ raw: string }> = [];

    try {
      const resp = await this.contextualRecall.recall(this.userId, {
        text: testCase.query,
        sessionKey: `eval-recall-${testCase.id}-${Date.now()}`,
      });
      memories = resp.memories || [];
    } catch (err) {
      this.logger.warn(`Query ${testCase.id} failed: ${err.message}`);
    }

    const latencyMs = Date.now() - start;
    const allContent = memories.map((m) => m.raw).join('\n');
    const contentLower = allContent.toLowerCase();

    const fragmentsFound: string[] = [];
    const fragmentsMissed: string[] = [];

    for (const frag of testCase.expectedFragments) {
      if (contentLower.includes(frag.toLowerCase())) {
        fragmentsFound.push(frag);
      } else {
        fragmentsMissed.push(frag);
      }
    }

    const totalFragments = testCase.expectedFragments.length;
    const pass = testCase.matchAny
      ? fragmentsFound.length > 0
      : fragmentsFound.length === totalFragments;

    const recall =
      totalFragments > 0 ? fragmentsFound.length / totalFragments : 0;

    // Precision: how many returned memories contain at least one expected fragment
    let relevantCount = 0;
    for (const m of memories) {
      const mLower = m.raw.toLowerCase();
      if (
        testCase.expectedFragments.some((f) => mLower.includes(f.toLowerCase()))
      ) {
        relevantCount++;
      }
    }
    const precision = memories.length > 0 ? relevantCount / memories.length : 0;

    return {
      id: testCase.id,
      query: testCase.query,
      pass,
      recall: Math.round(recall * 1000) / 1000,
      precision: Math.round(precision * 1000) / 1000,
      latencyMs,
      fragmentsFound,
      fragmentsMissed,
    };
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  private gradeFromScore(score: number): string {
    if (score >= 0.9) return 'A';
    if (score >= 0.75) return 'B';
    if (score >= 0.6) return 'C';
    if (score >= 0.4) return 'D';
    return 'F';
  }
}
