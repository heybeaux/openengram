import { IdentityController } from './identity.controller';
import { TaskCompletionService } from './task-completion.service';
import { DelegationTemplateService } from './delegation-template.service';
import { TrustProfileService } from './trust-profile.service';
import { TaskOutcome } from './dto/task-completion.dto';

describe('IdentityController', () => {
  let controller: IdentityController;
  let taskCompletionService: any;
  let delegationTemplateService: any;
  let trustProfileService: any;

  beforeEach(() => {
    taskCompletionService = {
      create: jest.fn().mockResolvedValue({ id: 'tc_1' }),
      query: jest.fn().mockResolvedValue([]),
    };
    delegationTemplateService = {
      suggest: jest.fn().mockResolvedValue({
        suggestedAgent: 'agent-a',
        confidence: 0.8,
      }),
    };
    trustProfileService = {
      getProfile: jest.fn().mockResolvedValue({
        agentId: 'agent-a',
        overallTrust: 0.9,
        domains: [],
      }),
    };

    controller = new IdentityController(
      taskCompletionService as TaskCompletionService,
      delegationTemplateService as DelegationTemplateService,
      trustProfileService as TrustProfileService,
    );
  });

  describe('POST /task-completions', () => {
    it('should create a task completion', async () => {
      const result = await controller.createTaskCompletion({
        taskId: 'task-1',
        delegatedTo: 'agent-a',
        delegatedBy: 'agent-b',
        taskDescription: 'Test task',
        outcome: TaskOutcome.SUCCESS,
        durationMs: 5000,
      });

      expect(result).toEqual({ id: 'tc_1' });
      expect(taskCompletionService.create).toHaveBeenCalled();
    });
  });

  describe('GET /task-completions', () => {
    it('should query completions', async () => {
      const result = await controller.queryTaskCompletions({
        agentId: 'agent-a',
      });

      expect(result).toEqual([]);
      expect(taskCompletionService.query).toHaveBeenCalledWith({
        agentId: 'agent-a',
      });
    });
  });

  describe('GET /delegation-templates', () => {
    it('should return delegation template', async () => {
      const result = await controller.getDelegationTemplates('Build auth');

      expect(result.suggestedAgent).toBe('agent-a');
      expect(delegationTemplateService.suggest).toHaveBeenCalledWith('Build auth');
    });

    it('should return error when no taskDescription', async () => {
      const result = await controller.getDelegationTemplates('');

      expect(result).toEqual({
        error: 'taskDescription query parameter is required',
      });
    });
  });

  describe('GET /agents/:id/trust-profile', () => {
    it('should return trust profile', async () => {
      const result = await controller.getTrustProfile('agent-a');

      expect(result.agentId).toBe('agent-a');
      expect(trustProfileService.getProfile).toHaveBeenCalledWith('agent-a');
    });
  });
});
