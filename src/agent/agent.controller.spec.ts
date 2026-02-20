import { Test, TestingModule } from '@nestjs/testing';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';
import { MemoryLayer } from '@prisma/client';

describe('AgentController', () => {
  let controller: AgentController;
  let mockAgentService: any;

  beforeEach(async () => {
    mockAgentService = {
      reflect: jest.fn(),
      getAgentMemories: jest.fn(),
      getAgentContext: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentController],
      providers: [{ provide: AgentService, useValue: mockAgentService }],
    })
      .overrideGuard(ApiKeyOrJwtGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AgentController>(AgentController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('reflect', () => {
    it('should call agentService.reflect with correct params', async () => {
      const dto = {
        recentTurns: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi!' },
        ],
        agentName: 'Rook',
      };
      const expected = {
        memoriesCreated: ['mem-1'],
        insightsExtracted: 1,
        categories: { identity: 1, lessons: 0, preferences: 0, workingStyle: 0 },
      };
      mockAgentService.reflect.mockResolvedValue(expected);

      const result = await controller.reflect('agent-1', dto as any);

      expect(result).toEqual(expected);
      expect(mockAgentService.reflect).toHaveBeenCalledWith('agent-1', dto);
    });
  });

  describe('getMemories', () => {
    it('should return agent memories', async () => {
      const memories = [{ id: 'mem-1', raw: 'I am Rook' }];
      mockAgentService.getAgentMemories.mockResolvedValue(memories);

      const result = await controller.getMemories('agent-1');

      expect(result).toEqual(memories);
      expect(mockAgentService.getAgentMemories).toHaveBeenCalledWith('agent-1', {
        layer: undefined,
        limit: undefined,
      });
    });

    it('should pass layer filter', async () => {
      mockAgentService.getAgentMemories.mockResolvedValue([]);

      await controller.getMemories('agent-1', MemoryLayer.IDENTITY);

      expect(mockAgentService.getAgentMemories).toHaveBeenCalledWith('agent-1', {
        layer: MemoryLayer.IDENTITY,
        limit: undefined,
      });
    });

    it('should parse limit as integer', async () => {
      mockAgentService.getAgentMemories.mockResolvedValue([]);

      await controller.getMemories('agent-1', undefined, 10);

      expect(mockAgentService.getAgentMemories).toHaveBeenCalledWith('agent-1', {
        layer: undefined,
        limit: 10,
      });
    });
  });

  describe('getContext', () => {
    it('should return formatted context', async () => {
      const context = { context: '## Agent Self-Knowledge\n- I am Rook', memoriesIncluded: 1 };
      mockAgentService.getAgentContext.mockResolvedValue(context);

      const result = await controller.getContext('agent-1');

      expect(result).toEqual(context);
      expect(mockAgentService.getAgentContext).toHaveBeenCalledWith('agent-1', undefined);
    });

    it('should pass maxTokens when provided', async () => {
      mockAgentService.getAgentContext.mockResolvedValue({ context: '', memoriesIncluded: 0 });

      await controller.getContext('agent-1', 500);

      expect(mockAgentService.getAgentContext).toHaveBeenCalledWith('agent-1', 500);
    });
  });
});
