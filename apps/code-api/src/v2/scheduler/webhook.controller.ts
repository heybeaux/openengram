/**
 * Webhook trigger endpoint (EC-49).
 *
 * Accepts GitHub push webhook deliveries and submits an ingest with
 * `trigger: { source: 'webhook' }`. Pairs with the EC-46 incremental
 * rescan path: the next ingest reads `pass_runs.inputHash` and skips
 * unchanged passes, so a webhook-driven rescan only pays for the work
 * the diff actually touches.
 *
 * Mounted at `/v1/ingest/webhook/github`. We deliberately separate this
 * from the manual `POST /v1/ingest/github` so:
 *   - the auth model differs (HMAC signature vs. unauth personal use)
 *   - logs + metrics can be split by trigger source
 *   - the payload shape is GitHub-specific, not our own
 *
 * The hook script (EC-49 local trigger) hits the same endpoint with a
 * minimal payload that mimics GitHub's `push` event so we don't need a
 * second route just for it.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { loadConfig } from '../config';
import { IngestService, InvalidUrlError } from '../ingest/ingest.service';

/**
 * Subset of the GitHub `push` event we read. Other fields are tolerated
 * but ignored.
 */
export interface GithubPushPayload {
  ref?: string;
  after?: string;
  repository?: {
    clone_url?: string;
    html_url?: string;
    full_name?: string;
  };
  head_commit?: {
    id?: string;
    message?: string;
  };
  /**
   * Hook-script callers don't always send a `repository` block. Treat
   * this as a synonym for `repository.clone_url`.
   */
  url?: string;
}

export interface WebhookResponse {
  ok: true;
  jobId: string;
  coalesced: boolean;
  trigger: 'webhook';
}

@Controller('v1/ingest/webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
  /** Cached so we don't re-read config on every delivery. */
  private secretPromise: Promise<string> | null = null;

  constructor(private readonly ingest: IngestService) {}

  /**
   * GitHub push webhook + post-commit hook endpoint.
   *
   * If the loaded config carries a `scheduler.webhook.secret`, every
   * delivery must include a matching `X-Hub-Signature-256` header (HMAC-
   * SHA256 of the raw body). When no secret is configured we accept any
   * caller — fine for trusted networks, but the operator should set one
   * in production. The signature check uses `timingSafeEqual` to avoid
   * leaking the secret through a comparison oracle.
   */
  @Post('github')
  @HttpCode(HttpStatus.ACCEPTED)
  async github(
    @Req() req: Request,
    @Headers('x-hub-signature-256') signatureHeader: string | undefined,
    @Headers('x-github-event') eventName: string | undefined,
    @Headers('x-github-delivery') deliveryId: string | undefined,
    @Body() body: GithubPushPayload,
  ): Promise<WebhookResponse> {
    const secret = await this.getSecret();
    if (secret) {
      const raw =
        (req as Request & { rawBody?: Buffer | string }).rawBody ??
        JSON.stringify(body ?? {});
      if (!verifySignature(secret, raw, signatureHeader)) {
        throw new HttpException(
          'invalid webhook signature',
          HttpStatus.UNAUTHORIZED,
        );
      }
    }

    // Only `push` (and the hook script's `local-commit`) trigger
    // rescans. Other events (ping, pull_request, etc.) acknowledge OK so
    // GitHub doesn't retry, but we don't burn cycles on them.
    if (
      eventName !== undefined &&
      eventName !== 'push' &&
      eventName !== 'local-commit'
    ) {
      throw new HttpException(
        `event "${eventName}" ignored`,
        HttpStatus.NO_CONTENT,
      );
    }

    const url = body.repository?.clone_url ?? body.url;
    if (typeof url !== 'string' || url.trim() === '') {
      throw new HttpException(
        'repository.clone_url is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    const sha = body.after ?? body.head_commit?.id;
    const ref = parseRef(body.ref);

    try {
      const result = this.ingest.submit({
        url,
        ref,
        trigger: {
          source: 'webhook',
          sha,
          detail: {
            event: eventName ?? 'push',
            deliveryId,
            fullName: body.repository?.full_name,
            headCommit: body.head_commit?.id,
          },
        },
      });
      return {
        ok: true,
        jobId: result.job.id,
        coalesced: result.coalesced,
        trigger: 'webhook',
      };
    } catch (err) {
      if (err instanceof InvalidUrlError) {
        throw new HttpException(err.message, HttpStatus.BAD_REQUEST);
      }
      this.logger.error(
        `webhook ingest failed for ${url}: ${(err as Error).message}`,
      );
      throw new HttpException(
        'failed to submit webhook ingest',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Resolve the configured secret once. Returns `''` (no auth) on load
   * failure rather than throwing — we'd rather accept hooks than 500
   * every delivery when `.engram/config.yaml` is missing.
   */
  private getSecret(): Promise<string> {
    if (!this.secretPromise) {
      this.secretPromise = loadConfig()
        .then((r) => r.config.scheduler.webhook.secret ?? '')
        .catch(() => '');
    }
    return this.secretPromise;
  }
}

/** Strip `refs/heads/` from a GitHub ref. Returns undefined if blank. */
function parseRef(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length);
  return ref;
}

/**
 * Verify a `X-Hub-Signature-256` header against the raw body. GitHub
 * emits `sha256=<hex>`; we recompute and compare in constant time.
 *
 * Exported so the unit test can exercise the signature path directly.
 */
export function verifySignature(
  secret: string,
  rawBody: Buffer | string,
  header: string | undefined,
): boolean {
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const got = header.slice('sha256='.length);
  if (got.length !== expected.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(got, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    return false;
  }
}
