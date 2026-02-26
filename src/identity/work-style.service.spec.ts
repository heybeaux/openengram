import { Test, TestingModule } from '@nestjs/testing';
import { WorkStyleService } from './work-style.service';
import { PrismaService } from '../prisma/prisma.service';

describe('WorkStyleService', () => {
  let service: WorkStyleService;
  let prisma: any;

  const mockStyle = {
    id: 'ws-1',
    agentId: 'agent-1',
    userId: 'user-1',
    dimension: 'task_duration',
    value: { avg: 5000, min: 2000, max: 8000, latest: 6000 },
    sampleCount: 10,
    trend: 'stable',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      agentWorkStyle: {
        findMany: jest.fn().mockResolvedValue([mockStyle]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(mockStyle),
        update: jest.fn().mockResolvedValue(mockStyle),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkStyleService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(WorkStyleService);
  });

  describe('getWorkStyle', () => {
    it('should return work style dimensions', async () => {
      const result = await service.getWorkStyle('agent-1', 'user-1');
      expect(result).toHaveLength(1);
      expect(result[0].dimension).toBe('task_duration');
      expect(result[0].sampleCount).toBe(10);
    });
  });

  describe('recordObservation', () => {
    it('should create a new numeric dimension', async () => {
      await service.recordObservation(
        'agent-1',
        'user-1',
        'response_time',
        1500,
      );

      expect(prisma.agentWorkStyle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dimension: 'response_time',
            value: { avg: 1500, min: 1500, max: 1500, latest: 1500 },
            sampleCount: 1,
          }),
        }),
      );
    });

    it('should create a new categorical dimension', async () => {
      await service.recordObservation('agent-1', 'user-1', 'tool_usage', 'git');

      expect(prisma.agentWorkStyle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dimension: 'tool_usage',
            value: { frequencies: { git: 1 }, latest: 'git' },
          }),
        }),
      );
    });

    it('should update existing numeric dimension with running average', async () => {
      prisma.agentWorkStyle.findUnique.mockResolvedValue(mockStyle);

      await service.recordObservation(
        'agent-1',
        'user-1',
        'task_duration',
        7000,
      );

      expect(prisma.agentWorkStyle.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sampleCount: 11,
          }),
        }),
      );

      // Verify the new average is calculated correctly
      const updateCall = prisma.agentWorkStyle.update.mock.calls[0][0];
      const newValue = updateCall.data.value;
      expect(newValue.avg).toBeCloseTo((5000 * 10 + 7000) / 11);
      expect(newValue.max).toBe(8000);
      expect(newValue.latest).toBe(7000);
    });
  });

  describe('extractFromTaskOutcome', () => {
    it('should extract multiple work style observations from an outcome', async () => {
      await service.extractFromTaskOutcome('agent-1', 'user-1', {
        durationMs: 3000,
        capabilitiesUsed: ['coding', 'testing'],
        outcome: 'success',
      });

      // Should record: task_duration, capability_breadth, 2x tool_usage, outcome_distribution
      expect(prisma.agentWorkStyle.create).toHaveBeenCalledTimes(5);
    });
  });
});
