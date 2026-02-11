import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LLMService } from './llm.service';

describe('LLMService', () => {
  let service: LLMService;
  let mockConfigService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn((key: string) => {
        const config: Record<string, string> = {
          LLM_PROVIDER: 'openai',
          LLM_MODEL: 'gpt-4o-mini',
          EMBEDDING_PROVIDER: 'openai',
          OPENAI_API_KEY: 'sk-test-openai-key',
          ANTHROPIC_API_KEY: 'sk-test-anthropic-key',
        };
        return config[key];
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LLMService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<LLMService>(LLMService);
  });

  describe('initialization', () => {
    it('should initialize with configured providers', () => {
      const providers = service.listProviders();

      expect(providers).toContain('openai');
      expect(providers).toContain('anthropic');
      expect(providers).toContain('ollama');
      expect(providers).toContain('lmstudio');
    });

    it('should throw if no LLM provider is configured', async () => {
      const emptyConfigService = {
        get: jest.fn().mockReturnValue(undefined),
      } as any;

      await expect(
        Test.createTestingModule({
          providers: [
            LLMService,
            { provide: ConfigService, useValue: emptyConfigService },
          ],
        }).compile(),
      ).rejects.toThrow('No LLM provider configured');
    });
  });

  describe('getProvider', () => {
    it('should return openai provider', () => {
      const provider = service.getProvider('openai');
      expect(provider).toBeDefined();
      expect(provider?.name).toBe('openai');
    });

    it('should return anthropic provider', () => {
      const provider = service.getProvider('anthropic');
      expect(provider).toBeDefined();
      expect(provider?.name).toBe('anthropic');
    });

    it('should return ollama provider', () => {
      const provider = service.getProvider('ollama');
      expect(provider).toBeDefined();
      expect(provider?.name).toBe('ollama');
    });

    it('should return lmstudio provider', () => {
      const provider = service.getProvider('lmstudio');
      expect(provider).toBeDefined();
      expect(provider?.name).toBe('lmstudio');
    });

    it('should return undefined for unknown provider', () => {
      const provider = service.getProvider('unknown-provider');
      expect(provider).toBeUndefined();
    });
  });

  describe('listProviders', () => {
    it('should list all registered providers', () => {
      const providers = service.listProviders();

      expect(providers).toBeInstanceOf(Array);
      expect(providers.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('listEmbeddingProviders', () => {
    it('should list providers that support embeddings', () => {
      const embeddingProviders = service.listEmbeddingProviders();

      // OpenAI and Ollama support embeddings
      expect(embeddingProviders).toContain('openai');
    });

    it('should not include providers that do not support embeddings', () => {
      const embeddingProviders = service.listEmbeddingProviders();

      // Anthropic doesn't support embeddings directly
      expect(embeddingProviders).not.toContain('anthropic');
    });
  });

  describe('chat', () => {
    it('should call default provider for chat', async () => {
      const mockProvider = service.getProvider('openai');
      if (mockProvider) {
        jest.spyOn(mockProvider, 'chat').mockResolvedValue({
          content: 'Hello!',
          model: 'gpt-4o-mini',
          // tokensUsed: 10,
        });
      }

      const result = await service.chat([
        { role: 'user', content: 'Hi' },
      ]);

      expect(result.content).toBe('Hello!');
    });

    it('should use specified provider when given', async () => {
      const anthropicProvider = service.getProvider('anthropic');
      if (anthropicProvider) {
        jest.spyOn(anthropicProvider, 'chat').mockResolvedValue({
          content: 'Claude here!',
          model: 'claude-3-5-sonnet',
          // tokensUsed: 15,
        });
      }

      const result = await service.chat(
        [{ role: 'user', content: 'Hi' }],
        { provider: 'anthropic' },
      );

      expect(result.content).toBe('Claude here!');
    });

    it('should fallback to default provider for unknown provider', async () => {
      const defaultProvider = service.getProvider('openai');
      if (defaultProvider) {
        jest.spyOn(defaultProvider, 'chat').mockResolvedValue({
          content: 'Fallback response',
          model: 'gpt-4o-mini',
          // tokensUsed: 5,
        });
      }

      const result = await service.chat(
        [{ role: 'user', content: 'Hi' }],
        { provider: 'nonexistent' as any },
      );

      expect(result.content).toBe('Fallback response');
    });
  });

  describe('json', () => {
    it('should parse JSON response from provider', async () => {
      const mockProvider = service.getProvider('openai');
      if (mockProvider) {
        jest.spyOn(mockProvider, 'json').mockResolvedValue({
          name: 'John',
          age: 30,
        });
      }

      const result = await service.json<{ name: string; age: number }>(
        [{ role: 'user', content: 'Give me JSON' }],
      );

      expect(result.name).toBe('John');
      expect(result.age).toBe(30);
    });

    it('should pass schema to provider', async () => {
      const mockProvider = service.getProvider('openai');
      const schema = { type: 'object', properties: { name: { type: 'string' } } };

      if (mockProvider) {
        const jsonSpy = jest.spyOn(mockProvider, 'json').mockResolvedValue({ name: 'Test' });

        await service.json([{ role: 'user', content: 'test' }], schema);

        expect(jsonSpy).toHaveBeenCalledWith(
          expect.any(Array),
          schema,
          undefined, // options are optional
        );
      }
    });
  });

  describe('embed', () => {
    it('should generate embeddings using embedding provider', async () => {
      const mockProvider = service.getProvider('openai');
      if (mockProvider) {
        jest.spyOn(mockProvider, 'embed').mockResolvedValue({
          embedding: [0.1, 0.2, 0.3],
          dimensions: 1536,
          model: 'text-embedding-3-small',
          // tokensUsed: 5,
        });
      }

      const result = await service.embed('test text');

      expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
      expect(result.dimensions).toBe(1536);
    });

    it('should throw if provider does not support embeddings', async () => {
      const anthropicProvider = service.getProvider('anthropic');
      if (anthropicProvider) {
        jest.spyOn(anthropicProvider, 'supportsEmbeddings').mockReturnValue(false);
      }

      await expect(
        service.embed('test', { provider: 'anthropic' }),
      ).rejects.toThrow('does not support embeddings');
    });

    it('should use specified embedding provider', async () => {
      const ollamaProvider = service.getProvider('ollama');
      if (ollamaProvider) {
        jest.spyOn(ollamaProvider, 'supportsEmbeddings').mockReturnValue(true);
        jest.spyOn(ollamaProvider, 'embed').mockResolvedValue({
          embedding: [0.5, 0.6],
          dimensions: 768,
          model: 'nomic-embed-text',
          // tokensUsed: 3,
        });
      }

      const result = await service.embed('test', { provider: 'ollama' });

      expect(result.dimensions).toBe(768);
    });
  });
});

describe('LLMService with Ollama only', () => {
  it('should work with only Ollama configured', async () => {
    const ollamaOnlyConfig = {
      get: jest.fn((key: string) => {
        const config: Record<string, string> = {
          LLM_PROVIDER: 'ollama',
          LLM_MODEL: 'llama3.2',
          EMBEDDING_PROVIDER: 'ollama',
          OLLAMA_URL: 'http://localhost:11434',
        };
        return config[key];
      }),
    } as any;

    const module = await Test.createTestingModule({
      providers: [
        LLMService,
        { provide: ConfigService, useValue: ollamaOnlyConfig },
      ],
    }).compile();

    const service = module.get<LLMService>(LLMService);

    expect(service.listProviders()).toContain('ollama');
  });
});

describe('LLMService with LM Studio only', () => {
  it('should work with only LM Studio configured', async () => {
    const lmstudioOnlyConfig = {
      get: jest.fn((key: string) => {
        const config: Record<string, string> = {
          LLM_PROVIDER: 'lmstudio',
          LLM_MODEL: 'local-model',
          EMBEDDING_PROVIDER: 'lmstudio',
          LMSTUDIO_URL: 'http://localhost:1234',
        };
        return config[key];
      }),
    } as any;

    const module = await Test.createTestingModule({
      providers: [
        LLMService,
        { provide: ConfigService, useValue: lmstudioOnlyConfig },
      ],
    }).compile();

    const service = module.get<LLMService>(LLMService);

    expect(service.listProviders()).toContain('lmstudio');
  });
});
