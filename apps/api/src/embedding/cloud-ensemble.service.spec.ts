import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CloudEnsembleService } from './cloud-ensemble.service';

// Mock the provider imports
jest.mock('./providers', () => ({
  OpenAIEmbeddingProvider: jest.fn().mockImplementation((opts) => ({
    embed: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    getDimensions: jest.fn().mockReturnValue(opts.dimensions),
    setInputType: jest.fn(),
  })),
  CohereEmbeddingProvider: jest.fn().mockImplementation(() => ({
    embed: jest.fn().mockResolvedValue([[0.4, 0.5, 0.6]]),
    getDimensions: jest.fn().mockReturnValue(1024),
    setInputType: jest.fn(),
  })),
}));

describe('CloudEnsembleService', () => {
  let service: CloudEnsembleService;

  const createService = async (envOverrides: Record<string, string> = {}) => {
    const env: Record<string, string> = {
      EMBEDDING_PROVIDER: 'cloud-ensemble',
      OPENAI_API_KEY: 'sk-test',
      COHERE_API_KEY: 'cohere-test',
      ...envOverrides,
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CloudEnsembleService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, def?: string) => env[key] ?? def ?? ''),
          },
        },
      ],
    }).compile();
    return module.get<CloudEnsembleService>(CloudEnsembleService);
  };

  describe('initialization', () => {
    it('should not initialize when provider is not cloud-ensemble', async () => {
      service = await createService({ EMBEDDING_PROVIDER: 'local' });
      await service.onModuleInit();
      expect(service.isAvailable()).toBe(false);
    });

    it('should initialize with OpenAI and Cohere when both keys present', async () => {
      service = await createService();
      await service.onModuleInit();
      expect(service.isAvailable()).toBe(true);
      expect(service.getModelIds()).toEqual([
        'openai-small',
        'openai-large',
        'cohere-v3',
      ]);
    });

    it('should initialize with only OpenAI when Cohere key missing', async () => {
      service = await createService({ COHERE_API_KEY: '' });
      await service.onModuleInit();
      expect(service.isAvailable()).toBe(true);
      expect(service.getModelIds()).toEqual(['openai-small', 'openai-large']);
    });

    it('should not initialize without OpenAI key', async () => {
      service = await createService({ OPENAI_API_KEY: '' });
      await service.onModuleInit();
      expect(service.isAvailable()).toBe(false);
    });

    it('should only initialize once', async () => {
      service = await createService();
      await service.onModuleInit();
      const modelsBefore = service.getModelIds().length;
      await service.initialize();
      expect(service.getModelIds().length).toBe(modelsBefore);
    });
  });

  describe('embedSingle', () => {
    beforeEach(async () => {
      service = await createService();
      await service.onModuleInit();
    });

    it('should embed text with a specific model', async () => {
      const result = await service.embedSingle('hello', 'openai-small');
      expect(result.model).toBe('openai-small');
      expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should throw for unknown model', async () => {
      await expect(
        service.embedSingle('hello', 'nonexistent' as any),
      ).rejects.toThrow("model 'nonexistent' not found");
    });
  });

  describe('getModelsForCount', () => {
    beforeEach(async () => {
      service = await createService();
      await service.onModuleInit();
    });

    it('should return empty for count 0', () => {
      expect(service.getModelsForCount(0)).toEqual([]);
    });

    it('should return models in priority order', () => {
      const models = service.getModelsForCount(2);
      expect(models.map((m) => m.modelId)).toEqual([
        'openai-small',
        'openai-large',
      ]);
    });

    it('should cap at available models', () => {
      const models = service.getModelsForCount(10);
      expect(models.length).toBe(3);
    });
  });

  describe('embedAll', () => {
    beforeEach(async () => {
      service = await createService();
      await service.onModuleInit();
    });

    it('should embed with all models in parallel', async () => {
      const result = await service.embedAll('test text');
      expect(result.embeddings.length).toBe(3);
      expect(result.totalMs).toBeGreaterThanOrEqual(0);
      expect(result.errors).toBeUndefined();
    });

    it('should handle partial failures gracefully', async () => {
      // Override one provider to fail
      const provider = service.getProvider('openai-large');
      (provider!.embed as jest.Mock).mockRejectedValueOnce(
        new Error('rate limited'),
      );

      const result = await service.embedAll('test text');
      expect(result.embeddings.length).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].model).toBe('openai-large');
      expect(result.errors![0].recoverable).toBe(true);
    });
  });

  describe('embedAllForPlan', () => {
    beforeEach(async () => {
      service = await createService();
      await service.onModuleInit();
    });

    it('should return empty for 0 model count', async () => {
      const result = await service.embedAllForPlan('test', 0);
      expect(result.embeddings).toEqual([]);
    });

    it('should limit models based on plan count', async () => {
      const result = await service.embedAllForPlan('test', 1);
      expect(result.embeddings.length).toBe(1);
      expect(result.embeddings[0].model).toBe('openai-small');
    });
  });

  describe('embedBatch', () => {
    beforeEach(async () => {
      service = await createService();
      await service.onModuleInit();
    });

    it('should embed multiple texts', async () => {
      const provider = service.getProvider('openai-small');
      (provider!.embed as jest.Mock).mockResolvedValueOnce([
        [0.1, 0.2],
        [0.3, 0.4],
      ]);
      const result = await service.embedBatch(['a', 'b'], ['openai-small']);
      expect(result.embeddings.length).toBe(2);
    });

    it('should handle errors in batch', async () => {
      const provider = service.getProvider('openai-small');
      (provider!.embed as jest.Mock).mockRejectedValueOnce(new Error('quota'));
      const result = await service.embedBatch(['a'], ['openai-small']);
      expect(result.embeddings).toEqual([]);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('getProvider', () => {
    it('should return undefined for unknown model', async () => {
      service = await createService();
      await service.onModuleInit();
      expect(service.getProvider('unknown' as any)).toBeUndefined();
    });
  });
});
