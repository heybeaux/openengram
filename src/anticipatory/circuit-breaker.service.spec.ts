import { CircuitBreakerService } from './circuit-breaker.service';
import { AnticipatoryConfig } from './anticipatory.config';

describe('CircuitBreakerService', () => {
  let breaker: CircuitBreakerService;

  beforeEach(() => {
    (AnticipatoryConfig.circuitBreaker as any) = {
      p95ThresholdMs: 200,
      cooldownMs: 1000,
      windowMs: 5000,
      minSamples: 5,
    };
    breaker = new CircuitBreakerService();
  });

  it('should start in closed state (allowed)', () => {
    expect(breaker.isAllowed()).toBe(true);
    expect(breaker.isOpen).toBe(false);
  });

  it('should stay closed with normal latencies', () => {
    for (let i = 0; i < 10; i++) {
      breaker.record(50);
    }
    expect(breaker.isAllowed()).toBe(true);
  });

  it('should trip when p95 exceeds threshold', () => {
    // 4 fast, 1 slow = p95 will be the slow one
    breaker.record(50);
    breaker.record(50);
    breaker.record(50);
    breaker.record(50);
    breaker.record(300); // Above 200ms threshold

    expect(breaker.isOpen).toBe(true);
    expect(breaker.isAllowed()).toBe(false);
  });

  it('should not trip with insufficient samples', () => {
    // Only 3 samples, min is 5
    breaker.record(300);
    breaker.record(300);
    breaker.record(300);

    expect(breaker.isAllowed()).toBe(true);
  });

  it('should reset after cooldown', async () => {
    // Trip the breaker
    for (let i = 0; i < 5; i++) {
      breaker.record(300);
    }
    expect(breaker.isOpen).toBe(true);

    // Override cooldown for test speed
    (AnticipatoryConfig.circuitBreaker as any).cooldownMs = 50;

    // Wait for cooldown
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(breaker.isAllowed()).toBe(true);
  });
});
