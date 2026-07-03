/**
 * Webhook controller unit tests (EC-49).
 *
 * Covers:
 *   - HMAC signature verification (constant-time)
 *   - Push event → ingest submit with `trigger: { source: 'webhook' }`
 *   - Hook-script `local-commit` event also routes to ingest
 *   - Non-push events (ping, pull_request) acknowledge but skip submit
 *   - Missing `repository.clone_url` rejects with 400
 *
 * The controller is exercised directly (not via a Nest test module) so
 * each test can stub `IngestService` with a tiny inline object and
 * inject a forced secret via `loadConfig` mocking.
 */

import { createHmac } from 'node:crypto';

import { HttpException } from '@nestjs/common';

import { IngestService } from '../ingest/ingest.service';
import { verifySignature, WebhookController } from './webhook.controller';

jest.mock('../config', () => ({
  loadConfig: jest.fn(),
}));

import { loadConfig } from '../config';

function makeController(secret = ''): {
  controller: WebhookController;
  submits: Array<{
    url: string;
    ref?: string;
    triggerSource?: string;
    sha?: string;
  }>;
} {
  (loadConfig as jest.Mock).mockResolvedValue({
    config: {
      scheduler: { webhook: { secret } },
    },
  });
  const submits: Array<{
    url: string;
    ref?: string;
    triggerSource?: string;
    sha?: string;
  }> = [];
  const ingest = {
    submit: (input: Parameters<IngestService['submit']>[0]) => {
      submits.push({
        url: input.url,
        ref: input.ref,
        triggerSource: input.trigger?.source,
        sha: input.trigger?.sha,
      });
      return {
        job: {
          id: 'job-1',
          repoId: 'r',
          url: input.url,
          status: 'queued' as const,
          stage: 'queued' as const,
          progress: 0,
          startedAt: new Date().toISOString(),
        },
        coalesced: false,
      };
    },
  } as unknown as IngestService;
  return { controller: new WebhookController(ingest), submits };
}

function pushPayload() {
  return {
    ref: 'refs/heads/main',
    after: 'deadbeef',
    repository: {
      clone_url: 'https://github.com/owner/repo.git',
      full_name: 'owner/repo',
    },
    head_commit: { id: 'deadbeef', message: 'fix' },
  };
}

describe('verifySignature', () => {
  it('accepts a matching sha256 signature', () => {
    const body = '{"hello":"world"}';
    const sig =
      'sha256=' + createHmac('sha256', 'secret').update(body).digest('hex');
    expect(verifySignature('secret', body, sig)).toBe(true);
  });

  it('rejects a mismatched signature', () => {
    const body = '{"hello":"world"}';
    const wrong =
      'sha256=' + createHmac('sha256', 'other').update(body).digest('hex');
    expect(verifySignature('secret', body, wrong)).toBe(false);
  });

  it('rejects when the header is missing', () => {
    expect(verifySignature('secret', '{}', undefined)).toBe(false);
  });

  it('rejects when the header lacks the sha256= prefix', () => {
    expect(verifySignature('secret', '{}', 'md5=abcd')).toBe(false);
  });

  it('rejects a malformed signature without throwing', () => {
    // Forces timingSafeEqual into a buffer-length mismatch path.
    expect(verifySignature('secret', '{}', 'sha256=notahex')).toBe(false);
  });
});

describe('WebhookController.github', () => {
  beforeEach(() => {
    (loadConfig as jest.Mock).mockReset();
  });

  it('submits an ingest for a push event with webhook trigger metadata', async () => {
    const { controller, submits } = makeController('');
    const payload = pushPayload();
    const res = await controller.github(
      // Request is unused when no secret; cast to any keeps the test small.
      { rawBody: Buffer.from(JSON.stringify(payload)) } as never,
      undefined,
      'push',
      'delivery-1',
      payload,
    );

    expect(res.ok).toBe(true);
    expect(res.trigger).toBe('webhook');
    expect(submits).toEqual([
      {
        url: 'https://github.com/owner/repo.git',
        ref: 'main',
        triggerSource: 'webhook',
        sha: 'deadbeef',
      },
    ]);
  });

  it('accepts the hook-script `local-commit` event', async () => {
    const { controller, submits } = makeController('');
    const payload = pushPayload();
    await controller.github(
      { rawBody: Buffer.from(JSON.stringify(payload)) } as never,
      undefined,
      'local-commit',
      'delivery-2',
      payload,
    );
    expect(submits).toHaveLength(1);
    expect(submits[0].triggerSource).toBe('webhook');
  });

  it('rejects when HMAC signature is required but missing', async () => {
    const { controller, submits } = makeController('s3cret');
    const payload = pushPayload();
    await expect(
      controller.github(
        { rawBody: Buffer.from(JSON.stringify(payload)) } as never,
        undefined,
        'push',
        'd',
        payload,
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(submits).toHaveLength(0);
  });

  it('accepts when HMAC signature matches the raw body', async () => {
    const { controller, submits } = makeController('s3cret');
    const payload = pushPayload();
    const raw = JSON.stringify(payload);
    const sig =
      'sha256=' + createHmac('sha256', 's3cret').update(raw).digest('hex');
    await controller.github(
      { rawBody: Buffer.from(raw) } as never,
      sig,
      'push',
      'd',
      payload,
    );
    expect(submits).toHaveLength(1);
  });

  it('rejects unrelated GitHub events with 204', async () => {
    const { controller, submits } = makeController('');
    const payload = pushPayload();
    await expect(
      controller.github(
        { rawBody: Buffer.from(JSON.stringify(payload)) } as never,
        undefined,
        'pull_request',
        'd',
        payload,
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(submits).toHaveLength(0);
  });

  it('returns 400 when the payload lacks a repository url', async () => {
    const { controller } = makeController('');
    await expect(
      controller.github(
        { rawBody: Buffer.from('{}') } as never,
        undefined,
        'push',
        'd',
        {},
      ),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
