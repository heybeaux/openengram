import OpenAI from 'openai';
import { EmbeddingProvider } from '../embedding-provider.interface';

export interface OpenAIEmbeddingConfig {
  apiKey: string;
  model: string;
  dimensions: number;
  name: string;
}

/**
 * OpenAI Cloud Embedding Provider
 *
 * Wraps OpenAI SDK for text-embedding-3-small (1536d) and
 * text-embedding-3-large (3072d). Implements EmbeddingProvider
 * so it can be used by CloudEnsembleService.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly dimensions: number;

  constructor(config: OpenAIEmbeddingConfig) {
    this.name = config.name;
    this.model = config.model;
    this.dimensions = config.dimensions;
    this.client = new OpenAI({ apiKey: config.apiKey });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      input: texts,
      model: this.model,
    });

    return response.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }

  getModelName(): string {
    return this.model;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.embed(['health check']);
      return result.length > 0 && result[0].length > 0;
    } catch {
      return false;
    }
  }
}
