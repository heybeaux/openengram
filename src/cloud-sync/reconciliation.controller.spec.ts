import { ReconciliationController } from './reconciliation.controller';
import { SyncReconciliationService } from './sync-reconciliation.service';
import {
  ReconciliationPlan,
  ReconciliationResult,
} from './sync-reconciliation.service';

const mockPlan: ReconciliationPlan = {
  localOnly: [],
  cloudOnly: [],
  shared: [],
  summary: {
    localOnlyCount: 0,
    cloudOnlyCount: 0,
    sharedCount: 0,
    totalLocal: 0,
    totalCloud: 0,
    wouldPush: 0,
    wouldPull: 0,
    alreadySynced: 0,
  },
};

const mockResult: ReconciliationResult = {
  pushed: 0,
  pulled: 0,
  skipped: 0,
  errors: 0,
  durationMs: 10,
};

describe('ReconciliationController', () => {
  let controller: ReconciliationController;
  let service: Partial<SyncReconciliationService>;

  beforeEach(() => {
    service = {
      reconcile: jest.fn().mockResolvedValue(mockPlan),
      executeReconciliation: jest.fn().mockResolvedValue(mockResult),
    };
    controller = new ReconciliationController(
      service as SyncReconciliationService,
    );
  });

  it('should preview reconciliation', async () => {
    const result = await controller.preview({ accountId: 'acc-1' });
    expect(result).toEqual(mockPlan);
    expect(service.reconcile).toHaveBeenCalledWith('acc-1');
  });

  it('should execute reconciliation', async () => {
    const result = await controller.execute({ accountId: 'acc-1' });
    expect(result).toEqual(mockResult);
    expect(service.reconcile).toHaveBeenCalledWith('acc-1');
    expect(service.executeReconciliation).toHaveBeenCalledWith(
      'acc-1',
      mockPlan,
    );
  });
});
