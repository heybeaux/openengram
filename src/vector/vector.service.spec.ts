import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { VectorService } from './vector.service';
import { PgVectorProvider } from './providers/pgvector.provider';
import { PineconeProvider } from './providers/pinecone.provider';
import { VectorRecord, VectorSearchResult } from './vector.interface';

describe('VectorService', () => {
  let service: VectorService;
  let mockPgVector: jest.Mocked<PgVectorProvider>;
  let mockPinecone: jest.Mocked<PineconeProvider>;
  let mockConfigService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    mockPgVector = {
      name: 'pgvector',
      upsert: jest.fn(),
      upsertMany: jest.fn(),
      search: jest.fn(),
      delete: jest.fn(),
      deleteByUser: jest.fn(),
      isConfigured: jest.fn().mockReturnValue(true),
    } as any;

    mockPinecone = {
      name: 'pinecone',
      upsert: jest.fn(),
      upsertMany: jest.fn(),
      search: jest.fn(),
      delete: jest.fn(),
      deleteByUser: jest.fn(),
      isConfigured: jest.fn().mockReturnValue(false),
    } as any;

    mockConfigService = {
      get: jest.fn().mockReturnValue('pgvector'),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VectorService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PgVectorProvider, useValue: mockPgVector },
        { provide: PineconeProvider, useValue: mockPinecone },
      ],
    }).compile();

    service = module.get<VectorService>(VectorService);
  });

  describe('initialization', () => {
    it('should use pgvector as default provider', () => {
      expect(service.getProviderName()).toBe('pgvector');
    });

    it('should use pinecone when configured', async () => {
      mockConfigService.get.mockReturnValue('pinecone');
      mockPinecone.isConfigured.mockReturnValue(true);

      const module = await Test.createTestingModule({
        providers: [
          VectorService,
          { provide: ConfigService, useValue: mockConfigService },
          { provide: PgVectorProvider, useValue: mockPgVector },
          { provide: PineconeProvider, useValue: mockPinecone },
        ],
      }).compile();

      const pineconeService = module.get<VectorService>(VectorService);
      expect(pineconeService.getProviderName()).toBe('pinecone');
    });

    it('should fallback to pgvector if pinecone not configured', async () => {
      mockConfigService.get.mockReturnValue('pinecone');
      mockPinecone.isConfigured.mockReturnValue(false);

      const module = await Test.createTestingModule({
        providers: [
          VectorService,
          { provide: ConfigService, useValue: mockConfigService },
          { provide: PgVectorProvider, useValue: mockPgVector },
          { provide: PineconeProvider, useValue: mockPinecone },
        ],
      }).compile();

      const fallbackService = module.get<VectorService>(VectorService);
      expect(fallbackService.getProviderName()).toBe('pgvector');
    });
  });

  describe('getProviderName', () => {
    it('should return current provider name', () => {
      expect(service.getProviderName()).toBe('pgvector');
    });
  });

  describe('upsert', () => {
    it('should delegate to current provider', async () => {
      const record: VectorRecord = {
        id: 'mem-123',
        embedding: [0.1, 0.2, 0.3],
        metadata: { userId: 'user-456' },
      };

      await service.upsert(record);

      expect(mockPgVector.upsert).toHaveBeenCalledWith(record);
    });
  });

  describe('upsertMany', () => {
    it('should delegate batch upsert to provider', async () => {
      const records: VectorRecord[] = [
        { id: 'mem-1', embedding: [0.1] },
        { id: 'mem-2', embedding: [0.2] },
      ];

      await service.upsertMany(records);

      expect(mockPgVector.upsertMany).toHaveBeenCalledWith(records);
    });
  });

  describe('search', () => {
    it('should search using current provider', async () => {
      const embedding = [0.1, 0.2, 0.3];
      const expectedResults: VectorSearchResult[] = [
        { id: 'mem-1', score: 0.95 },
        { id: 'mem-2', score: 0.88 },
      ];
      mockPgVector.search.mockResolvedValue(expectedResults);

      const result = await service.search(embedding, {
        userId: 'user-123',
        limit: 10,
      });

      expect(mockPgVector.search).toHaveBeenCalledWith(embedding, {
        userId: 'user-123',
        limit: 10,
      });
      expect(result).toEqual(expectedResults);
    });

    it('should pass filter options to provider', async () => {
      const embedding = [0.1];
      mockPgVector.search.mockResolvedValue([]);

      await service.search(embedding, {
        userId: 'user-123',
        limit: 5,
        filter: {
          layers: ['IDENTITY', 'PROJECT'],
          projectId: 'project-456',
        },
      });

      expect(mockPgVector.search).toHaveBeenCalledWith(embedding, {
        userId: 'user-123',
        limit: 5,
        filter: {
          layers: ['IDENTITY', 'PROJECT'],
          projectId: 'project-456',
        },
      });
    });
  });

  describe('delete', () => {
    it('should delete vector by ID', async () => {
      await service.delete('mem-123');

      expect(mockPgVector.delete).toHaveBeenCalledWith('mem-123');
    });
  });

  describe('deleteByUser', () => {
    it('should delete all vectors for a user', async () => {
      await service.deleteByUser('user-456');

      expect(mockPgVector.deleteByUser).toHaveBeenCalledWith('user-456');
    });
  });

  describe('listProviders', () => {
    it('should list all registered providers with status', () => {
      const providers = service.listProviders();

      expect(providers).toContainEqual({ name: 'pgvector', configured: true });
      expect(providers).toContainEqual({ name: 'pinecone', configured: false });
    });
  });
});

describe('VectorService with Pinecone', () => {
  let service: VectorService;
  let mockPgVector: jest.Mocked<PgVectorProvider>;
  let mockPinecone: jest.Mocked<PineconeProvider>;

  beforeEach(async () => {
    mockPgVector = {
      name: 'pgvector',
      upsert: jest.fn(),
      upsertMany: jest.fn(),
      search: jest.fn(),
      delete: jest.fn(),
      deleteByUser: jest.fn(),
      isConfigured: jest.fn().mockReturnValue(true),
    } as any;

    mockPinecone = {
      name: 'pinecone',
      upsert: jest.fn(),
      upsertMany: jest.fn(),
      search: jest.fn(),
      delete: jest.fn(),
      deleteByUser: jest.fn(),
      isConfigured: jest.fn().mockReturnValue(true),
    } as any;

    const mockConfigService = {
      get: jest.fn().mockReturnValue('pinecone'),
    } as any;

    const module = await Test.createTestingModule({
      providers: [
        VectorService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PgVectorProvider, useValue: mockPgVector },
        { provide: PineconeProvider, useValue: mockPinecone },
      ],
    }).compile();

    service = module.get<VectorService>(VectorService);
  });

  it('should use pinecone for operations', async () => {
    const record: VectorRecord = {
      id: 'mem-123',
      embedding: [0.1, 0.2],
    };

    await service.upsert(record);

    expect(mockPinecone.upsert).toHaveBeenCalledWith(record);
    expect(mockPgVector.upsert).not.toHaveBeenCalled();
  });

  it('should search using pinecone', async () => {
    mockPinecone.search.mockResolvedValue([{ id: 'mem-1', score: 0.99 }]);

    const result = await service.search([0.1], { userId: 'user-123' });

    expect(mockPinecone.search).toHaveBeenCalled();
    expect(result[0].score).toBe(0.99);
  });
});
