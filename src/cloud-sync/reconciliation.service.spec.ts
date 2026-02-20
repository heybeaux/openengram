import { ReconciliationService } from './reconciliation.service';

describe('ReconciliationService', () => {
  let service: ReconciliationService;

  beforeEach(() => {
    const mockCloudSync = {
      getSyncStatus: jest.fn().mockResolvedValue({ lastSync: new Date(), status: 'idle' }),
    };
    service = new ReconciliationService(mockCloudSync as any);
  });

  it('should preview reconciliation', async () => {
    const result = await service.preview('acct-1');
    expect(result.accountId).toBe('acct-1');
    expect(result.conflicts).toEqual([]);
  });

  it('should execute reconciliation', async () => {
    const result = await service.execute('acct-1', 'cloud-wins');
    expect(result.resolved).toBe(0);
    expect(result.strategy).toBe('cloud-wins');
  });
});
