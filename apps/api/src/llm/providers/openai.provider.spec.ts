import { OpenAIProvider } from './openai.provider';
import { LLMConfig } from '../llm.interface';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;
  const config: LLMConfig = {
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: 'sk-test-key',
  };

  beforeEach(() => {
    provider = new OpenAIProvider(config);
    mockFetch.mockReset();
  });

  describe('constructor', () => {
    it('should throw if no API key provided', () => {
      expect(
        () => new OpenAIProvider({ provider: 'openai', model: 'gpt-4o-mini' }),
      ).toThrow('OpenAI provider requires an API key');
    });

    it('should use default base URL', () => {
      expect(provider.name).toBe('openai');
    });

    it('should accept custom base URL', () => {
      const customProvider = new OpenAIProvider({
        ...config,
        baseUrl: 'https://custom.api.com/v1',
      });
      expect(customProvider.name).toBe('openai');
    });
  });

  describe('chat', () => {
    it('should call OpenAI chat completions API', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hello!' } }],
          model: 'gpt-4o-mini',
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
      });

      const result = await provider.chat([{ role: 'user', content: 'Hi' }]);

      expect(result.content).toBe('Hello!');
      expect(result.model).toBe('gpt-4o-mini');
      expect(result.usage?.totalTokens).toBe(8);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-test-key',
          }),
        }),
      );
    });

    it('should use custom model from options', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }],
          model: 'gpt-4o',
          usage: {},
        }),
      });

      await provider.chat([{ role: 'user', content: 'Hi' }], {
        model: 'gpt-4o',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('gpt-4o');
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Rate limited',
      });

      await expect(
        provider.chat([{ role: 'user', content: 'Hi' }]),
      ).rejects.toThrow('OpenAI API error: 429 - Rate limited');
    });

    it('should handle empty choices gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '' } }],
          model: 'gpt-4o-mini',
          usage: {},
        }),
      });

      const result = await provider.chat([{ role: 'user', content: 'Hi' }]);
      expect(result.content).toBe('');
    });

    it('should pass temperature and maxTokens', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Ok' } }],
          model: 'gpt-4o-mini',
          usage: {},
        }),
      });

      await provider.chat([{ role: 'user', content: 'Hi' }], {
        temperature: 0.2,
        maxTokens: 100,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.temperature).toBe(0.2);
      expect(body.max_tokens).toBe(100);
    });
  });

  describe('json', () => {
    it('should parse JSON response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"name":"Alice","age":30}' } }],
          model: 'gpt-4o-mini',
        }),
      });

      const result = await provider.json<{ name: string; age: number }>([
        { role: 'user', content: 'Give JSON' },
      ]);

      expect(result.name).toBe('Alice');
      expect(result.age).toBe(30);
    });

    it('should request json_object response format', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{}' } }],
          model: 'gpt-4o-mini',
        }),
      });

      await provider.json([{ role: 'user', content: 'test' }]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.response_format).toEqual({ type: 'json_object' });
    });

    it('should throw on invalid JSON response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'not json' } }],
          model: 'gpt-4o-mini',
        }),
      });

      await expect(
        provider.json([{ role: 'user', content: 'test' }]),
      ).rejects.toThrow('Failed to parse JSON response');
    });

    it('should use lower default temperature for structured output', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{}' } }],
          model: 'gpt-4o-mini',
        }),
      });

      await provider.json([{ role: 'user', content: 'test' }]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.temperature).toBe(0.3);
    });
  });

  describe('embed', () => {
    it('should generate embeddings', async () => {
      const mockEmbedding = new Array(1536).fill(0.1);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ embedding: mockEmbedding }],
          model: 'text-embedding-3-small',
        }),
      });

      const result = await provider.embed('test text');

      expect(result.embedding).toEqual(mockEmbedding);
      expect(result.dimensions).toBe(1536);
      expect(result.model).toBe('text-embedding-3-small');
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(provider.embed('test')).rejects.toThrow(
        'OpenAI Embedding API error: 401 - Unauthorized',
      );
    });

    it('should throw when no embedding returned', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{}],
          model: 'text-embedding-3-small',
        }),
      });

      await expect(provider.embed('test')).rejects.toThrow(
        'No embedding returned from OpenAI',
      );
    });
  });

  describe('supportsEmbeddings', () => {
    it('should return true', () => {
      expect(provider.supportsEmbeddings()).toBe(true);
    });
  });
});
