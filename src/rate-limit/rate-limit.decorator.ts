import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

/**
 * Set a custom rate limit for a route (requests per minute).
 * If not set, the default of 100/min applies.
 * Use @SkipRateLimit() to bypass entirely.
 */
export const RateLimit = (requestsPerMinute: number) =>
  SetMetadata(RATE_LIMIT_KEY, requestsPerMinute);

export const SKIP_RATE_LIMIT_KEY = 'skipRateLimit';

/**
 * Skip rate limiting for this route entirely (e.g., health checks).
 */
export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT_KEY, true);
