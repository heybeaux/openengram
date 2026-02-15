import { Test, TestingModule } from '@nestjs/testing';
import { CloudSyncService } from './cloud-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { CloudLinkService } from '../cloud-link/cloud-link.service';
import { BadRequestException } from '@nestjs/common';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('CloudSyncService', () => {
  let service: CloudSyncService;
  let prisma: any;

  const mockCloudLink = {
    id: 'link-1',
    accountId: 'acc-1',
    cloudApiKey: 'fake-encrypted-key',
    autoSync: false,
  };

  const mockMemory = {
    id: 'mem-1',
    raw: 'Test memory content',
    layer: 'SESSION',
    source: 'EXPLICIT_STATEMENT',
    createdAt: new Date('2026-01-01'),
    importanceScore: 0.5,
    effectiveScore: 0.6,
    extraction: { topics: ['test'] },
  };

  beforeEach(async () => {
    prisma = {
      cloudLink: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      memory: {
        count: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CloudSyncService,
        { provide: PrismaService, useValue: prisma },
        { provide: CloudLinkService, useValue: {} },
      ],
    }).compile();

    service = module.get<CloudSyncService>(CloudSyncService);
    // Override decryptApiKey for tests
    (service as any).decryptApiKey = jest.fn().mockReturnValue('test-api-key');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSyncStatus', () => {
    it('should return sync status when linked', async () => {
      prisma.cloudLink.findUnique.mockResolvedValue(mockCloudLink);
      prisma.memory.count
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(75); // synced
      prisma.memory.findFirst.mockResolvedValue({
        cloudSyncedAt: new Date('2026-02-15'),
      });

      const result = await service.getSyncStatus('acc-1');

      expect(result).toEqual({
        lastSyncedAt: '2026-02-15T00:00:00.000Z',
        totalMemories: 100,
        syncedCount: 75,
        pendingCount: 25,
        autoSync: false,
      });
    });

    it('should throw if not linked', async () => {
      prisma.cloudLink.findUnique.mockResolvedValue(null);
      await expect(service.getSyncStatus('acc-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('triggerSync', () => {
    it('should sync unsynced memories in batches', async () => {
      prisma.cloudLink.findUnique.mockResolvedValue(mockCloudLink);
      prisma.memory.findMany
        .mockResolvedValueOnce([mockMemory])
        .mockResolvedValueOnce([]); // no more

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'cloud-mem-1' }),
      });

      prisma.memory.update.mockResolvedValue({});

      const result = await service.triggerSync('acc-1');

      expect(result.syncedCount).toBe(1);
      expect(result.errorCount).toBe(0);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openengram.ai/v1/observe',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-AM-API-Key': 'test-api-key',
          }),
        }),
      );
    });

    it('should handle individual memory errors without failing', async () => {
      prisma.cloudLink.findUnique.mockResolvedValue(mockCloudLink);
      prisma.memory.findMany
        .mockResolvedValueOnce([mockMemory, { ...mockMemory, id: 'mem-2' }])
        .mockResolvedValueOnce([]);

      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      prisma.memory.update.mockResolvedValue({});

      const result = await service.triggerSync('acc-1');

      expect(result.syncedCount).toBe(1);
      expect(result.errorCount).toBe(1);
    });

    it('should reject if sync already in progress', async () => {
      prisma.cloudLink.findUnique.mockResolvedValue(mockCloudLink);
      let resolveFirst: Function;
      prisma.memory.findMany.mockImplementation(
        () => new Promise((resolve) => { resolveFirst = () => resolve([]); }),
      );

      const first = service.triggerSync('acc-1');
      // Ensure the first sync has started
      await new Promise((r) => setTimeout(r, 10));
      await expect(service.triggerSync('acc-1')).rejects.toThrow(
        'Sync already in progress',
      );
      resolveFirst!();
      await first;
    });
  });

  describe('setAutoSync', () => {
    it('should update auto-sync preference', async () => {
      prisma.cloudLink.findUnique.mockResolvedValue(mockCloudLink);
      prisma.cloudLink.update.mockResolvedValue({});

      await service.setAutoSync('acc-1', true);

      expect(prisma.cloudLink.update).toHaveBeenCalledWith({
        where: { accountId: 'acc-1' },
        data: { autoSync: true },
      });
    });
  });
});
