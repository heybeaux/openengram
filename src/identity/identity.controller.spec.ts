import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';

describe('IdentityController', () => {
  let controller: IdentityController;
  let service: jest.Mocked<IdentityService>;

  const mockIdentityProfile = {
    agentId: 'agent-1',
    capabilities: [
      {
        capability: 'deployment',
        confidence: 0.8,
        evidenceCount: 5,
        successRate: 0.9,
      },
    ],
    workStyle: [
      { dimension: 'task_duration', value: { avg: 5000 }, sampleCount: 10 },
    ],
    selfAssessments: [
      {
        id: 'sa-1',
        area: 'coding',
        selfRating: 8,
        confidence: 0.9,
        createdAt: new Date(),
      },
    ],
    recentOutcomes: [
      {
        id: 'to-1',
        taskDescription: 'deploy',
        outcome: 'success' as const,
        createdAt: new Date(),
      },
    ],
  };

  beforeEach(() => {
    service = {
      getIdentityProfile: jest.fn().mockResolvedValue(mockIdentityProfile),
      getCapabilities: jest.fn().mockResolvedValue({
        agentId: 'agent-1',
        capabilities: mockIdentityProfile.capabilities,
        updatedAt: new Date(),
      }),
      recordTaskOutcome: jest.fn().mockResolvedValue({
        id: 'to-1',
        taskDescription: 'deploy',
        outcome: 'success',
        createdAt: new Date(),
      }),
      recordSelfAssessment: jest.fn().mockResolvedValue({
        id: 'sa-1',
        area: 'coding',
        selfRating: 8,
        confidence: 0.9,
        createdAt: new Date(),
      }),
      taskOutcome: {
        list: jest.fn().mockResolvedValue([]),
      },
      selfAssessment: {
        list: jest.fn().mockResolvedValue([]),
      },
    } as any;

    controller = new IdentityController(service);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /agents/:id/identity', () => {
    it('should return full identity profile', async () => {
      const result = await controller.getIdentityProfile('user-1', 'agent-1');

      expect(result.agentId).toBe('agent-1');
      expect(result.capabilities).toHaveLength(1);
      expect(result.workStyle).toHaveLength(1);
      expect(result.selfAssessments).toHaveLength(1);
      expect(result.recentOutcomes).toHaveLength(1);
      expect(service.getIdentityProfile).toHaveBeenCalledWith(
        'agent-1',
        'user-1',
      );
    });
  });

  describe('GET /agents/:id/capabilities', () => {
    it('should return capability profile', async () => {
      const result = await controller.getCapabilities('user-1', 'agent-1');

      expect(result.agentId).toBe('agent-1');
      expect(result.capabilities).toHaveLength(1);
      expect(service.getCapabilities).toHaveBeenCalledWith(
        'agent-1',
        'user-1',
      );
    });
  });

  describe('POST /agents/:agentId/task-outcomes', () => {
    it('should record a task outcome', async () => {
      const result = await controller.recordTaskOutcome('user-1', 'agent-1', {
        taskDescription: 'deploy',
        outcome: 'success',
      });

      expect(result.id).toBe('to-1');
      expect(service.recordTaskOutcome).toHaveBeenCalled();
    });
  });

  describe('POST /agents/:agentId/self-assessments', () => {
    it('should record a self-assessment', async () => {
      const result = await controller.recordSelfAssessment(
        'user-1',
        'agent-1',
        {
          area: 'coding',
          selfRating: 8,
          confidence: 0.9,
        },
      );

      expect(result.id).toBe('sa-1');
      expect(service.recordSelfAssessment).toHaveBeenCalled();
    });
  });

  describe('GET /agents/:agentId/task-outcomes', () => {
    it('should list task outcomes', async () => {
      const result = await controller.listTaskOutcomes('user-1', 'agent-1');
      expect(service['taskOutcome'].list).toHaveBeenCalled();
    });
  });

  describe('GET /agents/:agentId/self-assessments', () => {
    it('should list self-assessments', async () => {
      const result = await controller.listSelfAssessments('user-1', 'agent-1');
      expect(service['selfAssessment'].list).toHaveBeenCalled();
    });
  });
});
