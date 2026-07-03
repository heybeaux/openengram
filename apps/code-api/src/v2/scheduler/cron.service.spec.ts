/**
 * Cron scheduler unit tests (EC-49).
 *
 * The scheduler is driven by a pluggable clock so we can fire timers
 * synchronously instead of relying on `jest.useFakeTimers`. Each test
 * exercises one of the scheduler's three observable contracts:
 *
 *   1. `start()` arms one timer per job.
 *   2. Ticking a timer submits the matching ingest with the cron
 *      trigger stamp.
 *   3. `stop()` and re-`start()` cancel the previous timers (idempotent).
 */

import { CronScheduler, type CronClock, type CronJob } from './cron.service';
import type { IngestService } from '../ingest/ingest.service';
import type { IngestJob } from '../ingest/types';

function fakeJob(): IngestJob {
  return {
    id: 'job-1',
    repoId: 'owner__repo',
    url: 'https://github.com/owner/repo.git',
    status: 'queued',
    stage: 'queued',
    progress: 0,
    startedAt: new Date().toISOString(),
  };
}

class FakeClock implements CronClock {
  private nextId = 0;
  readonly armed = new Map<number, { fn: () => void; ms: number }>();

  setInterval(fn: () => void, ms: number): unknown {
    const id = ++this.nextId;
    this.armed.set(id, { fn, ms });
    return id;
  }

  clearInterval(handle: unknown): void {
    this.armed.delete(handle as number);
  }

  tick(handle: unknown): void {
    const entry = this.armed.get(handle as number);
    if (!entry) throw new Error(`no timer for handle ${String(handle)}`);
    entry.fn();
  }

  tickAll(): void {
    for (const e of this.armed.values()) e.fn();
  }
}

function makeIngestStub(): {
  ingest: Pick<IngestService, 'submit'>;
  calls: Array<{ url: string; ref?: string; triggerSource?: string }>;
} {
  const calls: Array<{ url: string; ref?: string; triggerSource?: string }> =
    [];
  return {
    ingest: {
      submit: (input) => {
        calls.push({
          url: input.url,
          ref: input.ref,
          triggerSource: input.trigger?.source,
        });
        return { job: fakeJob(), coalesced: false };
      },
    },
    calls,
  };
}

describe('CronScheduler', () => {
  it('arms one timer per configured job', () => {
    const { ingest } = makeIngestStub();
    const clock = new FakeClock();
    const scheduler = new CronScheduler(ingest, clock);
    const jobs: CronJob[] = [
      { url: 'https://github.com/a/b', intervalMs: 1000 },
      { url: 'https://github.com/c/d', intervalMs: 2000 },
    ];

    const armed = scheduler.start(jobs);

    expect(armed).toBe(2);
    expect(clock.armed.size).toBe(2);
    const intervals = [...clock.armed.values()].map((e) => e.ms).sort();
    expect(intervals).toEqual([1000, 2000]);
  });

  it('handles an empty job list without arming timers', () => {
    const { ingest } = makeIngestStub();
    const clock = new FakeClock();
    const scheduler = new CronScheduler(ingest, clock);

    expect(scheduler.start([])).toBe(0);
    expect(clock.armed.size).toBe(0);
  });

  it('submits an ingest with cron trigger metadata when a timer fires', async () => {
    const { ingest, calls } = makeIngestStub();
    const clock = new FakeClock();
    const scheduler = new CronScheduler(ingest, clock);
    scheduler.start([
      { url: 'https://github.com/owner/repo', ref: 'main', intervalMs: 30_000 },
    ]);

    const [handle] = clock.armed.keys();
    clock.tick(handle);
    // The timer callback dispatches `fire()` asynchronously; flush the
    // microtask queue so the submit lands before we assert.
    await new Promise((r) => setImmediate(r));

    expect(calls).toEqual([
      {
        url: 'https://github.com/owner/repo',
        ref: 'main',
        triggerSource: 'cron',
      },
    ]);
  });

  it('passes coalesced submissions through without re-throwing', async () => {
    const calls: Array<{ url: string; ref?: string }> = [];
    const ingest: Pick<IngestService, 'submit'> = {
      submit: (input) => {
        calls.push({ url: input.url, ref: input.ref });
        // Simulate an in-flight job — scheduler should log and move on.
        return { job: fakeJob(), coalesced: true };
      },
    };
    const clock = new FakeClock();
    const scheduler = new CronScheduler(ingest, clock);
    scheduler.start([{ url: 'https://github.com/a/b', intervalMs: 5000 }]);

    const [handle] = clock.armed.keys();
    expect(() => clock.tick(handle)).not.toThrow();
    await new Promise((r) => setImmediate(r));

    expect(calls).toHaveLength(1);
  });

  it('cancels previous timers on re-start (idempotent)', () => {
    const { ingest } = makeIngestStub();
    const clock = new FakeClock();
    const scheduler = new CronScheduler(ingest, clock);
    scheduler.start([{ url: 'https://github.com/a/b', intervalMs: 1000 }]);
    expect(clock.armed.size).toBe(1);

    scheduler.start([
      { url: 'https://github.com/a/b', intervalMs: 1000 },
      { url: 'https://github.com/c/d', intervalMs: 1000 },
    ]);

    // Only the two new timers remain; the original was cleared.
    expect(clock.armed.size).toBe(2);
  });

  it('stop() cancels all armed timers', () => {
    const { ingest } = makeIngestStub();
    const clock = new FakeClock();
    const scheduler = new CronScheduler(ingest, clock);
    scheduler.start([
      { url: 'https://github.com/a/b', intervalMs: 1000 },
      { url: 'https://github.com/c/d', intervalMs: 2000 },
    ]);
    expect(clock.armed.size).toBe(2);

    scheduler.stop();

    expect(clock.armed.size).toBe(0);
  });
});
