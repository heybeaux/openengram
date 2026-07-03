import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmbeddingProvider } from './embedding-provider.interface';

/**
 * OpenAI Embedding Provider
 *
 * Uses OpenAI's embeddings API (text-embedding-3-small by default).
 * Requires OPENAI_API_KEY env var.
 */
@Injectable()
export class OpenAIEmbedProvider implements EmbeddingProvider {
  readonly name = 'openai';
  private readonly logger = new Logger(OpenAIEmbedProvider.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly dimensions: number;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('OPENAI_API_KEY', '');
    this.model = this.configService.get<string>(
      'OPENAI_EMBED_MODEL',
      'text-embedding-3-small',
    );
    this.baseUrl = this.configService.get<string>(
      'OPENAI_BASE_URL',
      'https://api.openai.com',
    );
    // text-embedding-3-small = 1536, text-embedding-3-large = 3072
    this.dimensions = this.configService.get<number>(
      'OPENAI_EMBED_DIMENSIONS',
      1536,
    );
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) {
      throw new Error(
        'OPENAI_API_KEY is required for OpenAI embedding provider',
      );
    }

    const response = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `OpenAI embedding API error: ${response.status} - ${error}`,
      );
    }

    const data = await response.json();

    if (!data.data || !Array.isArray(data.data)) {
      throw new Error('Invalid response from OpenAI embedding API');
    }

    // OpenAI returns data sorted by index
    return data.data
      .sort((a: any, b: any) => a.index - b.index)
      .map((item: any) => item.embedding);
  }

  getModelName(): string {
    return this.model;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.apiKey) return false;
      const result = await this.embed(['health check']);
      return result.length > 0 && result[0].length > 0;
    } catch {
      return false;
    }
  }
}
