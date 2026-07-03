import { EngramError, AuthError, NotFoundError, TimeoutError } from './errors.js';

export interface HttpConfig {
  baseUrl: string;
  apiKey: string;
  userId: string;
  timeout: number;
  retries: number;
  onError?: (err: Error) => void;
}

export interface RequestOptions {
  method: string;
  path: string;
  body?: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function mapError(status: number, message: string): EngramError {
  if (status === 401) return new AuthError(message);
  if (status === 404) return new NotFoundError(message);
  return new EngramError(message, status);
}

export async function request<T>(config: HttpConfig, opts: RequestOptions): Promise<T> {
  const url = `${config.baseUrl}${opts.path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-AM-API-Key': config.apiKey,
    'X-AM-User-ID': config.userId,
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.retries; attempt++) {
    if (attempt > 0) {
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 10000));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeout);

    try {
      const res = await fetch(url, {
        method: opts.method,
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (res.ok) {
        if (res.status === 204) return undefined as T;
        return (await res.json()) as T;
      }

      const errorBody = await res.text().catch(() => '');
      const msg = errorBody || res.statusText;

      // Only retry on 5xx
      if (res.status >= 500 && attempt < config.retries) {
        lastError = mapError(res.status, msg);
        continue;
      }

      const err = mapError(res.status, msg);
      config.onError?.(err);
      throw err;
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof EngramError) throw e;
      if ((e as Error).name === 'AbortError') {
        const err = new TimeoutError();
        if (attempt < config.retries) {
          lastError = err;
          continue;
        }
        config.onError?.(err);
        throw err;
      }
      lastError = e as Error;
      if (attempt >= config.retries) {
        config.onError?.(lastError);
        throw lastError;
      }
    }
  }

  throw lastError!;
}
