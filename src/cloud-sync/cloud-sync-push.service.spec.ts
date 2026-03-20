import { CloudSyncPushService } from './cloud-sync-push.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

// ─── helpers ─────────────────────────────────────────────────────────────────

const makeMemory = (id: string, overrides: Record<string, any> = {}) => ({
  id,
  raw: `memory content ${id}`,
  layer: 'SESSION',
  memoryType: null,
  source: 'API',
  importanceHint: null,
  importanceScore: 0.5,
  effectiveScore: 0.5,
  priority: 'NORMAL',
  contentHash: `hash-${id}`,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  deletedAt: null,
  cloudSyncedAt: null,
  extraction: null,
  entities: [],
  ...overrides,
});

const makeApiResponse = (
  results: Array<{ sourceMemoryId: string; status: string }>,
) => ({
  ok: true,
  status: 200,
  json: jest.fn().mockResolvedValue({ results }),
  text: jest.fn().mockResolvedValue(''),
});

// ─── describe ────────────────────────────────────────────────────────────────

describe('CloudSyncPushService', () => {
  let service: CloudSyncPushService;
  let prisma: jest.Mocked<PrismaService>;
  let configService: jest.Mocked<ConfigService>;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    prisma = {
      memory: {
        count: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    } as any;

    configService = {
      get: jest.fn().mockReturnValue('https://api.test.com'),
    } as any;

    service = new CloudSyncPushService(prisma, configService);

    // Spy on global fetch
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        makeApiResponse([]) as unknown as Response,
      );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // ─── syncBatchToCloud ────────────────────────────────────────────────────────

  describe('syncBatchToCloud', () => {
    it('sends POST to /v1/sync/push with X-AM-API-Key header for regular keys', async () => {
      fetchSpy.mockResolvedValue(
        makeApiResponse([
          { sourceMemoryId: 'm1', status: 'created' },
        ]) as unknown as Response,
      );

      prisma.memory.update.mockResolvedValue({} as any);

      await service.syncBatchToCloud(
        [makeMemory('m1')],
        'regular-api-key',
        'inst-1',
      );

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.test.com/v1/sync/push');
      expect((init.headers as Record<string, string>)['X-AM-API-Key']).toBe(
        'regular-api-key',
      );
      expect(
        (init.headers as Record<string, string>)['X-Sync-Key'],
      ).toBeUndefined();
    });

    it('uses X-Sync-Key header for esync_ prefixed keys', async () => {
      fetchSpy.mockResolvedValue(
        makeApiResponse([]) as unknown as Response,
      );

      await service.syncBatchToCloud(
        [makeMemory('m1')],
        'esync_abc123',
        null,
      );

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(
        (init.headers as Record<string, string>)['X-Sync-Key'],
      ).toBe('esync_abc123');
      expect(
        (init.headers as Record<string, string>)['X-AM-API-Key'],
      ).toBeUndefined();
    });

    it('uses "unknown" as instanceId when null is passed', async () => {
      fetchSpy.mockResolvedValue(
        makeApiResponse([]) as unknown as Response,
      );

      await service.syncBatchToCloud([makeMemory('m1')], 'key', null);

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(
        (init.headers as Record<string, string>)['X-Instance-Id'],
      ).toBe('unknown');
    });

    it('returns correct counts for created/updated/skipped/errors', async () => {
      fetchSpy.mockResolvedValue(
        makeApiResponse([
          { sourceMemoryId: 'm1', status: 'created' },
          { sourceMemoryId: 'm2', status: 'updated' },
          { sourceMemoryId: 'm3', status: 'skipped' },
          { sourceMemoryId: 'm4', status: 'error' },
        ]) as unknown as Response,
      );

      prisma.memory.update.mockResolvedValue({} as any);

      const result = await service.syncBatchToCloud(
        [makeMemory('m1'), makeMemory('m2'), makeMemory('m3'), makeMemory('m4')],
        'key',
        'inst',
      );

      expect(result.synced).toBe(3);
      expect(result.newCount).toBe(1);
      expect(result.updatedCount).toBe(1);
      expect(result.skippedCount).toBe(1);
      expect(result.errors).toBe(1);
    });

    it('marks synced memories with cloudSyncedAt via prisma update', async () => {
      fetchSpy.mockResolvedValue(
        makeApiResponse([
          { sourceMemoryId: 'm1', status: 'created' },
        ]) as unknown as Response,
      );

      prisma.memory.update.mockResolvedValue({} as any);

      await service.syncBatchToCloud([makeMemory('m1')], 'key', null);

      expect(prisma.memory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'm1' },
          data: expect.objectContaining({ cloudSyncedAt: expect.any(Date) }),
        }),
      );
    });

    it('throws on 401 with "invalid or expired" message', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 401,
        text: jest.fn().mockResolvedValue('Unauthorized'),
      } as unknown as Response);

      await expect(
        service.syncBatchToCloud([makeMemory('m1')], 'bad-key', null),
      ).rejects.toThrow('invalid or expired');
    });

    it('throws on 403 with "invalid or expired" message', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 403,
        text: jest.fn().mockResolvedValue('Forbidden'),
      } as unknown as Response);

      await expect(
        service.syncBatchToCloud([makeMemory('m1')], 'bad-key', null),
      ).rejects.toThrow('invalid or expired');
    });

    it('throws on 429 with rate limit message', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 429,
        text: jest.fn().mockResolvedValue('Too Many Requests'),
      } as unknown as Response);

      await expect(
        service.syncBatchToCloud([makeMemory('m1')], 'key', null),
      ).rejects.toThrow('rate limit exceeded');
    });

    it('throws on generic HTTP errors', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('Server Error'),
      } as unknown as Response);

      await expect(
        service.syncBatchToCloud([makeMemory('m1')], 'key', null),
      ).rejects.toThrow('Cloud API error 500');
    });

    it('generates contentHash for memories missing one', async () => {
      fetchSpy.mockResolvedValue(
        makeApiResponse([]) as unknown as Response,
      );

      const memory = makeMemory('m1', { contentHash: null });
      await service.syncBatchToCloud([memory], 'key', null);

      // Verify that the payload's contentHash was populated
      const body = JSON.parse(
        (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.memories[0].contentHash).toBeTruthy();
      expect(typeof body.memories[0].contentHash).toBe('string');
    });

    it('includes extraction data when present', async () => {
      fetchSpy.mockResolvedValue(
        makeApiResponse([]) as unknown as Response,
      );

      const memory = makeMemory('m1', {
        extraction: {
          who: 'Alice',
          what: 'deployed service',
          when: new Date('2025-06-01'),
          whereCtx: 'production',
          why: 'feature launch',
          how: 'CI/CD',
          topics: ['deploy', 'production'],
        },
      });

      await service.syncBatchToCloud([memory], 'key', null);

      const body = JSON.parse(
        (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.memories[0].extraction.who).toBe('Alice');
      expect(body.memories[0].extraction.topics).toEqual([
        'deploy',
        'production',
      ]);
    });

    it('does not crash if prisma update fails for a synced memory', async () => {
      fetchSpy.mockResolvedValue(
        makeApiResponse([
          { sourceMemoryId: 'm1', status: 'created' },
        ]) as unknown as Response,
      );

      prisma.memory.update.mockRejectedValue(new Error('DB error'));

      // Should not throw — just logs the error
      const result = await service.syncBatchToCloud(
        [makeMemory('m1')],
        'key',
        null,
      );

      // Still counts as synced even if mark-as-synced fails
      expect(result.synced).toBe(1);
    });

    it('uses syncProtocolVersion 2', async () => {
      fetchSpy.mockResolvedValue(
        makeApiResponse([]) as unknown as Response,
      );

      await service.syncBatchToCloud([makeMemory('m1')], 'key', null);

      const body = JSON.parse(
        (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.syncProtocolVersion).toBe(2);
    });
  });

  // ─── performSyncWithClient ───────────────────────────────────────────────────

  describe('performSyncWithClient', () => {
    const makeDb = () => ({
      memory: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
    });

    it('returns zero counts when no memories are pending', async () => {
      const db = makeDb();
      const signal = new AbortController().signal;
      const syncProgress = { synced: 0, total: 0 };

      const result = await service.performSyncWithClient(
        db as any,
        'key',
        null,
        signal,
        syncProgress,
      );

      expect(result.syncedCount).toBe(0);
      expect(result.errorCount).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('sets syncProgress.total from initial count', async () => {
      const db = makeDb();
      db.memory.count.mockResolvedValue(42);
      db.memory.findMany.mockResolvedValue([]); // no actual batches

      const syncProgress = { synced: 0, total: 0 };
      await service.performSyncWithClient(
        db as any,
        'key',
        null,
        new AbortController().signal,
        syncProgress,
      );

      expect(syncProgress.total).toBe(42);
    });

    it('stops processing immediately when signal is already aborted', async () => {
      const db = makeDb();
      db.memory.count.mockResolvedValue(10);
      const controller = new AbortController();
      controller.abort();

      const result = await service.performSyncWithClient(
        db as any,
        'key',
        null,
        controller.signal,
        { synced: 0, total: 0 },
      );

      // No batches should have been fetched
      expect(db.memory.findMany).not.toHaveBeenCalled();
      expect(result.syncedCount).toBe(0);
    });

    it('processes a single batch and returns correct counts', async () => {
      const db = makeDb();
      db.memory.count.mockResolvedValue(1);
      db.memory.findMany
        .mockResolvedValueOnce([makeMemory('m1')]) // first call: batch
        .mockResolvedValueOnce([]); // second call: empty → done

      fetchSpy.mockResolvedValue(
        makeApiResponse([
          { sourceMemoryId: 'm1', status: 'created' },
        ]) as unknown as Response,
      );

      prisma.memory.update.mockResolvedValue({} as any);

      const result = await service.performSyncWithClient(
        db as any,
        'key',
        null,
        new AbortController().signal,
        { synced: 0, total: 0 },
      );

      expect(result.syncedCount).toBe(1);
      expect(result.newCount).toBe(1);
    });

    it('stops sync on 401/invalid API key', async () => {
      const db = makeDb();
      db.memory.count.mockResolvedValue(5);
      db.memory.findMany.mockResolvedValue([makeMemory('m1')]);

      fetchSpy.mockResolvedValue({
        ok: false,
        status: 401,
        text: jest.fn().mockResolvedValue('Unauthorized'),
      } as unknown as Response);

      const result = await service.performSyncWithClient(
        db as any,
        'bad-key',
        null,
        new AbortController().signal,
        { synced: 0, total: 0 },
      );

      // Should break out of loop on auth error
      expect(db.memory.findMany).toHaveBeenCalledTimes(1);
      expect(result.errorCount).toBeGreaterThan(0);
    });

    it('accumulates errors across batches without stopping', async () => {
      const db = makeDb();
      db.memory.count.mockResolvedValue(2);
      db.memory.findMany
        .mockResolvedValueOnce([makeMemory('m1')])
        .mockResolvedValueOnce([makeMemory('m2')])
        .mockResolvedValueOnce([]); // done

      // First batch: 429, second batch: success
      fetchSpy
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: jest.fn().mockResolvedValue(''),
        } as unknown as Response)
        .mockResolvedValue(
          makeApiResponse([
            { sourceMemoryId: 'm2', status: 'created' },
          ]) as unknown as Response,
        );

      prisma.memory.update.mockResolvedValue({} as any);

      const result = await service.performSyncWithClient(
        db as any,
        'key',
        null,
        new AbortController().signal,
        { synced: 0, total: 0 },
      );

      expect(result.errorCount).toBe(1); // batch 1 failed
      expect(result.syncedCount).toBe(1); // batch 2 succeeded
    });
  });
});
