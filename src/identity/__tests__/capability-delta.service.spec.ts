import { Test, TestingModule } from '@nestjs/testing';
import { CapabilityDeltaService } from '../capability-delta.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('CapabilityDeltaService', () => {
  let service: CapabilityDeltaService;
  let prisma: {
    trustSignal: { findMany: jest.Mock };
    capabilityCheckpoint: { create: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      trustSignal: { findMany: jest.fn().mockResolvedValue([]) },
      capabilityCheckpoint: {
        create: jest.fn().mockResolvedValue({ id: 'cp-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CapabilityDeltaService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(CapabilityDeltaService);
  });

  describe('createCheckpoint', () => {
    it('should create empty checkpoint when no signals', async () => {
      const result = await service.createCheckpoint('user-1');

      expect(result).toEqual([]);
      expect(prisma.capabilityCheckpoint.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          capabilities: [],
        }),
      });
    });

    it('should aggregate capabilities from success signals', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 86400000);

      prisma.trustSignal.findMany.mockResolvedValue([
        { category: 'deploy', createdAt: yesterday },
        { category: 'deploy', createdAt: now },
        { category: 'deploy', createdAt: now },
        { category: 'code-review', createdAt: yesterday },
        { category: 'code-review', createdAt: now },
        { category: 'testing', createdAt: now }, // Only 1 — below threshold
      ]);

      const result = await service.createCheckpoint('user-1');

      expect(result).toHaveLength(2);
      expect(result.find((c) => c.name === 'deploy')?.evidenceCount).toBe(3);
      expect(result.find((c) => c.name === 'code-review')?.evidenceCount).toBe(2);
      // 'testing' excluded — only 1 signal, below MIN_EVIDENCE of 2
      expect(result.find((c) => c.name === 'testing')).toBeUndefined();
    });

    it('should filter by agentId when provided', async () => {
      await service.createCheckpoint('user-1', { agentId: 'agent-1' });

      expect(prisma.trustSignal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ agentId: 'agent-1' }),
        }),
      );
    });
  });

  describe('computeDelta', () => {
    it('should return empty delta when no checkpoints', async () => {
      const result = await service.computeDelta('user-1');

      expect(result.gained).toEqual([]);
      expect(result.improved).toEqual([]);
    });

    it('should treat all capabilities as gained on first checkpoint', async () => {
      prisma.capabilityCheckpoint.findMany.mockResolvedValue([
        {
          checkpointAt: new Date(),
          capabilities: [
            { name: 'deploy', evidenceCount: 5, firstSeen: '2025-01-01', lastSeen: '2025-02-01' },
          ],
        },
      ]);

      const result = await service.computeDelta('user-1');

      expect(result.gained).toHaveLength(1);
      expect(result.gained[0].name).toBe('deploy');
    });

    it('should detect newly gained capabilities', async () => {
      const now = new Date();
      const lastWeek = new Date(now.getTime() - 7 * 86400000);

      prisma.capabilityCheckpoint.findMany.mockResolvedValue([
        {
          checkpointAt: now,
          capabilities: [
            { name: 'deploy', evidenceCount: 5, firstSeen: '2025-01-01', lastSeen: '2025-02-01' },
            { name: 'monitoring', evidenceCount: 3, firstSeen: '2025-02-01', lastSeen: '2025-02-15' },
          ],
        },
        {
          checkpointAt: lastWeek,
          capabilities: [
            { name: 'deploy', evidenceCount: 3, firstSeen: '2025-01-01', lastSeen: '2025-01-20' },
          ],
        },
      ]);

      const result = await service.computeDelta('user-1');

      expect(result.gained).toHaveLength(1);
      expect(result.gained[0].name).toBe('monitoring');
      expect(result.improved).toHaveLength(1);
      expect(result.improved[0]).toEqual({
        name: 'deploy',
        previousCount: 3,
        currentCount: 5,
      });
    });
  });

  describe('getLatestCapabilities', () => {
    it('should return empty when no checkpoints', async () => {
      const result = await service.getLatestCapabilities('user-1');
      expect(result).toEqual([]);
    });

    it('should return capabilities from latest checkpoint', async () => {
      prisma.capabilityCheckpoint.findFirst.mockResolvedValue({
        capabilities: [{ name: 'deploy', evidenceCount: 5 }],
      });

      const result = await service.getLatestCapabilities('user-1');
      expect(result).toHaveLength(1);
    });
  });
});
