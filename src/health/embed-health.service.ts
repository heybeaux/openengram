import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EmbedHealthStatus {
  status: 'up' | 'down';
  latencyMs: number | null;
  lastChecked: Date;
  lastUp: Date | null;
}

/**
 * Cached health check for engram-embed service.
 * - Caches status for 30 seconds
 * - Logs state changes once (not every request)
 */
@Injectable()
export class EmbedHealthService {
  private readonly logger = new Logger(EmbedHealthService.name);
  private readonly embedUrl: string;
  private readonly cacheTtlMs = 30_000;

  private cachedStatus: EmbedHealthStatus | null = null;
  private lastLoggedStatus: 'up' | 'down' | null = null;

  constructor(private configService: ConfigService) {
    this.embedUrl = this.configService.get<string>('LOCAL_EMBED_URL', 'http://127.0.0.1:8080');
  }

  /**
   * Get embed health status (cached for 30s)
   */
  async getStatus(): Promise<EmbedHealthStatus> {
    if (this.cachedStatus && Date.now() - this.cachedStatus.lastChecked.getTime() < this.cacheTtlMs) {
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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.embedUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      }).catch(() =>
        // /health might not exist, try a lightweight embeddings call
        fetch(`${this.embedUrl}/v1/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: 'health check', model: 'minilm' }),
          signal: controller.signal,
        }),
      );

      clearTimeout(timeout);

      const latencyMs = Date.now() - start;
      const isUp = response.ok;

      status = {
        status: isUp ? 'up' : 'down',
        latencyMs: isUp ? latencyMs : null,
        lastChecked: new Date(),
        lastUp: isUp ? new Date() : this.cachedStatus?.lastUp ?? null,
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
        this.logger.warn('engram-embed is DOWN — memories will be created without embeddings');
      } else {
        this.logger.log('engram-embed is UP');
      }
      this.lastLoggedStatus = status.status;
    }

    this.cachedStatus = status;
    return status;
  }
}
