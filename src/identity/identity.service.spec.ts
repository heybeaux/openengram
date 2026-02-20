import { IdentityService } from './identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { TaskOutcomeService } from './task-outcome.service';
import { SelfAssessmentService } from './self-assessment.service';
import { CapabilityProfileService } from './capability-profile.service';
import { WorkStyleService } from './work-style.service';

describe('IdentityService', () => {
  let service: IdentityService;
  let prisma: any;
  let taskOutcome: jest.Mocked<TaskOutcomeService>;
  let selfAssessment: jest.Mocked<SelfAssessmentService>;
  let capabilityProfile: jest.Mocked<CapabilityProfileService>;
  let workStyle: jest.Mocked<WorkStyleService>;

  beforeEach(() => {
    prisma = {
      agent: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'agent-1',
          name: 'TestAgent',
          createdAt: new Date('2024-12-01'),
        }),
      },
      memory: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    taskOutcome = {
      create: jest.fn().mockResolvedValue({
        id: 'mem-1',
        taskDescription: 'deploy',
        outcome: 'success',
        createdAt: new Date(),
      }),
      list: jest.fn().mockResolvedValue([]),
    } as any;

    selfAssessment = {
      create: jest.fn().mockResolvedValue({
        id: 'mem-2',
        area: 'coding',
        selfRating: 8,
        confidence: 0.9,
        createdAt: new Date(),
      }),
      getLatestByArea: jest.fn().mockResolvedValue([]),
    } as any;

    capabilityProfile = {
      getProfile: jest.fn().mockResolvedValue({
        agentId: 'agent-1',
        capabilities: [],
        updatedAt: new Date(),
      }),
      updateFromTaskOutcome: jest.fn().mockResolvedValue(undefined),
    } as any;

    workStyle = {
      getWorkStyle: jest.fn().mockResolvedValue([]),
      extractFromTaskOutcome: jest.fn().mockResolvedValue(undefined),
    } as any;

    prisma = {
      agent: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'agent-1',
          name: 'TestAgent',
          createdAt: new Date(),
        }),
      },
      memory: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as any;

    service = new IdentityService(
      prisma,
      taskOutcome,
      selfAssessment,
      capabilityProfile,
      workStyle,
    );
  });

  describe('recordTaskOutcome', () => {
    it('should create outcome and cascade to profiles and work style', async () => {
      const result = await service.recordTaskOutcome('user-1', 'agent-1', {
        taskDescription: 'deploy',
        outcome: 'success',
        durationMs: 5000,
        capabilitiesUsed: ['deployment'],
        lessonsLearned: ['check staging'],
      });

      expect(result.id).toBe('mem-1');
      expect(taskOutcome.create).toHaveBeenCalled();
      expect(capabilityProfile.updateFromTaskOutcome).toHaveBeenCalledWith(
        'agent-1',
        'user-1',
        expect.objectContaining({
          capabilitiesUsed: ['deployment'],
          outcome: 'success',
        }),
      );
      expect(workStyle.extractFromTaskOutcome).toHaveBeenCalled();
    });

    it('should skip capability update if no capabilities specified', async () => {
      await service.recordTaskOutcome('user-1', 'agent-1', {
        taskDescription: 'quick fix',
        outcome: 'success',
      });

      expect(capabilityProfile.updateFromTaskOutcome).not.toHaveBeenCalled();
      expect(workStyle.extractFromTaskOutcome).toHaveBeenCalled();
    });
  });

  describe('getIdentityProfile', () => {
    it('should aggregate all identity data', async () => {
      const profile = await service.getIdentityProfile('agent-1', 'user-1');

      expect(profile.agentId).toBe('agent-1');
      expect(profile.capabilities).toBeDefined();
      expect(profile.workStyle).toBeDefined();
      expect(profile.selfAssessments).toBeDefined();
      expect(profile.recentOutcomes).toBeDefined();
    });
  });

  describe('recordSelfAssessment', () => {
    it('should delegate to self-assessment service', async () => {
      const result = await service.recordSelfAssessment('user-1', 'agent-1', {
        area: 'coding',
        selfRating: 8,
        confidence: 0.9,
      });

      expect(result.area).toBe('coding');
      expect(selfAssessment.create).toHaveBeenCalled();
    });
  });
});
