import { BadRequestException } from '@nestjs/common';
import {
  CloudSyncController,
  ReconciliationController,
  SyncIngestController,
} from './cloud-sync.controller';
import { CloudSyncService } from './cloud-sync.service';
import { SyncReconciliationService } from './sync-reconciliation.service';

describe('CloudSyncController', () => {
  let controller: CloudSyncController;
  let cloudSyncService: jest.Mocked<CloudSyncService>;
  let reconciliationService: jest.Mocked<SyncReconciliationService>;

  const mockReq = { accountId: 'acct-1' };

  beforeEach(() => {
    jest.clearAllMocks();

  let cloudSyncService: any;

  beforeEach(() => {
    cloudSyncService = {
      triggerSync: jest.fn(),
      getSyncStatus: jest.fn(),
      cancelSync: jest.fn(),
      setAutoSync: jest.fn(),
      getSyncHistory: jest.fn(),
      triggerPull: jest.fn(),
      handleSyncPush: jest.fn(),
      handleSyncPull: jest.fn(),
      getInstances: jest.fn(),
    } as any;

    reconciliationService = {
      reconcile: jest.fn(),
      executeReconciliation: jest.fn(),
    } as any;

    controller = new CloudSyncController(
      cloudSyncService,
      reconciliationService,
    );
  });

  describe('sync', () => {
    it('should trigger sync for the account', async () => {
      cloudSyncService.triggerSync.mockResolvedValue({ started: true } as any);
      const result = await controller.sync(mockReq);
      expect(cloudSyncService.triggerSync).toHaveBeenCalledWith('acct-1');
      expect(result).toEqual({ started: true });
    });
  });

  describe('status', () => {
    it('should return sync status', async () => {
      const status = { inProgress: false, lastSync: '2026-03-07' };
      cloudSyncService.getSyncStatus.mockResolvedValue(status as any);
      const result = await controller.status(mockReq);
    };

    controller = new CloudSyncController(
      cloudSyncService as CloudSyncService,
      {} as SyncReconciliationService,
    );
  });

  describe('sync()', () => {
    it('should trigger sync with accountId from request', async () => {
      cloudSyncService.triggerSync.mockResolvedValue({ synced: 5 });
      const req = { accountId: 'acc-123' };

      const result = await controller.sync(req);

      expect(cloudSyncService.triggerSync).toHaveBeenCalledWith('acc-123');
      expect(result).toEqual({ synced: 5 });
    });
  });

  describe('status()', () => {
    it('should return sync status for the account', async () => {
      const status = { lastSync: '2026-03-10', inProgress: false };
      cloudSyncService.getSyncStatus.mockResolvedValue(status);

      const result = await controller.status({ accountId: 'acc-123' });

      expect(cloudSyncService.getSyncStatus).toHaveBeenCalledWith('acc-123');
      expect(result).toEqual(status);
    });
  });

  describe('cancelSync', () => {
    it('should cancel sync and return confirmation', async () => {
      const result = await controller.cancelSync();
  describe('cancelSync()', () => {
    it('should cancel sync and return confirmation', async () => {
      const result = await controller.cancelSync();

      expect(cloudSyncService.cancelSync).toHaveBeenCalled();
      expect(result).toEqual({ cancelled: true });
    });
  });

  describe('setAutoSync', () => {
    it('should enable auto-sync', async () => {
      const result = await controller.setAutoSync(mockReq, { enabled: true });
      expect(cloudSyncService.setAutoSync).toHaveBeenCalledWith('acct-1', true);
  describe('setAutoSync()', () => {
    it('should enable auto-sync', async () => {
      cloudSyncService.setAutoSync.mockResolvedValue(undefined);

      const result = await controller.setAutoSync(
        { accountId: 'acc-123' },
        { enabled: true },
      );

      expect(cloudSyncService.setAutoSync).toHaveBeenCalledWith(
        'acc-123',
        true,
      );
      expect(result).toEqual({ autoSync: true });
    });

    it('should disable auto-sync', async () => {
      const result = await controller.setAutoSync(mockReq, { enabled: false });
      expect(cloudSyncService.setAutoSync).toHaveBeenCalledWith(
        'acct-1',
      cloudSyncService.setAutoSync.mockResolvedValue(undefined);

      const result = await controller.setAutoSync(
        { accountId: 'acc-123' },
        { enabled: false },
      );

      expect(cloudSyncService.setAutoSync).toHaveBeenCalledWith(
        'acc-123',
        false,
      );
      expect(result).toEqual({ autoSync: false });
    });
  });

  describe('history', () => {
    it('should return sync history with limit 10', async () => {
      const history = [{ id: '1', status: 'completed' }];
      cloudSyncService.getSyncHistory.mockResolvedValue(history as any);
      const result = await controller.history(mockReq);
      expect(cloudSyncService.getSyncHistory).toHaveBeenCalledWith(
        'acct-1',
  describe('history()', () => {
    it('should return last 10 sync events', async () => {
      const history = [{ id: 'ev-1', type: 'push' }];
      cloudSyncService.getSyncHistory.mockResolvedValue(history);

      const result = await controller.history({ accountId: 'acc-123' });

      expect(cloudSyncService.getSyncHistory).toHaveBeenCalledWith(
        'acc-123',
        10,
      );
      expect(result).toEqual(history);
    });
  });

  describe('pull', () => {
    it('should trigger pull for the account', async () => {
      cloudSyncService.triggerPull.mockResolvedValue({ pulled: 5 } as any);
      const result = await controller.pull(mockReq);
      expect(cloudSyncService.triggerPull).toHaveBeenCalledWith('acct-1');
      expect(result).toEqual({ pulled: 5 });
  describe('pull()', () => {
    it('should trigger pull with accountId', async () => {
      cloudSyncService.triggerPull.mockResolvedValue({ pulled: 3 });

      const result = await controller.pull({ accountId: 'acc-123' });

      expect(cloudSyncService.triggerPull).toHaveBeenCalledWith('acc-123');
      expect(result).toEqual({ pulled: 3 });
    });
  });
});

describe('ReconciliationController', () => {
  let controller: ReconciliationController;
  let reconciliationService: jest.Mocked<SyncReconciliationService>;

  const mockReq = { accountId: 'acct-1' };

  beforeEach(() => {
    jest.clearAllMocks();
    reconciliationService = {
      reconcile: jest.fn(),
      executeReconciliation: jest.fn(),
    } as any;
    controller = new ReconciliationController(reconciliationService);
  });

  describe('preview', () => {
    it('should return reconciliation preview', async () => {
      const plan = { additions: 3, deletions: 1 };
      reconciliationService.reconcile.mockResolvedValue(plan as any);
      const result = await controller.preview(mockReq);
      expect(reconciliationService.reconcile).toHaveBeenCalledWith('acct-1');
  let reconciliationService: any;

  beforeEach(() => {
    reconciliationService = {
      reconcile: jest.fn(),
      executeReconciliation: jest.fn(),
    };

    controller = new ReconciliationController(
      reconciliationService as SyncReconciliationService,
    );
  });

  describe('preview()', () => {
    it('should return reconciliation plan', async () => {
      const plan = { additions: 2, deletions: 1 };
      reconciliationService.reconcile.mockResolvedValue(plan);

      const result = await controller.preview({ accountId: 'acc-123' });

      expect(reconciliationService.reconcile).toHaveBeenCalledWith('acc-123');
      expect(result).toEqual(plan);
    });
  });

  describe('execute', () => {
    it('should reconcile then execute the plan', async () => {
      const plan = { additions: 3, deletions: 1 };
      const execResult = { applied: true, changes: 4 };
      reconciliationService.reconcile.mockResolvedValue(plan as any);
      reconciliationService.executeReconciliation.mockResolvedValue(
        execResult as any,
      );

      const result = await controller.execute(mockReq);

      expect(reconciliationService.reconcile).toHaveBeenCalledWith('acct-1');
      expect(reconciliationService.executeReconciliation).toHaveBeenCalledWith(
        'acct-1',
        plan,
      );
  describe('execute()', () => {
    it('should reconcile then execute the plan', async () => {
      const plan = { additions: 2, deletions: 1 };
      const execResult = { applied: true };
      reconciliationService.reconcile.mockResolvedValue(plan);
      reconciliationService.executeReconciliation.mockResolvedValue(execResult);

      const result = await controller.execute({ accountId: 'acc-123' });

      expect(reconciliationService.reconcile).toHaveBeenCalledWith('acc-123');
      expect(
        reconciliationService.executeReconciliation,
      ).toHaveBeenCalledWith('acc-123', plan);
      expect(result).toEqual(execResult);
    });
  });
});

describe('SyncIngestController', () => {
  let controller: SyncIngestController;
  let cloudSyncService: jest.Mocked<CloudSyncService>;

  const mockReq = { accountId: 'acct-1', instanceId: 'inst-1' };

  beforeEach(() => {
    jest.clearAllMocks();
  let cloudSyncService: any;

  beforeEach(() => {
    cloudSyncService = {
      handleSyncPush: jest.fn(),
      handleSyncPull: jest.fn(),
      getInstances: jest.fn(),
    } as any;
    controller = new SyncIngestController(cloudSyncService);
  });

  describe('pushBatch', () => {
    it('should push memories to cloud', async () => {
      const dto = { memories: [{ id: 'm1', raw: 'test' }] };
      const pushResult = { received: 1, created: 1, updated: 0 };
      cloudSyncService.handleSyncPush.mockResolvedValue(pushResult as any);

      const result = await controller.pushBatch(dto as any, mockReq);

      expect(cloudSyncService.handleSyncPush).toHaveBeenCalledWith(
        'acct-1',
    };

    controller = new SyncIngestController(
      cloudSyncService as CloudSyncService,
    );
  });

  describe('pushBatch()', () => {
    it('should push batch with valid protocol version', async () => {
      const dto = { syncProtocolVersion: 1, memories: [] };
      const pushResult = { accepted: 0, rejected: 0 };
      cloudSyncService.handleSyncPush.mockResolvedValue(pushResult);
      const req = { accountId: 'acc-1', instanceId: 'inst-1' };

      const result = await controller.pushBatch(dto as any, req);

      expect(cloudSyncService.handleSyncPush).toHaveBeenCalledWith(
        'acc-1',
        'inst-1',
        dto,
      );
      expect(result).toEqual(pushResult);
    });

    it('should accept sync protocol version 1', async () => {
      const dto = {
        memories: [],
        syncProtocolVersion: 1,
      };
      cloudSyncService.handleSyncPush.mockResolvedValue({} as any);
      await expect(
        controller.pushBatch(dto as any, mockReq),
      ).resolves.toBeDefined();
    });

    it('should accept sync protocol version 2', async () => {
      const dto = {
        memories: [],
        syncProtocolVersion: 2,
      };
      cloudSyncService.handleSyncPush.mockResolvedValue({} as any);
      await expect(
        controller.pushBatch(dto as any, mockReq),
      ).resolves.toBeDefined();
    });

    it('should reject unsupported sync protocol version (>2)', async () => {
      const dto = {
        memories: [],
        syncProtocolVersion: 3,
      };
      await expect(controller.pushBatch(dto as any, mockReq)).rejects.toThrow(
    it('should push batch with protocol version 2', async () => {
      const dto = { syncProtocolVersion: 2, memories: [] };
      cloudSyncService.handleSyncPush.mockResolvedValue({ accepted: 0 });
      const req = { accountId: 'acc-1', instanceId: 'inst-1' };

      await expect(
        controller.pushBatch(dto as any, req),
      ).resolves.toBeDefined();
    });

    it('should reject unsupported sync protocol version (v3+)', async () => {
      const dto = { syncProtocolVersion: 3, memories: [] };
      const req = { accountId: 'acc-1', instanceId: 'inst-1' };

      await expect(controller.pushBatch(dto as any, req)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should allow undefined syncProtocolVersion', async () => {
      const dto = { memories: [] };
      cloudSyncService.handleSyncPush.mockResolvedValue({} as any);
      await expect(
        controller.pushBatch(dto as any, mockReq),
    it('should reject version 99', async () => {
      const dto = { syncProtocolVersion: 99, memories: [] };
      const req = { accountId: 'acc-1', instanceId: 'inst-1' };

      await expect(controller.pushBatch(dto as any, req)).rejects.toThrow(
        'Unsupported sync protocol version',
      );
    });

    it('should accept push without protocol version', async () => {
      const dto = { memories: [] };
      cloudSyncService.handleSyncPush.mockResolvedValue({ accepted: 0 });
      const req = { accountId: 'acc-1', instanceId: 'inst-1' };

      await expect(
        controller.pushBatch(dto as any, req),
      ).resolves.toBeDefined();
    });
  });

  describe('pullBatch', () => {
    it('should pull with provided since and limit', async () => {
      cloudSyncService.handleSyncPull.mockResolvedValue({
        memories: [],
      } as any);

      await controller.pullBatch('2026-03-01T00:00:00Z', '50', mockReq);

      expect(cloudSyncService.handleSyncPull).toHaveBeenCalledWith(
        'acct-1',
        'inst-1',
        new Date('2026-03-01T00:00:00Z'),
        50,
      );
    });

    it('should default to epoch when since is empty', async () => {
      cloudSyncService.handleSyncPull.mockResolvedValue({
        memories: [],
      } as any);

      await controller.pullBatch('', '100', mockReq);

      expect(cloudSyncService.handleSyncPull).toHaveBeenCalledWith(
        'acct-1',
        'inst-1',
        new Date(0),
        100,
      );
    });

    it('should cap limit at 500', async () => {
      cloudSyncService.handleSyncPull.mockResolvedValue({
        memories: [],
      } as any);

      await controller.pullBatch('2026-01-01', '9999', mockReq);

      expect(cloudSyncService.handleSyncPull).toHaveBeenCalledWith(
        'acct-1',
  describe('pullBatch()', () => {
    it('should pull with since date and default limit', async () => {
      const pullResult = { memories: [], cursor: null };
      cloudSyncService.handleSyncPull.mockResolvedValue(pullResult);
      const req = { accountId: 'acc-1', instanceId: 'inst-1' };

      const result = await controller.pullBatch(
        '2026-01-01T00:00:00Z',
        '',
        req,
      );

      expect(cloudSyncService.handleSyncPull).toHaveBeenCalledWith(
        'acc-1',
        'inst-1',
        new Date('2026-01-01T00:00:00Z'),
        100,
      );
      expect(result).toEqual(pullResult);
    });

    it('should cap limit at 500', async () => {
      cloudSyncService.handleSyncPull.mockResolvedValue({ memories: [] });
      const req = { accountId: 'acc-1', instanceId: 'inst-1' };

      await controller.pullBatch('2026-01-01', '1000', req);

      expect(cloudSyncService.handleSyncPull).toHaveBeenCalledWith(
        'acc-1',
        'inst-1',
        expect.any(Date),
        500,
      );
    });

    it('should default limit to 100 when not provided', async () => {
      cloudSyncService.handleSyncPull.mockResolvedValue({
        memories: [],
      } as any);

      await controller.pullBatch('2026-01-01', undefined as any, mockReq);

      expect(cloudSyncService.handleSyncPull).toHaveBeenCalledWith(
        'acct-1',
        'inst-1',
        expect.any(Date),
        100,
    it('should use epoch when no since date provided', async () => {
      cloudSyncService.handleSyncPull.mockResolvedValue({ memories: [] });
      const req = { accountId: 'acc-1', instanceId: 'inst-1' };

      await controller.pullBatch('', '50', req);

      expect(cloudSyncService.handleSyncPull).toHaveBeenCalledWith(
        'acc-1',
        'inst-1',
        new Date(0),
        50,
      );
    });

    it('should handle custom limit within bounds', async () => {
      cloudSyncService.handleSyncPull.mockResolvedValue({ memories: [] });
      const req = { accountId: 'acc-1', instanceId: 'inst-1' };

      await controller.pullBatch('2026-01-01', '250', req);

      expect(cloudSyncService.handleSyncPull).toHaveBeenCalledWith(
        'acc-1',
        'inst-1',
        expect.any(Date),
        250,
      );
    });
  });

  describe('listInstances', () => {
    it('should return instances for the account', async () => {
      const instances = [{ id: 'inst-1', name: 'local' }];
      cloudSyncService.getInstances.mockResolvedValue(instances as any);

      const result = await controller.listInstances(mockReq);

      expect(cloudSyncService.getInstances).toHaveBeenCalledWith('acct-1');
  describe('listInstances()', () => {
    it('should return instances for the account', async () => {
      const instances = [{ id: 'inst-1', name: 'local' }];
      cloudSyncService.getInstances.mockResolvedValue(instances);

      const result = await controller.listInstances({ accountId: 'acc-1' });

      expect(cloudSyncService.getInstances).toHaveBeenCalledWith('acc-1');
      expect(result).toEqual(instances);
    });
  });
});
