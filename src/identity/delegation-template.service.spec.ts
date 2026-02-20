import { Test, TestingModule } from '@nestjs/testing';
import { DelegationTemplateService } from './delegation-template.service';
import { TaskCompletionService } from './task-completion.service';

describe('DelegationTemplateService', () => {
  let service: DelegationTemplateService;
  let taskCompletionService: any;

  const makeTc = (overrides: any = {}) => ({
    id: 'tc_1',
    taskId: 'task-001',
    delegatedTo: 'agent-coder',
    delegatedBy: 'agent-lead',
    taskDescription: 'Implement auth module',
    domain: 'typescript',
    outcome: 'success',
    durationMs: 120000,
    qualitySignals: {},
    metadata: {},
    createdAt: new Date('2026-02-20'),
    similarity: 0.9,
    ...overrides,
  });

  beforeEach(async () => {
    taskCompletionService = {
      findSimilar: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DelegationTemplateService,
        { provide: TaskCompletionService, useValue: taskCompletionService },
      ],
    }).compile();

    service = module.get(DelegationTemplateService);
  });

  it('should return empty template when no similar tasks', async () => {
    const result = await service.suggest('Build a spaceship');

    expect(result.suggestedAgent).toBe('');
    expect(result.confidence).toBe(0);
    expect(result.similarPastTasks).toHaveLength(0);
  });

  it('should suggest best agent from similar tasks', async () => {
    taskCompletionService.findSimilar.mockResolvedValue([
      makeTc({ delegatedTo: 'agent-a', outcome: 'success', similarity: 0.9 }),
      makeTc({ delegatedTo: 'agent-a', outcome: 'success', similarity: 0.85 }),
      makeTc({ delegatedTo: 'agent-b', outcome: 'failure', similarity: 0.8 }),
    ]);

    const result = await service.suggest('Build auth module');

    expect(result.suggestedAgent).toBe('agent-a');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.estimatedDurationMs).toBe(120000);
  });

  it('should prefer agent with higher success rate', async () => {
    taskCompletionService.findSimilar.mockResolvedValue([
      makeTc({ delegatedTo: 'agent-a', outcome: 'success', similarity: 0.8 }),
      makeTc({ delegatedTo: 'agent-a', outcome: 'failure', similarity: 0.8 }),
      makeTc({ delegatedTo: 'agent-b', outcome: 'success', similarity: 0.8 }),
      makeTc({ delegatedTo: 'agent-b', outcome: 'success', similarity: 0.8 }),
    ]);

    const result = await service.suggest('Some task');

    expect(result.suggestedAgent).toBe('agent-b');
  });

  it('should return similar past tasks limited to 5', async () => {
    const tasks = Array.from({ length: 10 }, (_, i) =>
      makeTc({ taskId: `task-${i}`, similarity: 0.9 - i * 0.05 }),
    );
    taskCompletionService.findSimilar.mockResolvedValue(tasks);

    const result = await service.suggest('Build something');

    expect(result.similarPastTasks.length).toBeLessThanOrEqual(5);
  });

  it('should suggest domain from similar tasks', async () => {
    taskCompletionService.findSimilar.mockResolvedValue([
      makeTc({ domain: 'typescript' }),
      makeTc({ domain: 'typescript' }),
      makeTc({ domain: 'devops' }),
    ]);

    const result = await service.suggest('TS task');

    expect(result.suggestedDomain).toBe('typescript');
  });

  it('should extract decomposition hints from domains', async () => {
    taskCompletionService.findSimilar.mockResolvedValue([
      makeTc({ domain: 'frontend', taskDescription: 'Build React component' }),
      makeTc({ domain: 'backend', taskDescription: 'Create API endpoint' }),
    ]);

    const result = await service.suggest('Full stack feature');

    expect(result.decomposition.length).toBeGreaterThan(0);
  });
});
