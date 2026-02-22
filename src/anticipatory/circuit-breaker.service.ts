import { Injectable, Logger } from '@nestjs/common';
import { AnticipatoryConfig } from './anticipatory.config';

/**
 * Circuit Breaker for Anticipatory Recall
 *
 * Monitors ARE latency and disables it when performance degrades.
 * Prevents ARE from making a slow database worse by piling on queries.
 *
 * States:
 * - CLOSED (normal): ARE runs normally, latencies are recorded
 * - OPEN (tripped): ARE is disabled, returns empty results
 * - After cooldown: automatically resets to CLOSED
 */
@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);

  private latencies: Array<{ ms: number; at: number }> = [];
  private openedAt: number | null = null;

  /**
   * Check if ARE should run. Returns false if circuit is open.
   */
  isAllowed(): boolean {
    if (this.openedAt === null) return true;

    // Check if cooldown has elapsed
    const elapsed = Date.now() - this.openedAt;
    if (elapsed >= AnticipatoryConfig.circuitBreaker.cooldownMs) {
      this.logger.log('Circuit breaker reset — ARE re-enabled');
      this.openedAt = null;
      this.latencies = [];
      return true;
    }

    return false;
  }

  /**
   * Record a latency sample and check if circuit should trip.
   */
  record(latencyMs: number): void {
    const now = Date.now();
    this.latencies.push({ ms: latencyMs, at: now });

    // Prune old samples outside the window
    const windowStart = now - AnticipatoryConfig.circuitBreaker.windowMs;
    this.latencies = this.latencies.filter((l) => l.at >= windowStart);

    // Check if we should trip
    if (this.latencies.length >= AnticipatoryConfig.circuitBreaker.minSamples) {
      const p95 = this.computeP95();
      if (p95 > AnticipatoryConfig.circuitBreaker.p95ThresholdMs) {
        this.logger.warn(
          `Circuit breaker TRIPPED — p95 latency ${p95}ms > ${AnticipatoryConfig.circuitBreaker.p95ThresholdMs}ms threshold. ` +
          `ARE disabled for ${AnticipatoryConfig.circuitBreaker.cooldownMs / 1000}s`,
        );
        this.openedAt = now;
      }
    }
  }

  /**
   * Whether the circuit is currently open (tripped).
   */
  get isOpen(): boolean {
    return this.openedAt !== null && !this.isAllowed();
  }

  private computeP95(): number {
    if (this.latencies.length === 0) return 0;
    const sorted = this.latencies.map((l) => l.ms).sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * 0.95) - 1;
    return sorted[Math.min(index, sorted.length - 1)];
  }
}
