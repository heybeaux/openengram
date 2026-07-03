/**
 * Ingest orchestrator service (EC-39a).
 *
 * One in-memory queue keyed by `repoId` so simultaneous submissions of
 * the same URL coalesce into a single job (single-flight). Background work
 * is kicked off via `setImmediate`; the BullMQ flavor from the spec is
 * the natural follow-up once we need persistence across restarts, but the
 * in-memory queue keeps the dependency surface small for v1 (personal use,
 * single-process server).
 *
 * The pipeline reuses `runSynth` from EC-38 directly — we do not
 * reimplement the structure→repository chain here. Mocks for the git
 * clone and LLM clients are injected via the constructor so the
 * integration test can run the full state machine without network IO.
 */

import {
  Injectable,
  Logger,
  Optional,
  Inject,
  type OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { runSynth, type SynthOverrides } from '../cli/synth';
import { loadConfig } from '../config';
import { EngramEmitter } from '../observations/engram-emitter';
import {
  persistPassRun,
  type PassRunPrismaClient,
} from '../passes/pass-run.repository';
import type { PassRunInput } from '../types/cards';
import { BudgetTracker } from './budget-tracker';
import {
  CloneError,
  RealGitCloneAdapter,
  type GitCloneAdapter,
} from './git-clone.adapter';
import {
  artifactsDirFor,
  evictIfOverCap,
  resetRepoStorage,
  scratchDirFor,
} from './storage';
import { STAGE_PROGRESS, type IngestJob, type IngestStage } from './types';
import { parseGitHubUrl } from './url';

export const INGEST_CLONE_ADAPTER = Symbol('INGEST_CLONE_ADAPTER');
export const INGEST_SYNTH_OVERRIDES = Symbol('INGEST_SYNTH_OVERRIDES');
export const INGEST_PASS_RUN_RECORDER = Symbol('INGEST_PASS_RUN_RECORDER');
export const INGEST_BUDGET_PRISMA = Symbol('INGEST_BUDGET_PRISMA');
/**
 * EC-50: Engram observation emitter. Optional — when bound, `IngestService`
 * fires one observation per pass run after the ledger row is persisted.
 * `null` skips emission entirely (default for unit tests).
 */
export const INGEST_ENGRAM_EMITTER = Symbol('INGEST_ENGRAM_EMITTER');
/**
 * EC-46: Prisma client used by the incremental rescan gate. Same shape as
 * the budget Prisma — typically the wider PrismaClient — but kept on a
 * separate token so a deployer can wire one without the other.
 */
export const INGEST_INCREMENTAL_PRISMA = Symbol('INGEST_INCREMENTAL_PRISMA');

/**
 * Records one `pass_runs` row per pass invocation. Injected so the ingest
 * service can persist EC-47 observability rows without taking a hard
 * Prisma dependency in tests that don't need a database.
 */
export type PassRunRecorder = (run: PassRunInput) => Promise<void>;

/**
 * Build a {@link PassRunRecorder} backed by a Prisma client. Swallows write
 * errors after logging — observability is best-effort and must never fail an
 * ingest.
 *
 * When an {@link EngramEmitter} is provided, EC-50 emits a fire-and-forget
 * observation after the ledger row lands. The emitter is synchronous from
 * our side (it just enqueues); the actual POST happens on its own flush
 * timer. We deliberately call `emitPassRun` even when `persistPassRun`
 * throws — the ledger failure shouldn't suppress the observation, and the
 * emitter is built to swallow its own failures.
 */
export function makePrismaPassRunRecorder(
  prisma: PassRunPrismaClient,
  logger?: { error: (msg: string) => void },
  emitter?: EngramEmitter | null,
): PassRunRecorder {
  return async (run: PassRunInput) => {
    try {
      await persistPassRun(prisma, run);
    } catch (err) {
      logger?.error(
        `persistPassRun(${run.passName}) failed: ${(err as Error).message}`,
      );
    }
    if (emitter) {
      try {
        emitter.emitPassRun(run);
      } catch (err) {
        logger?.error(
          `engram emit(${run.passName}) failed: ${(err as Error).message}`,
        );
      }
    }
  };
}

export interface SubmitInput {
  url: string;
  ref?: string;
  /**
   * EC-49: optional trigger attribution. When set, every `pass_runs` row
   * for this job carries the trigger source in `metadata.trigger` so the
   * dashboard can answer "what fired this synth?" without log archaeology.
   */
  trigger?: IngestTrigger;
}

/**
 * Why this run started. `manual` is the default for raw API submissions;
 * the cron + webhook + post-commit hook stamp the appropriate kind so
 * the ledger captures the actual driver.
 */
export interface IngestTrigger {
  source: 'manual' | 'cron' | 'webhook' | 'hook';
  /** Optional commit SHA the trigger asked us to settle on. */
  sha?: string;
  /** Free-form per-source extras (delivery id, head commit, etc.). */
  detail?: Record<string, unknown>;
}

export interface SubmitResult {
  job: IngestJob;
  /** True when this submission coalesced into an existing in-flight job. */
  coalesced: boolean;
}

@Injectable()
export class IngestService implements OnModuleDestroy {
  private readonly logger = new Logger(IngestService.name);
  private readonly jobs = new Map<string, IngestJob>();
  /** Maps `repoId` → active job id, so duplicate URLs coalesce. */
  private readonly activeByRepo = new Map<string, string>();

  constructor(
    @Optional()
    @Inject(INGEST_CLONE_ADAPTER)
    private readonly cloneAdapter: GitCloneAdapter = new RealGitCloneAdapter(),
    @Optional()
    @Inject(INGEST_SYNTH_OVERRIDES)
    private readonly synthOverrides: SynthOverrides = {},
    @Optional()
    @Inject(INGEST_PASS_RUN_RECORDER)
    private readonly passRunRecorder: PassRunRecorder | null = null,
    @Optional()
    @Inject(INGEST_BUDGET_PRISMA)
    private readonly budgetPrisma: PassRunPrismaClient | null = null,
    @Optional()
    @Inject(INGEST_INCREMENTAL_PRISMA)
    private readonly incrementalPrisma: PassRunPrismaClient | null = null,
    @Optional()
    @Inject(INGEST_ENGRAM_EMITTER)
    private readonly engramEmitter: EngramEmitter | null = null,
  ) {}

  /**
   * EC-50: drain pending Engram observations before the process exits so
   * the last batch of pass runs makes it to the API. The emitter swallows
   * its own errors; we just kick off the shutdown.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.engramEmitter) {
      try {
        await this.engramEmitter.shutdown();
      } catch (err) {
        this.logger.warn(
          `Engram emitter shutdown failed: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Submit a new ingest job. If an in-flight job exists for the same
   * `repoId`, return that one with `coalesced: true` instead of starting
   * a duplicate run.
   */
  submit(input: SubmitInput): SubmitResult {
    const parsed = parseGitHubUrl(input.url);
    if (parsed === null) {
      throw new InvalidUrlError(
        `Invalid GitHub URL: ${input.url}. Expected https://github.com/<owner>/<repo>.`,
      );
    }
    const ref = input.ref ?? parsed.ref;

    const existing = this.activeByRepo.get(parsed.repoId);
    if (existing !== undefined) {
      const job = this.jobs.get(existing);
      if (job && (job.status === 'queued' || job.status === 'running')) {
        return { job: { ...job }, coalesced: true };
      }
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const job: IngestJob = {
      id,
      repoId: parsed.repoId,
      url: parsed.cloneUrl,
      ref,
      status: 'queued',
      stage: 'queued',
      progress: STAGE_PROGRESS.queued,
      startedAt: now,
      trigger: input.trigger ?? { source: 'manual' },
    };
    this.jobs.set(id, job);
    this.activeByRepo.set(parsed.repoId, id);

    setImmediate(() => {
      void this.run(id);
    });

    return { job: { ...job }, coalesced: false };
  }

  get(id: string): IngestJob | undefined {
    const job = this.jobs.get(id);
    return job ? { ...job } : undefined;
  }

  list(limit = 20): IngestJob[] {
    const all = Array.from(this.jobs.values());
    all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return all.slice(0, limit).map((j) => ({ ...j }));
  }

  /** Test hook — drains the queue for deterministic assertions. */
  async waitForJob(id: string, timeoutMs = 10_000): Promise<IngestJob> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const job = this.jobs.get(id);
      if (job && (job.status === 'ready' || job.status === 'failed')) {
        return { ...job };
      }
      await delay(20);
    }
    throw new Error(`Timeout waiting for ingest job ${id}`);
  }

  private async run(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = 'running';

    try {
      await this.runPipeline(job);
      this.transition(job, 'done');
      job.status = 'ready';
      job.finishedAt = new Date().toISOString();
    } catch (err) {
      job.status = 'failed';
      job.finishedAt = new Date().toISOString();
      if (err instanceof CloneError) {
        job.error = err.message;
        job.errorKind = err.kind;
      } else if (err instanceof Error) {
        job.error = err.message;
        job.errorKind = classifySynthError(err);
      } else {
        job.error = String(err);
        job.errorKind = 'unknown';
      }
      this.logger.error(`Ingest ${id} failed at ${job.stage}: ${job.error}`);
    } finally {
      // Release the single-flight slot so the next submission for this
      // repoId can start a fresh run (e.g. after a fix or LLM rate-limit
      // recovery).
      if (this.activeByRepo.get(job.repoId) === id) {
        this.activeByRepo.delete(job.repoId);
      }
    }
  }

  private async runPipeline(job: IngestJob): Promise<void> {
    // Clean any prior scratch/artifacts for this repoId so the synth
    // pipeline sees fresh sources.
    await resetRepoStorage(job.repoId);

    this.transition(job, 'cloning');
    const scratchDir = scratchDirFor(job.repoId);
    await this.cloneAdapter.clone({
      cloneUrl: job.url,
      ref: job.ref,
      targetDir: scratchDir,
    });

    // Synth pipeline. `runSynth` advances through structure → contracts →
    // gotchas → subsystem → repository internally, but we surface each
    // stage to the dashboard via a small log-line shim.
    this.transition(job, 'structure');
    const stageRouter = (line: string) => {
      const stage = pickStageFromLog(line);
      if (stage !== null) this.transition(job, stage);
    };

    const artifactsDir = artifactsDirFor(job.repoId);

    // EC-48: build a BudgetTracker per run when Prisma is wired. The tracker
    // reads today's historical spend from `pass_runs` and gates each pass.
    // When Prisma isn't available (test mode), we skip budget enforcement
    // and synth falls back to its EC-47 dailyTokenCap counter.
    let budget: BudgetTracker | undefined;
    if (this.budgetPrisma) {
      try {
        const { config } = await loadConfig({ startDir: scratchDir });
        budget = new BudgetTracker({
          dailyCap: config.budget.dailyTokenCap,
          perPassCap: config.budget.perPassTokenCap,
          prisma: this.budgetPrisma,
          repoId: job.repoId,
        });
      } catch (err) {
        this.logger.warn(
          `BudgetTracker init skipped: ${(err as Error).message}`,
        );
      }
    }

    // EC-49: wrap the recorder so every row this job emits carries the
    // trigger source in `metadata.trigger`. Manual API hits land here as
    // `{ source: 'manual' }`; cron/webhook/hook each fill the field
    // accordingly. Wrapping at the ingest layer keeps the change off the
    // synth signature.
    const baseRecorder = this.passRunRecorder ?? undefined;
    const trigger = job.trigger ?? { source: 'manual' as const };
    const wrappedRecorder: PassRunRecorder | undefined = baseRecorder
      ? async (run) => {
          const merged: PassRunInput = {
            ...run,
            metadata: {
              ...(run.metadata ?? {}),
              trigger,
            },
          };
          await baseRecorder(merged);
        }
      : undefined;

    const summary = await runSynth({
      repoPath: scratchDir,
      subcommand: 'all',
      outDir: artifactsDir,
      repoId: job.repoId,
      log: (line) => {
        this.logger.log(`[ingest ${job.id}] ${line}`);
        stageRouter(line);
      },
      overrides: this.synthOverrides,
      // EC-47: persist one `pass_runs` row per pass. Recorder may be null
      // when a test or local CLI doesn't wire Prisma — that's fine, synth
      // still runs end-to-end.
      onPassRun: wrappedRecorder,
      // EC-48: per-pass + daily token caps, enforced before each pass.
      budget,
      // EC-46: incremental git-diff rescans. When the Prisma client is wired,
      // each pass consults `pass_runs.inputHash` and skips unchanged ones.
      // Without Prisma, every pass runs (legacy behavior).
      incremental: this.incrementalPrisma
        ? { prisma: this.incrementalPrisma }
        : undefined,
    });

    job.totalTokens = summary.totalTokens;

    // Best-effort LRU eviction. Failures here are logged but don't fail
    // the ingest — the cap is a soft limit.
    try {
      const evicted = await evictIfOverCap();
      if (evicted.length > 0) {
        this.logger.log(
          `Evicted ${evicted.length} repo(s): ${evicted.join(', ')}`,
        );
      }
    } catch (err) {
      this.logger.warn(`LRU eviction skipped: ${(err as Error).message}`);
    }
  }

  private transition(job: IngestJob, stage: IngestStage): void {
    job.stage = stage;
    job.progress = STAGE_PROGRESS[stage];
  }
}

export class InvalidUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidUrlError';
  }
}

function pickStageFromLog(line: string): IngestStage | null {
  if (line.includes('structure pass')) return 'structure';
  if (line.includes('contracts →')) return 'contracts';
  if (line.includes('gotchas →')) return 'gotchas';
  if (line.includes('subsystem →')) return 'subsystem';
  if (line.includes('repository →')) return 'repository';
  return null;
}

function classifySynthError(err: Error): IngestJob['errorKind'] {
  const msg = err.message.toLowerCase();
  if (msg.includes('rate limit') || msg.includes('429')) return 'rate-limit';
  if (msg.includes('network') || msg.includes('fetch failed')) return 'network';
  return 'unknown';
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
