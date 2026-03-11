import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RerankService } from './rerank.service';

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('RerankService', () => {
  let service: RerankService;

  const buildModule = async (config: Record<string, string> = {}) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RerankService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              return config[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    return module.get<RerankService>(RerankService);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    service = await buildModule({
      RERANK_ENABLED: 'true',
      RERANK_URL: 'http://localhost:8081',
    });
  });

  describe('rerank', () => {
    it('should reorder results by cross-encoder score', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [
          { index: 2, score: 0.95 },
          { index: 0, score: 0.80 },
          { index: 1, score: 0.30 },
        ],
      });

      const results = await service.rerank('what is my dog name', [
        'User likes cats',
        'User lives in NYC',
        'User dog is named Max',
      ]);

      expect(results).toEqual([
        { index: 2, score: 0.95 },
        { index: 0, score: 0.80 },
        { index: 1, score: 0.30 },
      ]);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8081/rerank',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: 'what is my dog name',
            texts: [
              'User likes cats',
              'User lives in NYC',
              'User dog is named Max',
            ],
          }),
        }),
      );
    });

    it('should return original order when RERANK_ENABLED=false', async () => {
      service = await buildModule({ RERANK_ENABLED: 'false' });

      const results = await service.rerank('query', ['text1', 'text2']);

      expect(results).toEqual([
        { index: 0, score: 0 },
        { index: 1, score: 0 },
      ]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return original order when endpoint is down', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const results = await service.rerank('query', ['text1', 'text2']);

      expect(results).toEqual([
        { index: 0, score: 0 },
        { index: 1, score: 0 },
      ]);
    });

    it('should return original order on non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const results = await service.rerank('query', ['text1']);

      expect(results).toEqual([{ index: 0, score: 0 }]);
    });

    it('should handle empty input', async () => {
      const results = await service.rerank('query', []);
      expect(results).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should timeout after 2 seconds and return original order', async () => {
      mockFetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 5000)),
      );

      const results = await service.rerank('query', ['text1', 'text2']);

      expect(results).toEqual([
        { index: 0, score: 0 },
        { index: 1, score: 0 },
      ]);
    }, 10000);
  });

  describe('isAvailable', () => {
    it('should return true when health endpoint is ok', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const result = await service.isAvailable();
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8081/health',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should return false when health endpoint fails', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await service.isAvailable();
      expect(result).toBe(false);
    });

    it('should return false when RERANK_ENABLED=false', async () => {
      service = await buildModule({ RERANK_ENABLED: 'false' });

      const result = await service.isAvailable();
      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
