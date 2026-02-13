import { Injectable, Logger } from '@nestjs/common';
import { EmbeddingService } from '../embedding/embedding.service';

export interface EmbedHealthStatus {
  status: 'up' | 'down';
  latencyMs: number | null;
  lastChecked: Date;
  lastUp: Date | null;
}

/**
 * Cached health check for embedding service.
 * - Caches status for 30 seconds
 * - Logs state changes once (not every request)
 */
@Injectable()
export class EmbedHealthService {
  private readonly logger = new Logger(EmbedHealthService.name);
  private readonly cacheTtlMs = 30_000;

  private cachedStatus: EmbedHealthStatus | null = null;
  private lastLoggedStatus: 'up' | 'down' | null = null;

  constructor(private embeddingService: EmbeddingService) {}

  /**
   * Get embed health status (cached for 30s)
   */
  async getStatus(): Promise<EmbedHealthStatus> {
    if (
      this.cachedStatus &&
      Date.now() - this.cachedStatus.lastChecked.getTime() < this.cacheTtlMs
    ) {
      return this.cachedStatus;
    }
    return this.refresh();
  }

  /**
   * Check if embed is currently available (uses cache)
   */
  async isAvailable(): Promise<boolean> {
    const status = await this.getStatus();
    return status.status === 'up';
  }

  /**
   * Force a fresh health check
   */
  async refresh(): Promise<EmbedHealthStatus> {
    const start = Date.now();
    let status: EmbedHealthStatus;

    try {
      const isHealthy = await this.embeddingService.healthCheck();
      const latencyMs = Date.now() - start;

      status = {
        status: isHealthy ? 'up' : 'down',
        latencyMs: isHealthy ? latencyMs : null,
        lastChecked: new Date(),
        lastUp: isHealthy ? new Date() : (this.cachedStatus?.lastUp ?? null),
      };
    } catch {
      status = {
        status: 'down',
        latencyMs: null,
        lastChecked: new Date(),
        lastUp: this.cachedStatus?.lastUp ?? null,
      };
    }

    // Log state changes only once
    if (this.lastLoggedStatus !== status.status) {
      if (status.status === 'down') {
        this.logger.warn(
          'Embedding service is DOWN — memories will be created without embeddings',
        );
      } else {
        this.logger.log('Embedding service is UP');
      }
      this.lastLoggedStatus = status.status;
    }

    this.cachedStatus = status;
    return status;
  }
}
