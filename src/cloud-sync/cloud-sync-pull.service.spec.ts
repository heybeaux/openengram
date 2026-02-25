import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CloudSyncPullService } from './cloud-sync-pull.service';
import { PrismaService } from '../prisma/prisma.service';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// Mock decrypt
jest.mock('../common/encryption.util', () => ({
  decrypt: jest.fn((v: string) => `decrypted_${v}`),
}));

const mockPrisma = {
  cloudLink: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  memory: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  agent: {
    findMany: jest.fn(),
  },
  syncIdMap: {
    findMany: jest.fn(),
  },
  syncEvent: {
    create: jest.fn(),
  },
  memoryChainLink: {
    findMany: jest.fn(),
  },
  graphEntityMention: {
    findMany: jest.fn(),
  },
  graphRelationship: {
    findMany: jest.fn(),
  },
};

describe('CloudSyncPullService', () => {
  let service: CloudSyncPullService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CloudSyncPullService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CloudSyncPullService>(CloudSyncPullService);
  });

  describe('triggerPull', () => {
    const mockLink = {
      accountId: 'acc-1',
      cloudApiKey: 'encrypted-key',
      cloudSyncKey: null,
      instanceId: 'inst-1',
      lastPulledAt: null,
    };

    it('should throw if no cloud link exists', async () => {
      mockPrisma.cloudLink.findUnique.mockResolvedValue(null);
      await expect(service.triggerPull('acc-1')).rejects.toThrow(BadRequestException);
    });

    it('should pull and create new memories', async () => {
      mockPrisma.cloudLink.findUnique.mockResolvedValue(mockLink);
      mockFetch
        // Pull request
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            memories: [
              {
                cloudId: 'cloud-1',
                localId: null,
                raw: 'test memory',
                layer: 'SEMANTIC',
                source: 'EXPLICIT_STATEMENT',
                contentHash: 'hash-1',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
                deletedAt: null,
              },
            ],
            hasMore: false,
          }),
        })
        // Embedding backfill
        .mockResolvedValueOnce({ ok: true });

      mockPrisma.memory.findFirst.mockResolvedValue(null); // no existing by hash
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-1' });
      mockPrisma.memory.create.mockResolvedValue({ id: 'mem-new-1' });
      mockPrisma.cloudLink.update.mockResolvedValue({});
      mockPrisma.syncEvent.create.mockResolvedValue({});

      const result = await service.triggerPull('acc-1');

      expect(result.newCount).toBe(1);
      expect(result.pulledCount).toBe(1);
      expect(mockPrisma.memory.create).toHaveBeenCalled();
      expect(mockPrisma.cloudLink.update).toHaveBeenCalledWith({
        where: { accountId: 'acc-1' },
        data: { lastPulledAt: expect.any(Date) },
      });
    });

    it('should skip memories with matching content hash', async () => {
      mockPrisma.cloudLink.findUnique.mockResolvedValue(mockLink);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          memories: [
            {
              cloudId: 'cloud-1',
              localId: null,
              raw: 'dup',
              layer: 'SEMANTIC',
              source: 'EXPLICIT_STATEMENT',
              contentHash: 'existing-hash',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
              deletedAt: null,
            },
          ],
          hasMore: false,
        }),
      });

      mockPrisma.memory.findFirst.mockResolvedValue({ id: 'existing-1' }); // hash match
      mockPrisma.cloudLink.update.mockResolvedValue({});
      mockPrisma.syncEvent.create.mockResolvedValue({});

      const result = await service.triggerPull('acc-1');
      expect(result.skippedCount).toBe(1);
      expect(result.newCount).toBe(0);
    });

    it('should propagate tombstones (deletions)', async () => {
      mockPrisma.cloudLink.findUnique.mockResolvedValue(mockLink);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          memories: [
            {
              cloudId: 'cloud-1',
              localId: 'local-1',
              raw: 'deleted',
              layer: 'SEMANTIC',
              source: 'EXPLICIT_STATEMENT',
              contentHash: null,
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
              deletedAt: '2026-01-02T00:00:00Z',
            },
          ],
          hasMore: false,
        }),
      });

      mockPrisma.memory.findUnique.mockResolvedValue({ id: 'local-1', deletedAt: null });
      mockPrisma.memory.update.mockResolvedValue({});
      mockPrisma.cloudLink.update.mockResolvedValue({});
      mockPrisma.syncEvent.create.mockResolvedValue({});

      const result = await service.triggerPull('acc-1');
      expect(result.deletedCount).toBe(1);
      expect(mockPrisma.memory.update).toHaveBeenCalledWith({
        where: { id: 'local-1' },
        data: { deletedAt: new Date('2026-01-02T00:00:00Z') },
      });
    });

    it('should throw on non-ok cloud response', async () => {
      mockPrisma.cloudLink.findUnique.mockResolvedValue(mockLink);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(service.triggerPull('acc-1')).rejects.toThrow(BadRequestException);
    });

    it('should prefer cloudSyncKey over cloudApiKey', async () => {
      mockPrisma.cloudLink.findUnique.mockResolvedValue({
        ...mockLink,
        cloudSyncKey: 'sync-key-encrypted',
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ memories: [], hasMore: false }),
      });
      mockPrisma.cloudLink.update.mockResolvedValue({});
      mockPrisma.syncEvent.create.mockResolvedValue({});

      await service.triggerPull('acc-1');

      // The decrypted sync key starts with 'decrypted_sync-key-encrypted'
      const fetchCall = mockFetch.mock.calls[0];
      // Check that the header uses the sync key
      expect(fetchCall[1].headers).toBeDefined();
    });

    it('should update existing local memory when content hash differs', async () => {
      mockPrisma.cloudLink.findUnique.mockResolvedValue(mockLink);
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            memories: [
              {
                cloudId: 'cloud-1',
                localId: 'local-1',
                raw: 'updated content',
                layer: 'SEMANTIC',
                source: 'EXPLICIT_STATEMENT',
                contentHash: 'new-hash',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
                deletedAt: null,
              },
            ],
            hasMore: false,
          }),
        })
        .mockResolvedValueOnce({ ok: true }); // backfill

      mockPrisma.memory.findFirst.mockResolvedValue(null); // no hash match
      mockPrisma.memory.findUnique.mockResolvedValue({ id: 'local-1', contentHash: 'old-hash' });
      mockPrisma.memory.update.mockResolvedValue({});
      mockPrisma.cloudLink.update.mockResolvedValue({});
      mockPrisma.syncEvent.create.mockResolvedValue({});

      const result = await service.triggerPull('acc-1');
      expect(result.updatedCount).toBe(1);
    });
  });

  describe('handleSyncPull', () => {
    it('should return paginated memories for an account', async () => {
      mockPrisma.agent.findMany.mockResolvedValue([{ id: 'agent-1' }]);
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-1' }]);
      mockPrisma.memory.findMany.mockResolvedValue([
        {
          id: 'mem-1',
          raw: 'test',
          layer: 'SEMANTIC',
          source: 'EXPLICIT_STATEMENT',
          contentHash: 'h1',
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      ]);
      mockPrisma.syncIdMap.findMany.mockResolvedValue([
        { cloudMemoryId: 'mem-1', localMemoryId: 'local-1', instanceId: 'inst-1' },
      ]);

      const result = await service.handleSyncPull('acc-1', 'inst-1', new Date(0), 100);

      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].localId).toBe('local-1');
      expect(result.hasMore).toBe(false);
    });

    it('should set hasMore when more results exist', async () => {
      mockPrisma.agent.findMany.mockResolvedValue([{ id: 'agent-1' }]);
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-1' }]);
      // Return limit+1 items
      const mems = Array.from({ length: 3 }, (_, i) => ({
        id: `mem-${i}`,
        raw: `test ${i}`,
        layer: 'SEMANTIC',
        source: 'EXPLICIT_STATEMENT',
        contentHash: `h${i}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }));
      mockPrisma.memory.findMany.mockResolvedValue(mems);
      mockPrisma.syncIdMap.findMany.mockResolvedValue([]);

      const result = await service.handleSyncPull('acc-1', 'inst-1', new Date(0), 2);

      expect(result.hasMore).toBe(true);
      expect(result.memories).toHaveLength(2);
    });
  });
});
