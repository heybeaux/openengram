import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface RerankResult {
  index: number;
  score: number;
}

@Injectable()
export class RerankService {
  private readonly logger = new Logger(RerankService.name);
  private readonly rerankUrl: string;
  private readonly enabled: boolean;
  private readonly timeoutMs = 2000;

  constructor(private configService: ConfigService) {
    this.rerankUrl = this.configService.get<string>(
      'RERANK_URL',
      'http://localhost:8081',
    );
    this.enabled =
      this.configService.get<string>('RERANK_ENABLED', 'false') === 'true';
  }

  /**
   * Rerank texts by relevance to a query using a cross-encoder model.
   * Returns indices reordered by cross-encoder score (descending).
   * Gracefully falls back to original order on failure.
   */
  async rerank(query: string, texts: string[]): Promise<RerankResult[]> {
    if (!this.enabled) {
      this.logger.debug('[Rerank] Disabled via RERANK_ENABLED=false, skipping');
      return texts.map((_, index) => ({ index, score: 0 }));
    }

    if (texts.length === 0) {
      return [];
    }

    const start = Date.now();

    try {
      const response = await Promise.race([
        fetch(`${this.rerankUrl}/rerank`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, texts }),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Rerank request timed out')), this.timeoutMs),
        ),
      ]);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Rerank API error: ${response.status} - ${error}`);
      }

      const results: RerankResult[] = await response.json();
      const latencyMs = Date.now() - start;
      this.logger.debug(`[Rerank] Completed in ${latencyMs}ms for ${texts.length} candidates`);

      return results;
    } catch (error) {
      const latencyMs = Date.now() - start;
      this.logger.warn(
        `[Rerank] Failed after ${latencyMs}ms, returning original order: ${(error as Error).message}`,
      );
      return texts.map((_, index) => ({ index, score: 0 }));
    }
  }

  /**
   * Check if the reranker endpoint is reachable.
   */
  async isAvailable(): Promise<boolean> {
    if (!this.enabled) return false;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`${this.rerankUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }
}
