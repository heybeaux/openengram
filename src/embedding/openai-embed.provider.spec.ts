import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbedProvider } from './openai-embed.provider';

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

const mockConfig = {
  get: jest.fn((key: string, defaultValue?: any) => {
    const config: Record<string, any> = {
      OPENAI_API_KEY: 'sk-test-key',
      OPENAI_EMBED_MODEL: 'text-embedding-3-small',
      OPENAI_BASE_URL: 'https://api.openai.com',
      OPENAI_EMBED_DIMENSIONS: 1536,
    };
    return config[key] ?? defaultValue;
  }),
};

describe('OpenAIEmbedProvider', () => {
  let provider: OpenAIEmbedProvider;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenAIEmbedProvider,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    provider = module.get<OpenAIEmbedProvider>(OpenAIEmbedProvider);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
    expect(provider.name).toBe('openai');
  });

  it('should return model name and dimensions', () => {
    expect(provider.getModelName()).toBe('text-embedding-3-small');
    expect(provider.getDimensions()).toBe(1536);
  });

  describe('embed', () => {
    it('should embed texts with authorization header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { index: 0, embedding: [0.1, 0.2, 0.3] },
            { index: 1, embedding: [0.4, 0.5, 0.6] },
          ],
        }),
      });

      const result = await provider.embed(['hello', 'world']);
      expect(result).toEqual([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ]);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer sk-test-key',
          },
        }),
      );
    });

    it('should sort results by index', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { index: 1, embedding: [0.4, 0.5] },
            { index: 0, embedding: [0.1, 0.2] },
          ],
        }),
      });

      const result = await provider.embed(['a', 'b']);
      expect(result).toEqual([
        [0.1, 0.2],
        [0.4, 0.5],
      ]);
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(provider.embed(['test'])).rejects.toThrow(
        'OpenAI embedding API error: 401',
      );
    });
  });

  describe('healthCheck', () => {
    it('should return true when API is reachable', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ index: 0, embedding: [0.1] }],
        }),
      });

      const result = await provider.healthCheck();
      expect(result).toBe(true);
    });

    it('should return false on error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await provider.healthCheck();
      expect(result).toBe(false);
    });
  });

  describe('without API key', () => {
    beforeEach(async () => {
      jest.clearAllMocks();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OpenAIEmbedProvider,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue?: any) => defaultValue),
            },
          },
        ],
      }).compile();

      provider = module.get<OpenAIEmbedProvider>(OpenAIEmbedProvider);
    });

    it('should throw when embedding without API key', async () => {
      await expect(provider.embed(['test'])).rejects.toThrow(
        'OPENAI_API_KEY is required',
      );
    });

    it('should return false for healthCheck without API key', async () => {
      const result = await provider.healthCheck();
      expect(result).toBe(false);
    });
  });
});
