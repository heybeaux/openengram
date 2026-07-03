/**
 * Engram observation emitter (EC-50).
 *
 * After every pass run, we POST a small structured observation to
 * `api.openengram.ai` so the Engram graph picks up activity from this
 * indexer. Fire-and-forget: the conductor enqueues synchronously and a
 * background flusher posts in batches. Failures never propagate back into
 * the ingest pipeline — observability must not be able to wedge an
 * indexing run.
 *
 * Behavior:
 *   - Disabled by default; the bound config in `ingest.module.ts` only
 *     wires the emitter when `observations.enabled` is true AND a
 *     non-empty `apiKey` is present (typically from `ENGRAM_API_KEY`).
 *   - {@link emitPassRun} is synchronous: it pushes onto an in-process
 *     queue. The flush loop drains the queue in batches of up to
 *     `batchSize` (default 25) or every `batchIntervalMs` (default 5s),
 *     whichever comes first.
 *   - POSTs `<endpoint>/v1/observations` with `Authorization: Bearer
 *     <apiKey>`. The body is `{ observations: [...] }` so the server can
 *     accept a batch in a single round-trip.
 *   - Retries 3x with exponential backoff (200ms, 400ms, 800ms by
 *     default; overridable for tests) on 5xx + network errors. 4xx is
 *     treated as a permanent client error: the batch is dropped + logged.
 *   - {@link shutdown} drains the queue (best-effort) so process exit
 *     doesn't lose the trailing batch.
 *
 * The emitter takes a `fetch` injection so tests can simulate retries,
 * timeouts, and 4xx/5xx responses without touching the network.
 */

import type { PassRunInput } from '../types/cards';

/** Subset of `console`/Nest Logger we use. Kept tiny so tests can mock. */
export interface Logger {
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
}

/** Shape of a single observation as the Engram API expects it. */
export interface EngramObservationPayload {
  type: 'engram-code.pass-run';
  repoId: string;
  passName: string;
  status: 'SUCCESS' | 'FAILED';
  tokenCost: number;
  startedAt: string;
  finishedAt: string;
  metadata?: Record<string, unknown>;
}

export interface EngramEmitterOptions {
  endpoint: string;
  apiKey: string;
  /** Custom fetch — defaults to global `fetch`. */
  fetch?: typeof fetch;
  /** Max observations per POST. Default 25. */
  batchSize?: number;
  /** Max wait between flushes when below batchSize. Default 5000ms. */
  batchIntervalMs?: number;
  /**
   * Backoff for retries on 5xx/network errors. Defaults to
   * `[200, 400, 800]` — three retries, doubling each time.
   */
  retryDelaysMs?: number[];
  logger?: Logger;
}

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_BATCH_INTERVAL_MS = 5_000;
const DEFAULT_RETRY_DELAYS_MS = [200, 400, 800];

export class EngramEmitter {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly batchSize: number;
  private readonly batchIntervalMs: number;
  private readonly retryDelaysMs: number[];
  private readonly logger: Logger;

  private readonly queue: EngramObservationPayload[] = [];
  /** In-flight flush promise so concurrent flushes serialize. */
  private flushing: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private shuttingDown = false;

  constructor(opts: EngramEmitterOptions) {
    if (!opts.endpoint) throw new Error('EngramEmitter: endpoint is required');
    if (!opts.apiKey) throw new Error('EngramEmitter: apiKey is required');

    this.endpoint = opts.endpoint.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
    this.batchIntervalMs = opts.batchIntervalMs ?? DEFAULT_BATCH_INTERVAL_MS;
    this.retryDelaysMs = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.logger = opts.logger ?? {};
  }

  /**
   * Enqueue one observation. Synchronous; never throws. Triggers an
   * immediate flush when the queue reaches `batchSize`, otherwise arms a
   * timer to flush after `batchIntervalMs`.
   */
  emitPassRun(run: PassRunInput): void {
    if (this.shuttingDown) return;
    const payload = buildPayload(run);
    if (payload === null) return; // missing required fields — drop silently
    this.queue.push(payload);

    if (this.queue.length >= this.batchSize) {
      void this.flush();
    } else if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, this.batchIntervalMs);
      // Don't keep the event loop alive just for the flush timer.
      if (typeof this.timer === 'object' && this.timer !== null) {
        const t = this.timer as unknown as { unref?: () => void };
        t.unref?.();
      }
    }
  }

  /**
   * Drain the queue, posting batches sequentially. Multiple concurrent
   * callers share the same in-flight flush promise so we never double-post.
   */
  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushInner().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  /**
   * Stop accepting new observations and drain whatever is queued. Safe to
   * call multiple times; subsequent calls are no-ops once flushing completes.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  private async flushInner(): Promise<void> {
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.batchSize);
      try {
        await this.postBatchWithRetry(batch);
      } catch (err) {
        // postBatchWithRetry already exhausted retries — drop + log.
        this.logger.error?.(
          `[engram-emitter] dropped batch of ${batch.length} after retries: ${(err as Error).message}`,
        );
      }
    }
  }

  private async postBatchWithRetry(
    batch: EngramObservationPayload[],
  ): Promise<void> {
    const attempts = this.retryDelaysMs.length + 1;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        await this.postBatch(batch);
        return;
      } catch (err) {
        lastError = err;
        if (err instanceof PermanentEmitError) {
          this.logger.warn?.(
            `[engram-emitter] dropping batch of ${batch.length} (${err.message})`,
          );
          return;
        }
        if (attempt < this.retryDelaysMs.length) {
          await sleep(this.retryDelaysMs[attempt]);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async postBatch(batch: EngramObservationPayload[]): Promise<void> {
    const res = await this.fetchImpl(`${this.endpoint}/v1/observations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ observations: batch }),
    });
    if (res.ok) return;
    if (res.status >= 400 && res.status < 500) {
      throw new PermanentEmitError(`HTTP ${res.status}`);
    }
    throw new Error(`HTTP ${res.status}`);
  }
}

/**
 * Thrown internally to short-circuit retry on 4xx — we never want to retry
 * a malformed payload or an auth error against a remote API.
 */
class PermanentEmitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentEmitError';
  }
}

function buildPayload(run: PassRunInput): EngramObservationPayload | null {
  if (!run.startedAt || !run.finishedAt) return null;
  const status: 'SUCCESS' | 'FAILED' =
    run.status === 'FAILED' ? 'FAILED' : 'SUCCESS';
  const metadata: Record<string, unknown> = {};
  if (run.model) metadata.model = run.model;
  if (run.inputHash) metadata.inputHash = run.inputHash;
  if (run.outputHash) metadata.outputHash = run.outputHash;
  if (run.errorMessage) metadata.errorMessage = run.errorMessage;

  return {
    type: 'engram-code.pass-run',
    repoId: run.repoId,
    passName: run.passName,
    status,
    tokenCost: run.tokenCost ?? 0,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt.toISOString(),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
