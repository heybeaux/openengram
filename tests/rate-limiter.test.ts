import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, resetRateLimits } from '../src/security/rate-limiter.js';

describe('rate limiter', () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it('allows requests within limit', () => {
    for (let i = 0; i < 10; i++) {
      expect(() => checkRateLimit('forget')).not.toThrow();
    }
  });

  it('blocks requests over limit', () => {
    for (let i = 0; i < 10; i++) {
      checkRateLimit('forget');
    }
    expect(() => checkRateLimit('forget')).toThrow('Rate limit exceeded');
  });

  it('allows unknown operations', () => {
    expect(() => checkRateLimit('unknown_op')).not.toThrow();
  });
});
