/**
 * Tests for the Engram observation emitter (EC-50).
 *
 * The emitter is fire-and-forget so we lean on a stub `fetch` to assert
 * what would have hit the wire. Each test injects deterministic retry
 * delays (`[0, 0, 0]`) so the retry path runs without burning real time.
 *
 * Coverage:
 *   - enqueue + manual flush posts one batch
 *   - reaching batchSize triggers an immediate flush
 *   - 503 retries until success
 *   - 4xx drops the batch without retrying
 *   - shutdown drains pending observations
 *   - missing required fields are silently dropped (no fetch call)
 *   - shutdown after errors still resolves
 */

import { EngramEmitter } from './engram-emitter';
import { makePrismaPassRunRecorder } from '../ingest/ingest.service';
import type { PassRunInput } from '../types/cards';

function makeRun(overrides: Partial<PassRunInput> = {}): PassRunInput {
  return {
    repoId: 'repo-1',
    passName: 'structure',
    status: 'SUCCESS',
    tokenCost: 1234,
    startedAt: new Date('2026-05-26T06:30:00Z'),
    finishedAt: new Date('2026-05-26T06:30:05Z'),
    ...overrides,
  };
}

/**
 * Minimal Response-shaped object the emitter consumes. We only need
 * `ok` and `status`; everything else on `Response` would be noise.
 */
function res(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as unknown as Response;
}

interface ObservedPayload {
  observations: Array<{
    type: string;
    repoId: string;
    passName: string;
    status: string;
    tokenCost: number;
  }>;
}

/**
 * Pull the JSON body off the n-th recorded fetch call. Centralizes the
 * type narrowing so each test reads the structured payload without
 * tripping the `no-base-to-string` / `no-unsafe-*` rules.
 */
function bodyOf(fetchMock: jest.Mock, callIndex = 0): ObservedPayload {
  const call = fetchMock.mock.calls[callIndex] as [string, RequestInit];
  const raw = call[1].body;
  if (typeof raw !== 'string') throw new Error('expected string body');
  return JSON.parse(raw) as ObservedPayload;
}

