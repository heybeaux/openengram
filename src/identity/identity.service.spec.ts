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
    it('should aggregate all identity data including new fields', async () => {
      const profile = await service.getIdentityProfile('agent-1', 'user-1');

      expect(profile.agentId).toBe('agent-1');
      expect(profile.name).toBe('TestAgent');
      expect(profile.capabilities).toBeDefined();
      expect(profile.workStyle).toBeDefined();
      expect(profile.selfAssessments).toBeDefined();
      expect(profile.recentOutcomes).toBeDefined();
      // HEY-178: New fields
      expect(profile.preferences).toBeDefined();
      expect(profile.trustSignals).toBeDefined();
      expect(profile.recentPatterns).toBeDefined();
    });

    it('should include trust signals with correct structure', async () => {
      prisma.memory.findMany.mockResolvedValue([
        {
          layer: 'IDENTITY',
          memoryType: 'LESSON',
          confidence: 0.9,
          createdAt: new Date('2025-01-01'),
        },
        {
          layer: 'IDENTITY',
          memoryType: 'CONSTRAINT',
          confidence: 1.0,
          createdAt: new Date('2025-02-01'),
        },
      ]);

      const profile = await service.getIdentityProfile('agent-1', 'user-1');

      expect(profile.trustSignals).toBeDefined();
      expect(profile.trustSignals!.totalMemories).toBeGreaterThanOrEqual(0);
      expect(profile.trustSignals!.averageConfidence).toBeGreaterThanOrEqual(0);
    });

    it('should extract preferences from PREFERENCE type memories', async () => {
      prisma.memory.findMany.mockImplementation((args: any) => {
        const str = JSON.stringify(args);
        if (str.includes('PREFERENCE')) {
          return Promise.resolve([
            {
              id: 'pref-1',
              raw: 'I prefer using TypeScript over JavaScript',
              memoryType: 'PREFERENCE',
              metadata: null,
              extraction: { what: 'Prefers TypeScript over JavaScript' },
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const profile = await service.getIdentityProfile('agent-1', 'user-1');

      expect(profile.preferences).toBeDefined();
      expect(profile.preferences!.length).toBeGreaterThan(0);
      expect(profile.preferences![0].strength).toBe('strong');
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
