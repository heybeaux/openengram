/** Thin HTTP client for the Engram API. Uses native fetch. */

import { Config } from './config.js';
import { logger } from './logger.js';

export class EngramAPI {
  private baseUrl: string;
  private apiKey: string;
  private userId: string;
  private timeoutMs: number;
  private maxRetries: number;
  private lastHealthy: string | null = null;

  constructor(config: Config) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.userId = config.userId;
    this.timeoutMs = config.timeoutMs;
    this.maxRetries = config.maxRetries;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-AM-API-Key': this.apiKey,
      'X-AM-User-ID': this.userId,
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    retries = this.maxRetries,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      logger.debug('API request', { method, path });
      const resp = await fetch(url, {
        method,
        headers: this.headers(),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (resp.ok) {
        this.lastHealthy = new Date().toISOString();
        const text = await resp.text();
        return text ? JSON.parse(text) : (undefined as T);
      }

      // Handle specific error codes
      if (resp.status === 401 || resp.status === 403) {
        throw new EngramError('API key invalid or expired', resp.status);
      }
      if (resp.status === 404) {
        throw new EngramError('Resource not found', 404);
      }
      if (resp.status === 429) {
        const retryAfter = resp.headers.get('retry-after');
        throw new EngramError(
          `Rate limited by Engram backend${retryAfter ? `. Retry after ${retryAfter}s` : ''}`,
          429,
        );
      }

      // 5xx — retry
      if (resp.status >= 500 && retries > 0) {
        logger.warn('Retrying after server error', { status: resp.status, retriesLeft: retries - 1 });
        await new Promise(r => setTimeout(r, 1000));
        return this.request<T>(method, path, body, retries - 1);
      }

      const errBody = await resp.text().catch(() => '');
      throw new EngramError(
        `Engram API error: ${resp.status} ${resp.statusText}${errBody ? ` — ${errBody.slice(0, 200)}` : ''}`,
        resp.status,
      );
    } catch (err) {
      if (err instanceof EngramError) throw err;
      if ((err as Error).name === 'AbortError') {
        if (retries > 0) {
          logger.warn('Retrying after timeout', { retriesLeft: retries - 1 });
          return this.request<T>(method, path, body, retries - 1);
        }
        throw new EngramError('Request timed out', 0, true);
      }
      // Network error — Engram likely offline
      throw new EngramError(
        `Cannot reach Engram backend: ${(err as Error).message}`,
        0,
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  // --- Tool backends ---

  async remember(body: {
    raw: string;
    layer?: string;
    importance?: number | string;
    tags?: string[];
    source?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.request<{ id: string; raw: string; layer: string; tags: string[] }>(
      'POST', '/v1/memories', body,
    );
  }

  async recall(body: {
    query: string;
    layers?: string[];
    limit?: number;
    tags?: string[];
    minImportance?: number;
  }) {
    return this.request<Array<{ id: string; raw: string; processed?: string; layer: string; score?: number; tags: string[]; createdAt: string }>>(
      'POST', '/v1/memories/query', body,
    );
  }

  async search(body: { query: string; entityType?: string }) {
    return this.request<unknown>('POST', '/v1/hierarchy/search', body);
  }

  async forget(id: string) {
    return this.request<void>('DELETE', `/v1/memories/${encodeURIComponent(id)}`);
  }

  async context(body: { maxTokens?: number; focus?: string; projectId?: string }) {
    return this.request<{ context: string } | string>('POST', '/v1/context', body);
  }

  async observe(body: { content: string; source?: string; metadata?: Record<string, unknown> }) {
    return this.request<{ memories: Array<{ id: string; raw: string }> }>(
      'POST', '/v1/auto/observe', body,
    );
  }

  async health() {
    return this.request<{ healthy: boolean; uptime?: number; version?: string }>(
      'GET', '/v1/health',
    );
  }

  async stats() {
    return this.request<{ total: number; byLayer: Record<string, number>; bySource: Record<string, number> }>(
      'GET', '/v1/memories/stats',
    );
  }

  getLastHealthy(): string | null {
    return this.lastHealthy;
  }
}

export class EngramError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly offline: boolean = false,
  ) {
    super(message);
    this.name = 'EngramError';
  }
}
