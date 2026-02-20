import { TrustHistoryService } from './trust-history.service';

const mockPrisma = {
  memory: { findMany: jest.fn().mockResolvedValue([]) },
} as any;

describe('TrustHistoryService', () => {
  let service: TrustHistoryService;

  beforeEach(() => {
    service = new TrustHistoryService(mockPrisma);
  });

  it('should record and retrieve trust history', async () => {
    service.recordTrustScore('agent-1', 0.85, 'initial');
    service.recordTrustScore('agent-1', 0.90, 'improved');
    service.recordTrustScore('agent-2', 0.70);
    const result = await service.getHistory('agent-1');
    expect(result.total).toBe(2);
    expect(result.data.length).toBe(2);
    expect(result.data.map((d) => d.trustScore)).toEqual(expect.arrayContaining([0.85, 0.90]));
  });

  it('should paginate history', async () => {
    for (let i = 0; i < 10; i++) service.recordTrustScore('agent-1', i * 0.1);
    const page1 = await service.getHistory('agent-1', { limit: 3, offset: 0 });
    expect(page1.data.length).toBe(3);
    expect(page1.total).toBe(10);
  });

  it('should bulk recompute', async () => {
    const result = await service.bulkRecompute();
    expect(result.recomputed).toBe(0);
  });
});
