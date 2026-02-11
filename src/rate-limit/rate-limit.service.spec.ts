import { RateLimitService } from './rate-limit.service';

describe('RateLimitService', () => {
  let service: RateLimitService;

  beforeEach(() => {
    service = new RateLimitService();
  });

  afterEach(() => {
    service.reset();
    // Clear the cleanup interval
    (service as any).onModuleDestroy?.();
  });

  it('should allow requests within the limit', () => {
    for (let i = 0; i < 5; i++) {
      const result = service.consume('test-key', 5);
      expect(result.allowed).toBe(true);
    }
  });

  it('should reject requests exceeding the limit', () => {
    // Consume all tokens
    for (let i = 0; i < 5; i++) {
      service.consume('test-key', 5);
    }

    const result = service.consume('test-key', 5);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.remaining).toBe(0);
  });

  it('should track remaining tokens', () => {
    const r1 = service.consume('test-key', 3);
    expect(r1.remaining).toBe(2);

    const r2 = service.consume('test-key', 3);
    expect(r2.remaining).toBe(1);

    const r3 = service.consume('test-key', 3);
    expect(r3.remaining).toBe(0);
  });

  it('should isolate different keys', () => {
    // Exhaust key A
    for (let i = 0; i < 2; i++) {
      service.consume('key-a', 2);
    }
    const resultA = service.consume('key-a', 2);
    expect(resultA.allowed).toBe(false);

    // Key B should still work
    const resultB = service.consume('key-b', 2);
    expect(resultB.allowed).toBe(true);
  });

  it('should refill tokens over time', () => {
    // Consume all tokens
    for (let i = 0; i < 5; i++) {
      service.consume('test-key', 5, 1000); // 5 per second for fast test
    }

    // Should be blocked
    expect(service.consume('test-key', 5, 1000).allowed).toBe(false);

    // Manually advance lastRefill to simulate time passing
    const bucket = (service as any).buckets.get('test-key:5');
    bucket.lastRefill = Date.now() - 1000; // 1 second ago

    // Should now have tokens
    const result = service.consume('test-key', 5, 1000);
    expect(result.allowed).toBe(true);
  });

  it('should return retryAfterMs when rate limited', () => {
    for (let i = 0; i < 3; i++) {
      service.consume('test-key', 3, 60000); // 3 per minute
    }

    const result = service.consume('test-key', 3, 60000);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.retryAfterMs).toBeLessThanOrEqual(60000);
  });

  it('should reset all buckets', () => {
    service.consume('key-1', 1);
    service.consume('key-1', 1);
    expect(service.consume('key-1', 1).allowed).toBe(false);

    service.reset();

    expect(service.consume('key-1', 1).allowed).toBe(true);
  });
});
