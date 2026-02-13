import { Test, TestingModule } from '@nestjs/testing';
import { PrefetchCacheService } from './prefetch-cache.service';

describe('nest test', () => {
  let service: PrefetchCacheService;
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrefetchCacheService],
    }).compile();
    service = module.get<PrefetchCacheService>(PrefetchCacheService);
  });
  it('works', () => { expect(service).toBeDefined(); });
});
