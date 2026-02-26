import { Test, TestingModule } from '@nestjs/testing';
import { TrustProfileService } from './trust-profile.service';
import { TaskCompletionService } from './task-completion.service';

describe('TrustProfileService', () => {
  let service: TrustProfileService;
  let taskCompletionService: any;

  const makeTc = (overrides: any = {}) => ({
    id: 'tc_1',
    taskId: 'task-001',
    delegatedTo: 'agent-coder',
    delegatedBy: 'agent-lead',
    taskDescription: 'Some task',
    domain: 'typescript',
    outcome: 'success',
    durationMs: 120000,
    qualitySignals: {},
    metadata: {},
    createdAt: new Date('2026-02-15'),
    ...overrides,
  });

  beforeEach(async () => {
    taskCompletionService = {
      getCompletionsByAgent: jest.fn().mockResolvedValue([]),
      prisma: {
        taskCompletion: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrustProfileService,
        { provide: TaskCompletionService, useValue: taskCompletionService },
      ],
    }).compile();

    service = module.get(TrustProfileService);
  });

  describe('getProfile', () => {
    it('should return empty profile for unknown agent', async () => {
      const result = await service.getProfile('unknown-agent');

      expect(result.agentId).toBe('unknown-agent');
      expect(result.overallTrust).toBe(0);
      expect(result.domains).toHaveLength(0);
      expect(result.totalTasksCompleted).toBe(0);
    });

    it('should calculate domain-specific trust scores', async () => {
      taskCompletionService.getCompletionsByAgent.mockResolvedValue([
        makeTc({ domain: 'typescript', outcome: 'success' }),
        makeTc({ domain: 'typescript', outcome: 'success' }),
        makeTc({ domain: 'devops', outcome: 'failure' }),
      ]);

      const result = await service.getProfile('agent-coder');

      expect(result.domains).toHaveLength(2);
      const tsDomain = result.domains.find((d) => d.domain === 'typescript');
      const devopsDomain = result.domains.find((d) => d.domain === 'devops');
      expect(tsDomain!.trustScore).toBeGreaterThan(0.8);
      expect(devopsDomain!.trustScore).toBe(0);
    });

    it('should apply recency weighting', async () => {
      const oldDate = new Date('2025-01-01');
      const recentDate = new Date('2026-02-19');

      taskCompletionService.getCompletionsByAgent.mockResolvedValue([
        makeTc({
          domain: 'typescript',
          outcome: 'failure',
          createdAt: oldDate,
        }),
        makeTc({
          domain: 'typescript',
          outcome: 'success',
          createdAt: recentDate,
        }),
      ]);

      const result = await service.getProfile('agent-coder');
      const tsDomain = result.domains.find((d) => d.domain === 'typescript');

      // Recent success should outweigh old failure due to decay
      expect(tsDomain!.trustScore).toBeGreaterThan(0.5);
    });

    it('should handle partial outcomes as 0.5', async () => {
      taskCompletionService.getCompletionsByAgent.mockResolvedValue([
        makeTc({ domain: 'general', outcome: 'partial' }),
      ]);

      const result = await service.getProfile('agent-x');
      const domain = result.domains[0];

      expect(domain.trustScore).toBe(0.5);
    });

    it('should calculate overall trust as weighted average', async () => {
      taskCompletionService.getCompletionsByAgent.mockResolvedValue([
        makeTc({ domain: 'typescript', outcome: 'success' }),
        makeTc({ domain: 'typescript', outcome: 'success' }),
        makeTc({ domain: 'devops', outcome: 'success' }),
      ]);

      const result = await service.getProfile('agent-coder');

      expect(result.overallTrust).toBeGreaterThan(0.9);
      expect(result.totalTasksCompleted).toBe(3);
    });

    it('should sort domains by task count', async () => {
      taskCompletionService.getCompletionsByAgent.mockResolvedValue([
        makeTc({ domain: 'devops', outcome: 'success' }),
        makeTc({ domain: 'typescript', outcome: 'success' }),
        makeTc({ domain: 'typescript', outcome: 'success' }),
        makeTc({ domain: 'typescript', outcome: 'success' }),
      ]);

      const result = await service.getProfile('agent-coder');

      expect(result.domains[0].domain).toBe('typescript');
      expect(result.domains[0].totalTasks).toBe(3);
    });

    it('should detect improving trend', async () => {
      const tasks = [
        makeTc({
          domain: 'ts',
          outcome: 'failure',
          createdAt: new Date('2026-01-01'),
        }),
        makeTc({
          domain: 'ts',
          outcome: 'failure',
          createdAt: new Date('2026-01-05'),
        }),
        makeTc({
          domain: 'ts',
          outcome: 'success',
          createdAt: new Date('2026-02-10'),
        }),
        makeTc({
          domain: 'ts',
          outcome: 'success',
          createdAt: new Date('2026-02-15'),
        }),
      ];
      taskCompletionService.getCompletionsByAgent.mockResolvedValue(tasks);

      const result = await service.getProfile('agent-x');
      const domain = result.domains.find((d) => d.domain === 'ts');

      expect(domain!.trend).toBe('improving');
    });

    it('should detect declining trend', async () => {
      const tasks = [
        makeTc({
          domain: 'ts',
          outcome: 'success',
          createdAt: new Date('2026-01-01'),
        }),
        makeTc({
          domain: 'ts',
          outcome: 'success',
          createdAt: new Date('2026-01-05'),
        }),
        makeTc({
          domain: 'ts',
          outcome: 'failure',
          createdAt: new Date('2026-02-10'),
        }),
        makeTc({
          domain: 'ts',
          outcome: 'failure',
          createdAt: new Date('2026-02-15'),
        }),
      ];
      taskCompletionService.getCompletionsByAgent.mockResolvedValue(tasks);

      const result = await service.getProfile('agent-x');
      const domain = result.domains.find((d) => d.domain === 'ts');

      expect(domain!.trend).toBe('declining');
    });
  });

  describe('recalculateAllProfiles', () => {
    it('should recalculate profiles for all agents', async () => {
      taskCompletionService.prisma.taskCompletion.findMany.mockResolvedValue([
        { delegatedTo: 'agent-a' },
        { delegatedTo: 'agent-b' },
      ]);
      taskCompletionService.getCompletionsByAgent.mockResolvedValue([makeTc()]);

      const result = await service.recalculateAllProfiles();

      expect(result.agentsUpdated).toBe(2);
      expect(result.errors).toHaveLength(0);
    });
  });
});
