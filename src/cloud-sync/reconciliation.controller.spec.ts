import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';

const mockCloudSyncService = {
  getSyncStatus: jest.fn().mockResolvedValue({ status: 'idle' }),
} as any;

describe('ReconciliationController', () => {
  let controller: ReconciliationController;
  let service: ReconciliationService;

  beforeEach(() => {
    service = new ReconciliationService(mockCloudSyncService);
    controller = new ReconciliationController(service);
  });

  it('should preview reconciliation', async () => {
    const result = await controller.preview({ accountId: 'acc-1' });
    expect(result.accountId).toBe('acc-1');
    expect(result.conflicts).toEqual([]);
    expect(result.totalConflicts).toBe(0);
  });

  it('should execute reconciliation', async () => {
    const result = await controller.execute(
      { accountId: 'acc-1' },
      { strategy: 'newest-wins' },
    );
    expect(result.accountId).toBe('acc-1');
    expect(result.strategy).toBe('newest-wins');
    expect(result.resolved).toBe(0);
  });

  it('should default to newest-wins strategy', async () => {
    const result = await controller.execute({ accountId: 'acc-1' }, {});
    expect(result.strategy).toBe('newest-wins');
  });
});
