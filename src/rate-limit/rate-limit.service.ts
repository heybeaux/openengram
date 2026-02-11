import { Injectable } from '@nestjs/common';

interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
}

@Injectable()
export class RateLimitService {
  private buckets = new Map<string, RateLimitBucket>();

  // Clean up old buckets every 5 minutes
  private cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefill > 120_000) {
        this.buckets.delete(key);
      }
    }
  }, 300_000);

  /**
   * Check if a request is allowed under rate limit.
   * Returns { allowed, retryAfterMs }
   */
  consume(
    key: string,
    limit: number,
    windowMs: number = 60_000,
  ): { allowed: boolean; retryAfterMs: number; remaining: number } {
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
    clearInterval(this.cleanupInterval);
  }
}
