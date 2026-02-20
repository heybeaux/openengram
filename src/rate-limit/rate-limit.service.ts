import { Injectable } from '@nestjs/common';

interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
}

/**
 * In-memory token-bucket rate limiter.
 *
 * ⚠️  KNOWN LIMITATION (HEY-219): This implementation stores buckets in
 * process memory. It does NOT work correctly when running multiple server
 * instances behind a load balancer — each instance maintains its own
 * independent counters, so a client can effectively multiply its rate limit
 * by the number of instances.
 *
 * TODO(HEY-219): Replace with a shared-storage rate limiter when scaling
 * horizontally.  Options (in order of preference):
 *   1. Redis-backed sliding window (if/when Redis is added to the stack)
 *   2. Postgres-backed counter table with row-level TTL cleanup
 *   3. External rate-limit service (e.g. Cloudflare, API gateway layer)
 *
 * For single-instance deployments (current prod) this is fine.
 */
@Injectable()
export class RateLimitService {
  private buckets = new Map<string, RateLimitBucket>();

  // Clean up old buckets every 5 minutes (lazy-initialized to avoid leaking in tests)
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  private ensureCleanupInterval(): void {
    if (!this.cleanupInterval) {
      this.cleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [key, bucket] of this.buckets) {
          if (now - bucket.lastRefill > 120_000) {
            this.buckets.delete(key);
          }
        }
      }, 300_000);
    }
  }

  /**
   * Check if a request is allowed under rate limit.
   * Returns { allowed, retryAfterMs }
   */
  consume(
    key: string,
    limit: number,
    windowMs: number = 60_000,
  ): { allowed: boolean; retryAfterMs: number; remaining: number } {
    this.ensureCleanupInterval();
    const now = Date.now();
    const bucketKey = `${key}:${limit}`;
    let bucket = this.buckets.get(bucketKey);

    if (!bucket) {
      bucket = { tokens: limit, lastRefill: now };
      this.buckets.set(bucketKey, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    const refillRate = limit / windowMs; // tokens per ms
    const tokensToAdd = elapsed * refillRate;
    bucket.tokens = Math.min(limit, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return {
        allowed: true,
        retryAfterMs: 0,
        remaining: Math.floor(bucket.tokens),
      };
    }

    // Calculate when next token available
    const deficit = 1 - bucket.tokens;
    const retryAfterMs = Math.ceil(deficit / refillRate);
    return { allowed: false, retryAfterMs, remaining: 0 };
  }

  /** Reset all buckets (for testing) */
  reset(): void {
    this.buckets.clear();
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
