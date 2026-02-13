import { Test, TestingModule } from '@nestjs/testing';
import { PrefetchCacheService, DEFAULT_CACHE_CONFIG } from './prefetch-cache.service';
import { CachedMemory, TopicId } from './prefetch.types';

describe('nest test 2', () => {
  let service: PrefetchCacheService;
  
  const createMockMemory = (id: string, topics: TopicId[] = ['family'], score: number = 0.8): CachedMemory => ({
    id, content: `Test memory ${id}`, embedding: [0.1, 0.2, 0.3], score, layer: 'IDENTITY',
    cachedAt: Date.now(), accessCount: 0, lastAccessedAt: Date.now(), topics, prefetchedFor: topics[0],
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrefetchCacheService],
    }).compile();
    service = module.get<PrefetchCacheService>(PrefetchCacheService);
  });

  afterEach(() => { service.clear(); });

  it('should have default configuration', () => {
    expect(service.getConfig()).toEqual(DEFAULT_CACHE_CONFIG);
  });

  it('should store and retrieve', () => {
    const m = createMockMemory('test-1');
    service.set(m);
    expect(service.get('test-1')).not.toBeNull();
  });
});
