/**
 * LLM Provider Interface
 *
 * Abstracts LLM operations so users can bring their own model:
 * - OpenAI (GPT-4, GPT-4o-mini, etc.)
 * - Anthropic (Claude 3.5 Sonnet, Claude 3 Haiku, etc.)
 * - Ollama (local models)
 * - LM Studio (local models)
 */

export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'ollama' | 'lmstudio' | 'local';
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface EmbeddingResponse {
  embedding: number[];
  model: string;
  dimensions: number;
}

/**
 * Abstract LLM provider interface
 * All providers must implement these methods
 */
export interface LLMProvider {
  /**
   * Provider identifier
   */
  readonly name: string;

  /**
   * Generate a chat completion
   */
  chat(
    messages: LLMMessage[],
    options?: Partial<LLMConfig>,
  ): Promise<LLMResponse>;

  /**
   * Generate a structured JSON response
   * Used for 5W1H extraction
   */
  json<T>(
    messages: LLMMessage[],
    schema?: object,
    options?: Partial<LLMConfig>,
  ): Promise<T>;

  /**
   * Generate an embedding vector
   * Not all providers support this — throws if unsupported
   */
  embed(text: string): Promise<EmbeddingResponse>;

  /**
   * Check if this provider supports embeddings
   */
  supportsEmbeddings(): boolean;
}

/**
 * Default models by provider
 */
export const DEFAULT_MODELS: Record<LLMConfig['provider'], string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-20241022',
  ollama: 'llama3.2',
  lmstudio: 'local-model',
  local: 'bge-base-en-v1.5', // embedding-only provider
};

/**
 * Default embedding models by provider
 */
export const DEFAULT_EMBEDDING_MODELS: Record<string, string> = {
  openai: 'text-embedding-3-small',
  local: 'bge-base-en-v1.5', // 768-dim local embeddings via engram-embed
};
