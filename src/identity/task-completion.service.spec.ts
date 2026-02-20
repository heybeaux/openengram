import { Test, TestingModule } from '@nestjs/testing';
import { TaskCompletionService } from './task-completion.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { CreateTaskCompletionDto, TaskOutcome } from './dto/task-completion.dto';

describe('TaskCompletionService', () => {
  let service: TaskCompletionService;
  let prisma: any;
  let embedding: any;

  const mockCompletion = {
    id: 'tc_1',
    taskId: 'task-001',
    delegatedTo: 'agent-coder',
    delegatedBy: 'agent-lead',
    taskDescription: 'Implement user authentication',
    domain: 'typescript',
    outcome: 'success',
    durationMs: 120000,
    qualitySignals: { testsPass: true },
    metadata: {},
    embeddingText: 'Task completion: Implement user authentication',
    createdAt: new Date('2026-02-20'),
  };

  beforeEach(async () => {
    prisma = {
      taskCompletion: {
        create: jest.fn().mockResolvedValue(mockCompletion),
        findMany: jest.fn().mockResolvedValue([mockCompletion]),
      },
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    };

    embedding = {
      embedSingle: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskCompletionService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmbeddingService, useValue: embedding },
      ],
    }).compile();

    service = module.get(TaskCompletionService);
  });

  describe('create', () => {
    it('should create a task completion record', async () => {
      const dto: CreateTaskCompletionDto = {
        taskId: 'task-001',
        delegatedTo: 'agent-coder',
        delegatedBy: 'agent-lead',
        taskDescription: 'Implement user authentication',
        domain: 'typescript',
        outcome: TaskOutcome.SUCCESS,
        durationMs: 120000,
        qualitySignals: { testsPass: true },
      };

      const result = await service.create(dto);

      expect(result).toEqual(mockCompletion);
      expect(prisma.taskCompletion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          taskId: 'task-001',
          delegatedTo: 'agent-coder',
          outcome: 'success',
        }),
      });
    });

    it('should generate and store embedding', async () => {
      const dto: CreateTaskCompletionDto = {
        taskId: 'task-002',
        delegatedTo: 'agent-coder',
        delegatedBy: 'agent-lead',
        taskDescription: 'Build REST API',
        outcome: TaskOutcome.SUCCESS,
        durationMs: 60000,
      };

      await service.create(dto);

      expect(embedding.embedSingle).toHaveBeenCalledWith('Build REST API');
      expect(prisma.$executeRawUnsafe).toHaveBeenCalled();
    });

    it('should handle embedding failure gracefully', async () => {
      embedding.embedSingle.mockRejectedValue(new Error('embed fail'));

      const dto: CreateTaskCompletionDto = {
        taskId: 'task-003',
        delegatedTo: 'agent-x',
        delegatedBy: 'agent-y',
        taskDescription: 'Some task',
        outcome: TaskOutcome.FAILURE,
        durationMs: 5000,
      };

      const result = await service.create(dto);
      expect(result).toEqual(mockCompletion);
    });
  });

  describe('query', () => {
    it('should query by agentId', async () => {
      const result = await service.query({ agentId: 'agent-coder' });

      expect(result).toHaveLength(1);
      expect(prisma.taskCompletion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { delegatedTo: 'agent-coder' },
              { delegatedBy: 'agent-coder' },
            ],
          },
        }),
      );
    });

    it('should query by taskId', async () => {
      await service.query({ taskId: 'task-001' });

      expect(prisma.taskCompletion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { taskId: 'task-001' },
        }),
      );
    });

    it('should use default limit and offset', async () => {
      await service.query({});

      expect(prisma.taskCompletion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
          skip: 0,
        }),
      );
    });
  });

  describe('findSimilar', () => {
    it('should attempt vector search', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([
        { ...mockCompletion, similarity: 0.95 },
      ]);

      const result = await service.findSimilar('user authentication');

      expect(embedding.embedSingle).toHaveBeenCalledWith('user authentication');
      expect(result).toHaveLength(1);
      expect(result[0].similarity).toBe(0.95);
    });

    it('should fall back to text search on embedding failure', async () => {
      embedding.embedSingle.mockRejectedValue(new Error('fail'));
      prisma.taskCompletion.findMany.mockResolvedValue([mockCompletion]);

      const result = await service.findSimilar('user authentication');

      expect(result).toHaveLength(1);
      expect(result[0].similarity).toBe(0.5);
    });
  });

  describe('getCompletionsByAgent', () => {
    it('should filter by agent and domain', async () => {
      await service.getCompletionsByAgent('agent-coder', 'typescript');

      expect(prisma.taskCompletion.findMany).toHaveBeenCalledWith({
        where: { delegatedTo: 'agent-coder', domain: 'typescript' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});
