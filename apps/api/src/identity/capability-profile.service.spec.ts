import { Test, TestingModule } from '@nestjs/testing';
import { CapabilityProfileService } from './capability-profile.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CapabilityProfileService', () => {
  let service: CapabilityProfileService;
  let prisma: any;

  const mockProfile = {
    id: 'cap-1',
    agentId: 'agent-1',
    userId: 'user-1',
    capability: 'deployment',
    confidence: 0.7,
    evidenceCount: 5,
    successRate: 0.8,
    avgDurationMs: 3000,
    lastUsedAt: new Date('2026-02-20'),
    notes: 'usually smooth',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-02-20'),
  };

  beforeEach(async () => {
    prisma = {
      agentCapabilityProfile: {
        findMany: jest.fn().mockResolvedValue([mockProfile]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(mockProfile),
        update: jest.fn().mockResolvedValue(mockProfile),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CapabilityProfileService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(CapabilityProfileService);
  });

  describe('getProfile', () => {
    it('should return capability profile for agent', async () => {
      const result = await service.getProfile('agent-1', 'user-1');

      expect(result.agentId).toBe('agent-1');
      expect(result.capabilities).toHaveLength(1);
      expect(result.capabilities[0].capability).toBe('deployment');
      expect(result.capabilities[0].successRate).toBe(0.8);
    });

    it('should return empty profile when no capabilities exist', async () => {
      prisma.agentCapabilityProfile.findMany.mockResolvedValue([]);
      const result = await service.getProfile('agent-new', 'user-1');
      expect(result.capabilities).toHaveLength(0);
    });
  });

  describe('updateFromTaskOutcome', () => {
    it('should create new capability entries for unknown capabilities', async () => {
      await service.updateFromTaskOutcome('agent-1', 'user-1', {
        capabilitiesUsed: ['new_skill'],
        outcome: 'success',
        durationMs: 2000,
      });

      expect(prisma.agentCapabilityProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            capability: 'new_skill',
            evidenceCount: 1,
            successRate: 1.0,
          }),
        }),
      );
    });

    it('should update existing capability with incremental stats', async () => {
      prisma.agentCapabilityProfile.findUnique.mockResolvedValue(mockProfile);

      await service.updateFromTaskOutcome('agent-1', 'user-1', {
        capabilitiesUsed: ['deployment'],
        outcome: 'success',
        durationMs: 4000,
      });

      expect(prisma.agentCapabilityProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            evidenceCount: 6,
          }),
        }),
      );
    });

    it('should set success weight to 0.5 for partial outcomes', async () => {
      await service.updateFromTaskOutcome('agent-1', 'user-1', {
        capabilitiesUsed: ['testing'],
        outcome: 'partial',
      });

      expect(prisma.agentCapabilityProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            successRate: 0.5,
          }),
        }),
      );
    });

    it('should set success weight to 0 for failure outcomes', async () => {
      await service.updateFromTaskOutcome('agent-1', 'user-1', {
        capabilitiesUsed: ['debugging'],
        outcome: 'failure',
      });

      expect(prisma.agentCapabilityProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            successRate: 0.0,
          }),
        }),
      );
    });
  });
});