describe('EngramEmitter', () => {
  it('enqueues and flushes a single observation', async () => {
    const fetchMock = jest.fn().mockResolvedValue(res(200));
    const emitter = new EngramEmitter({
      endpoint: 'https://api.openengram.ai',
      apiKey: 'k',
      fetch: fetchMock,
      retryDelaysMs: [0, 0, 0],
    });

    emitter.emitPassRun(makeRun());
    await emitter.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openengram.ai/v1/observations');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer k');
    const body = bodyOf(fetchMock);
    expect(body.observations).toHaveLength(1);
    expect(body.observations[0]).toMatchObject({
      type: 'engram-code.pass-run',
      repoId: 'repo-1',
      passName: 'structure',
      status: 'SUCCESS',
      tokenCost: 1234,
    });
  });

  it('flushes immediately at batchSize boundary', async () => {
    const fetchMock = jest.fn().mockResolvedValue(res(200));
    const emitter = new EngramEmitter({
      endpoint: 'https://api.openengram.ai',
      apiKey: 'k',
      fetch: fetchMock,
      batchSize: 2,
      retryDelaysMs: [0, 0, 0],
    });

    emitter.emitPassRun(makeRun({ passName: 'structure' }));
    emitter.emitPassRun(makeRun({ passName: 'contracts' }));
    // The second emit hits the batchSize threshold and triggers a flush.
    // It's still async (the inner POST is awaited), so explicitly await
    // a flush to settle the in-flight promise before assertions.
    await emitter.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = bodyOf(fetchMock);
    expect(body.observations).toHaveLength(2);
  });

  it('retries on 503 then succeeds', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(200));
    const errs: string[] = [];
    const emitter = new EngramEmitter({
      endpoint: 'https://api.openengram.ai',
      apiKey: 'k',
      fetch: fetchMock,
      retryDelaysMs: [0, 0, 0],
      logger: { error: (m) => errs.push(m) },
    });

    emitter.emitPassRun(makeRun());
    await emitter.flush();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    // No drop logged on eventual success.
    expect(errs).toHaveLength(0);
  });

  it('drops the batch on 4xx without retrying', async () => {
    const fetchMock = jest.fn().mockResolvedValue(res(400));
    const warns: string[] = [];
    const emitter = new EngramEmitter({
      endpoint: 'https://api.openengram.ai',
      apiKey: 'k',
      fetch: fetchMock,
      retryDelaysMs: [0, 0, 0],
      logger: { warn: (m) => warns.push(m) },
    });

    emitter.emitPassRun(makeRun());
    await emitter.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('400');
  });

  it('shutdown drains pending observations', async () => {
    const fetchMock = jest.fn().mockResolvedValue(res(200));
    const emitter = new EngramEmitter({
      endpoint: 'https://api.openengram.ai',
      apiKey: 'k',
      fetch: fetchMock,
      batchSize: 100,
      // Long interval so the timer never fires before shutdown.
      batchIntervalMs: 60_000,
      retryDelaysMs: [0, 0, 0],
    });

    emitter.emitPassRun(makeRun({ passName: 'structure' }));
    emitter.emitPassRun(makeRun({ passName: 'contracts' }));
    expect(fetchMock).not.toHaveBeenCalled();

    await emitter.shutdown();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = bodyOf(fetchMock);
    expect(body.observations).toHaveLength(2);

    // Post-shutdown emits are dropped.
    emitter.emitPassRun(makeRun());
    await emitter.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('drops runs missing required timestamps', async () => {
    const fetchMock = jest.fn().mockResolvedValue(res(200));
    const emitter = new EngramEmitter({
      endpoint: 'https://api.openengram.ai',
      apiKey: 'k',
      fetch: fetchMock,
      retryDelaysMs: [0, 0, 0],
    });

    emitter.emitPassRun({
      repoId: 'r',
      passName: 'structure',
      status: 'SUCCESS',
    });
    await emitter.flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops batches after exhausting retries — never throws to caller', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const errs: string[] = [];
    const emitter = new EngramEmitter({
      endpoint: 'https://api.openengram.ai',
      apiKey: 'k',
      fetch: fetchMock,
      retryDelaysMs: [0, 0, 0],
      logger: { error: (m) => errs.push(m) },
    });

    emitter.emitPassRun(makeRun());
    // flush() must not reject even though every attempt fails.
    await expect(emitter.flush()).resolves.toBeUndefined();

    // 4 attempts: initial + 3 retries.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('ECONNRESET');
  });

  it('integrates with makePrismaPassRunRecorder — persist+emit per call', async () => {
    const fetchMock = jest.fn().mockResolvedValue(res(200));
    const emitter = new EngramEmitter({
      endpoint: 'https://api.openengram.ai',
      apiKey: 'k',
      fetch: fetchMock,
      retryDelaysMs: [0, 0, 0],
    });
    const create = jest.fn().mockResolvedValue({});
    const prisma = { passRun: { create } } as unknown as Parameters<
      typeof makePrismaPassRunRecorder
    >[0];
    const recorder = makePrismaPassRunRecorder(prisma, undefined, emitter);

    await recorder(makeRun({ passName: 'structure' }));
    await recorder(makeRun({ passName: 'contracts' }));
    await emitter.flush();

    expect(create).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1); // both observations in one batch
    const body = bodyOf(fetchMock);
    expect(body.observations.map((o) => o.passName)).toEqual([
      'structure',
      'contracts',
    ]);
  });

  it('rejects construction without endpoint or apiKey', () => {
    expect(
      () =>
        new EngramEmitter({
          endpoint: '',
          apiKey: 'k',
        }),
    ).toThrow(/endpoint/);
    expect(
      () =>
        new EngramEmitter({
          endpoint: 'https://x',
          apiKey: '',
        }),
    ).toThrow(/apiKey/);
  });
});
