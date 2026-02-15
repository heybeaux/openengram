import { Injectable, Logger } from '@nestjs/common';
import { EmbeddingProvider } from './embedding-provider.interface';
import { CloudEnsembleService } from './cloud-ensemble.service';

/**
 * Cloud Ensemble Embedding Provider
 *
 * Adapter that wraps CloudEnsembleService to implement the EmbeddingProvider
 * interface. Uses the primary model (openai-small) for single-vector operations
 * like memory creation and search.
 *
 * When EMBEDDING_PROVIDER=cloud-ensemble, this is selected as the active provider
 * in EmbeddingService, enabling cloud-based embeddings without a local embed server.
 */
@Injectable()
export class CloudEnsembleEmbedProvider implements EmbeddingProvider {
  readonly name = 'cloud-ensemble';
  private readonly logger = new Logger(CloudEnsembleEmbedProvider.name);
  private readonly primaryModel = 'openai-small';

  constructor(private readonly cloudEnsemble: CloudEnsembleService) {}

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (const text of texts) {
      // Use embedSingle for efficiency — only hits the primary model
      const result = await this.cloudEnsemble.embedSingle(
        text,
        this.primaryModel,
        'document',
      );
      results.push(result.embedding);
    }

    return results;
  }

  getModelName(): string {
    return `cloud-ensemble (${this.primaryModel})`;
  }

  getDimensions(): number {
    return 1536; // openai-small dimensions
  }

  async healthCheck(): Promise<boolean> {
    if (!this.cloudEnsemble.isAvailable()) {
      return false;
    }

    try {
      const response = await this.cloudEnsemble.embedAll('health check', 'document');
      return response.embeddings.length > 0;
    } catch (err) {
      this.logger.warn(`Health check failed: ${err}`);
      return false;
    }
  }
}
