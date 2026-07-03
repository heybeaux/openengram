/**
 * Cron scheduler (EC-49).
 *
 * Periodically submits ingest jobs for the URLs listed in
 * `.engram/config.yaml › scheduler.cron`. Each job is stamped with
 * `trigger: { source: 'cron' }` so the `pass_runs` ledger captures the
 * driver.
 *
 * v1 stays deliberately small: one `setInterval` per configured job, no
 * persisted schedule, no cron expression parser. The dependency surface
 * is `setInterval` + IngestService — nothing else. When the spec grows
 * to "every Sunday at 2am", we lift in a real cron parser; for now
 * `intervalMs` is sufficient for the "every 30 minutes" personal-use
 * pattern.
 *
 * Coalescing is delegated to IngestService — if a previous run is still
 * in flight when the timer fires, the submit returns `coalesced: true`
 * and we just log a noop, which is exactly what an operator wants when
 * a long pipeline overlaps a tick.
 */

import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

import { loadConfig, type ResolvedEngramConfig } from '../config';
import { IngestService } from '../ingest/ingest.service';

/** One configured job. Mirrors the resolved config shape. */
export interface CronJob {
  url: string;
  ref?: string;
  intervalMs: number;
}

/**
 * Test-friendly clock so specs can drive ticks without `jest.useFakeTimers`
 * leaking into the rest of the suite. Production wires this to the global
 * `setInterval` / `clearInterval`.
 */
export interface CronClock {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const REAL_CLOCK: CronClock = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

/**
 * Public entry point used by both the NestJS module wiring and the
 * standalone unit tests. The module wraps {@link CronSchedulerService}
 * around a real clock; tests pass a fake.
 */
export class CronScheduler {
  private readonly logger = new Logger(CronScheduler.name);
  private readonly handles: unknown[] = [];

  constructor(
    private readonly ingest: Pick<IngestService, 'submit'>,
    private readonly clock: CronClock = REAL_CLOCK,
  ) {}

  /**
   * Schedule every job in `jobs`. Returns the number of timers armed.
   * Safe to call twice — the second call no-ops by clearing existing
   * handles first.
   */
  start(jobs: readonly CronJob[]): number {
    this.stop();
    if (jobs.length === 0) {
      this.logger.log('cron: no jobs configured; scheduler idle');
      return 0;
    }
    for (const job of jobs) {
      const handle = this.clock.setInterval(() => {
        this.fire(job).catch((err: unknown) => {
          this.logger.error(
            `cron: tick for ${job.url} failed: ${(err as Error).message}`,
          );
        });
      }, job.intervalMs);
      this.handles.push(handle);
      this.logger.log(
        `cron: armed ${job.url}${job.ref ? `@${job.ref}` : ''} every ${job.intervalMs}ms`,
      );
    }
    return this.handles.length;
  }

  /** Cancel all armed timers. Idempotent. */
  stop(): void {
    for (const h of this.handles) this.clock.clearInterval(h);
    this.handles.length = 0;
  }

  /**
   * Exposed so tests (and a future `POST /v1/scheduler/fire` admin
   * endpoint) can trigger a job without waiting for the timer.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async fire(job: CronJob): Promise<void> {
    const result = this.ingest.submit({
      url: job.url,
      ref: job.ref,
      trigger: {
        source: 'cron',
        detail: { intervalMs: job.intervalMs },
      },
    });
    if (result.coalesced) {
      this.logger.log(
        `cron: ${job.url} still in flight (job ${result.job.id}); skipping tick`,
      );
    } else {
      this.logger.log(`cron: submitted ${job.url} as job ${result.job.id}`);
    }
  }
}

/**
 * NestJS-managed wrapper. Reads `.engram/config.yaml` on boot and
 * schedules the cron jobs there. Tests skip this and instantiate
 * {@link CronScheduler} directly.
 */
@Injectable()
export class CronSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CronSchedulerService.name);
  private readonly scheduler: CronScheduler;

  constructor(private readonly ingest: IngestService) {
    this.scheduler = new CronScheduler(ingest);
  }

  async onModuleInit(): Promise<void> {
    let config: ResolvedEngramConfig;
    try {
      const loaded = await loadConfig();
      config = loaded.config;
    } catch (err) {
      this.logger.warn(
        `cron: config load failed, scheduler disabled: ${(err as Error).message}`,
      );
      return;
    }
    if (!config.scheduler.enabled) {
      this.logger.log('cron: disabled in config; scheduler idle');
      return;
    }
    this.scheduler.start(config.scheduler.cron);
  }

  onModuleDestroy(): void {
    this.scheduler.stop();
  }
}
