import { Test, TestingModule } from '@nestjs/testing';
import { CapabilityDeltaService } from './capability-delta.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CapabilityDeltaService', () => {
  let service: CapabilityDeltaService;
  let prisma: any;

  const now = new Date('2026-02-26T00:00:00Z');
  const earlier = new Date('2026-02-20T00:00:00Z');

  beforeEach(async () => {
    prisma = {
      trustSignal: {
        findMany: jest.fn().mockResolvedValue([]),
      },
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
    it('should aggregate signals by category and store checkpoint', async () => {
      prisma.trustSignal.findMany.mockResolvedValue([
        { category: 'deployment', createdAt: earlier },
        { category: 'deployment', createdAt: now },
        { category: 'testing', createdAt: earlier },
        { category: 'testing', createdAt: now },
      ]);

      const result = await service.createCheckpoint('user-1');

      expect(result).toHaveLength(2);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'deployment', evidenceCount: 2 }),
          expect.objectContaining({ name: 'testing', evidenceCount: 2 }),
        ]),
      );
      expect(prisma.capabilityCheckpoint.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          capabilities: expect.any(Array),
        }),
      });
    });

    it('should filter out categories with insufficient evidence', async () => {
      prisma.trustSignal.findMany.mockResolvedValue([
        { category: 'deployment', createdAt: now },
        // Only 1 signal — below MIN_EVIDENCE of 2
      ]);

      const result = await service.createCheckpoint('user-1');
      expect(result).toHaveLength(0);
    });

    it('should skip signals with null category', async () => {
      prisma.trustSignal.findMany.mockResolvedValue([
        { category: null, createdAt: now },
        { category: null, createdAt: earlier },
      ]);

      const result = await service.createCheckpoint('user-1');
      expect(result).toHaveLength(0);
    });

    it('should pass agentId filter when provided', async () => {
      await service.createCheckpoint('user-1', { agentId: 'agent-1' });

      expect(prisma.trustSignal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            agentId: 'agent-1',
            signalType: 'SUCCESS',
          }),
        }),
      );
      expect(prisma.capabilityCheckpoint.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ agentId: 'agent-1' }),
      });
    });

    it('should track firstSeen and lastSeen correctly', async () => {
      prisma.trustSignal.findMany.mockResolvedValue([
        { category: 'deployment', createdAt: earlier },
        { category: 'deployment', createdAt: now },
      ]);

      const result = await service.createCheckpoint('user-1');
      expect(result[0].firstSeen).toBe(earlier.toISOString());
      expect(result[0].lastSeen).toBe(now.toISOString());
    });

    it('should return empty array when no signals exist', async () => {
      const result = await service.createCheckpoint('user-1');
      expect(result).toHaveLength(0);
    });
  });

  describe('computeDelta', () => {
    it('should return empty delta when no checkpoints exist', async () => {
      const result = await service.computeDelta('user-1');

      expect(result.gained).toHaveLength(0);
      expect(result.improved).toHaveLength(0);
    });

    it('should treat all capabilities as gained when only one checkpoint exists', async () => {
      const caps = [
        {
          name: 'deployment',
          evidenceCount: 3,
          firstSeen: '2026-02-20',
          lastSeen: '2026-02-26',
        },
      ];
      prisma.capabilityCheckpoint.findMany.mockResolvedValue([
        { checkpointAt: now, capabilities: caps },
      ]);

      const result = await service.computeDelta('user-1');

      expect(result.gained).toHaveLength(1);
      expect(result.gained[0].name).toBe('deployment');
      expect(result.improved).toHaveLength(0);
    });

    it('should detect newly gained capabilities', async () => {
      const previousCaps = [
        {
          name: 'testing',
          evidenceCount: 2,
          firstSeen: '2026-02-15',
          lastSeen: '2026-02-20',
        },
      ];
      const currentCaps = [
        {
          name: 'testing',
          evidenceCount: 2,
          firstSeen: '2026-02-15',
          lastSeen: '2026-02-20',
        },
        {
          name: 'deployment',
          evidenceCount: 3,
          firstSeen: '2026-02-22',
          lastSeen: '2026-02-26',
        },
      ];

      prisma.capabilityCheckpoint.findMany.mockResolvedValue([
        { checkpointAt: now, capabilities: currentCaps },
        { checkpointAt: earlier, capabilities: previousCaps },
      ]);

      const result = await service.computeDelta('user-1');

      expect(result.gained).toHaveLength(1);
      expect(result.gained[0].name).toBe('deployment');
    });

    it('should detect improved capabilities (increased evidence)', async () => {
      const previousCaps = [
        {
          name: 'testing',
          evidenceCount: 2,
          firstSeen: '2026-02-15',
          lastSeen: '2026-02-20',
        },
      ];
      const currentCaps = [
        {
          name: 'testing',
          evidenceCount: 5,
          firstSeen: '2026-02-15',
          lastSeen: '2026-02-26',
        },
      ];

      prisma.capabilityCheckpoint.findMany.mockResolvedValue([
        { checkpointAt: now, capabilities: currentCaps },
        { checkpointAt: earlier, capabilities: previousCaps },
      ]);

      const result = await service.computeDelta('user-1');

      expect(result.gained).toHaveLength(0);
      expect(result.improved).toHaveLength(1);
      expect(result.improved[0]).toEqual({
        name: 'testing',
        previousCount: 2,
        currentCount: 5,
      });
    });

    it('should not flag unchanged capabilities', async () => {
      const caps = [
        {
          name: 'testing',
          evidenceCount: 3,
          firstSeen: '2026-02-15',
          lastSeen: '2026-02-20',
        },
      ];

      prisma.capabilityCheckpoint.findMany.mockResolvedValue([
        { checkpointAt: now, capabilities: caps },
        { checkpointAt: earlier, capabilities: caps },
      ]);

      const result = await service.computeDelta('user-1');

      expect(result.gained).toHaveLength(0);
      expect(result.improved).toHaveLength(0);
    });

    it('should not report removed capabilities (only tracks growth)', async () => {
      const previousCaps = [
        {
          name: 'testing',
          evidenceCount: 3,
          firstSeen: '2026-02-15',
          lastSeen: '2026-02-20',
        },
        {
          name: 'deployment',
          evidenceCount: 2,
          firstSeen: '2026-02-18',
          lastSeen: '2026-02-20',
        },
      ];
      const currentCaps = [
        {
          name: 'testing',
          evidenceCount: 3,
          firstSeen: '2026-02-15',
          lastSeen: '2026-02-20',
        },
        // deployment removed
      ];

      prisma.capabilityCheckpoint.findMany.mockResolvedValue([
        { checkpointAt: now, capabilities: currentCaps },
        { checkpointAt: earlier, capabilities: previousCaps },
      ]);

      const result = await service.computeDelta('user-1');

      expect(result.gained).toHaveLength(0);
      expect(result.improved).toHaveLength(0);
      // No 'lost' field — service only tracks growth
    });

    it('should set correct period from checkpoint dates', async () => {
      prisma.capabilityCheckpoint.findMany.mockResolvedValue([
        { checkpointAt: now, capabilities: [] },
        { checkpointAt: earlier, capabilities: [] },
      ]);

      const result = await service.computeDelta('user-1');

      expect(result.period.from).toEqual(earlier);
      expect(result.period.to).toEqual(now);
    });

    it('should filter by agentId when provided', async () => {
      prisma.capabilityCheckpoint.findMany.mockResolvedValue([]);

      await service.computeDelta('user-1', { agentId: 'agent-1' });

      expect(prisma.capabilityCheckpoint.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            agentId: 'agent-1',
          }),
        }),
      );
    });

    it('should handle all capabilities being new (empty previous snapshot)', async () => {
      const currentCaps = [
        {
          name: 'testing',
          evidenceCount: 3,
          firstSeen: '2026-02-20',
          lastSeen: '2026-02-26',
        },
        {
          name: 'deployment',
          evidenceCount: 2,
          firstSeen: '2026-02-22',
          lastSeen: '2026-02-26',
        },
      ];

      prisma.capabilityCheckpoint.findMany.mockResolvedValue([
        { checkpointAt: now, capabilities: currentCaps },
        { checkpointAt: earlier, capabilities: [] },
      ]);

      const result = await service.computeDelta('user-1');

      expect(result.gained).toHaveLength(2);
      expect(result.improved).toHaveLength(0);
    });
  });

  describe('getLatestCapabilities', () => {
    it('should return empty array when no checkpoint exists', async () => {
      const result = await service.getLatestCapabilities('user-1');
      expect(result).toEqual([]);
    });

    it('should return capabilities from latest checkpoint', async () => {
      const caps = [
        {
          name: 'deployment',
          evidenceCount: 4,
          firstSeen: '2026-02-15',
          lastSeen: '2026-02-26',
        },
      ];
      prisma.capabilityCheckpoint.findFirst.mockResolvedValue({
        capabilities: caps,
      });

      const result = await service.getLatestCapabilities('user-1');

      expect(result).toEqual(caps);
      expect(prisma.capabilityCheckpoint.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { checkpointAt: 'desc' },
      });
    });

    it('should filter by agentId when provided', async () => {
      prisma.capabilityCheckpoint.findFirst.mockResolvedValue(null);

      await service.getLatestCapabilities('user-1', { agentId: 'agent-1' });

      expect(prisma.capabilityCheckpoint.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ agentId: 'agent-1' }),
        }),
      );
    });
  });
});
