import { ConfigService } from '@nestjs/config';
import { RateLimitService } from './rate-limit.service';

/**
 * Tests run without Redis (REDIS_URL not set), so they exercise
 * the in-memory fallback path. The public API is now async to
 * support the Redis backend, so all consume() calls are awaited.
 */
describe('RateLimitService', () => {
  let service: RateLimitService;

  beforeEach(() => {
    const configService = {
      get: jest.fn().mockReturnValue(undefined), // no REDIS_URL
    } as unknown as ConfigService;
    service = new RateLimitService(configService);
  });

  afterEach(async () => {
    await service.reset();
    await service.onModuleDestroy();
  });

  it('should allow requests within the limit', async () => {
    for (let i = 0; i < 5; i++) {
      const result = await service.consume('test-key', 5);
      expect(result.allowed).toBe(true);
    }
  });

  it('should reject requests exceeding the limit', async () => {
    for (let i = 0; i < 5; i++) {
      await service.consume('test-key', 5);
    }

    const result = await service.consume('test-key', 5);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.remaining).toBe(0);
  });

  it('should track remaining tokens', async () => {
    const r1 = await service.consume('test-key', 3);
    expect(r1.remaining).toBe(2);

    const r2 = await service.consume('test-key', 3);
    expect(r2.remaining).toBe(1);

    const r3 = await service.consume('test-key', 3);
    expect(r3.remaining).toBe(0);
  });

  it('should isolate different keys', async () => {
    for (let i = 0; i < 2; i++) {
      await service.consume('key-a', 2);
    }
    const resultA = await service.consume('key-a', 2);
    expect(resultA.allowed).toBe(false);

    const resultB = await service.consume('key-b', 2);
    expect(resultB.allowed).toBe(true);
  });

  it('should refill tokens over time', async () => {
    for (let i = 0; i < 5; i++) {
      await service.consume('test-key', 5, 1000);
    }

    expect((await service.consume('test-key', 5, 1000)).allowed).toBe(false);

    // Manually advance lastRefill to simulate time passing
    const bucket = (service as any).buckets.get('test-key:5');
    bucket.lastRefill = Date.now() - 1000;

    const result = await service.consume('test-key', 5, 1000);
    expect(result.allowed).toBe(true);
  });

  it('should return retryAfterMs when rate limited', async () => {
    for (let i = 0; i < 3; i++) {
      await service.consume('test-key', 3, 60000);
    }

    const result = await service.consume('test-key', 3, 60000);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.retryAfterMs).toBeLessThanOrEqual(60000);
  });

  it('should reset all buckets', async () => {
    await service.consume('key-1', 1);
    await service.consume('key-1', 1);
    expect((await service.consume('key-1', 1)).allowed).toBe(false);

    await service.reset();

    expect((await service.consume('key-1', 1)).allowed).toBe(true);
  });
});
