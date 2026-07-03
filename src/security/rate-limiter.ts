/** Sliding window rate limiter. */

interface RateLimit {
  maxRequests: number;
  windowMs: number;
}

const RATE_LIMITS: Record<string, RateLimit> = {
  remember: { maxRequests: 30, windowMs: 60_000 },
  recall: { maxRequests: 60, windowMs: 60_000 },
  search: { maxRequests: 60, windowMs: 60_000 },
  forget: { maxRequests: 10, windowMs: 60_000 },
  context: { maxRequests: 20, windowMs: 60_000 },
  health: { maxRequests: 60, windowMs: 60_000 },
  observe: { maxRequests: 30, windowMs: 60_000 },
};

const windows = new Map<string, number[]>();

export function checkRateLimit(operation: string): void {
  const limit = RATE_LIMITS[operation];
  if (!limit) return;

  const now = Date.now();
  const key = operation;
  let timestamps = windows.get(key) || [];

  // Remove expired entries
  timestamps = timestamps.filter(t => now - t < limit.windowMs);

  if (timestamps.length >= limit.maxRequests) {
    const oldestValid = timestamps[0]!;
    const retryAfterMs = limit.windowMs - (now - oldestValid);
    throw new Error(
      `Rate limit exceeded for ${operation}. Max ${limit.maxRequests} requests per ${limit.windowMs / 1000}s. Retry after ${Math.ceil(retryAfterMs / 1000)}s.`
    );
  }

  timestamps.push(now);
  windows.set(key, timestamps);
}

/** Reset all rate limit windows (for testing). */
export function resetRateLimits(): void {
  windows.clear();
}
