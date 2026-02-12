import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EvalService } from './eval.service';
import { PrismaService } from '../prisma/prisma.service';
import { ContextualRecallService } from '../memory/contextual-recall.service';
import { RECALL_QUERIES } from './eval-fixtures';

describe('EvalService', () => {
  let service: EvalService;
  let prisma: any;
  let contextualRecall: any;

  beforeEach(async () => {
    prisma = {
      evalRun: {
        create: jest.fn().mockResolvedValue({
          id: 'test-run-1',
          timestamp: new Date(),
          recallScore: 0.8,
          recallTotal: 25,
          recallPassed: 20,
          latencyP50Ms: 200,
          latencyP95Ms: 500,
          contextGrade: 'B',
          triggeredBy: 'manual',
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    contextualRecall = {
      recall: jest.fn().mockResolvedValue({
        memories: [{ id: '1', raw: 'Deanna is the wife', layer: 'IDENTITY', score: 0.9, topics: [] }],
        topicShift: true,
        tokenCount: 50,
        latencyMs: 100,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvalService,
        { provide: PrismaService, useValue: prisma },
        { provide: ContextualRecallService, useValue: contextualRecall },
        { provide: ConfigService, useValue: { get: () => 'Beaux' } },
      ],
    }).compile();

    service = module.get<EvalService>(EvalService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('runEval', () => {
    it('should run all recall queries and store results', async () => {
      const result = await service.runEval('test');

      expect(contextualRecall.recall).toHaveBeenCalledTimes(
        RECALL_QUERIES.length + 30, // recall queries + latency queries
      );
      expect(prisma.evalRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            recallTotal: RECALL_QUERIES.length,
            triggeredBy: 'test',
          }),
        }),
      );
      expect(result.id).toBe('test-run-1');
      expect(result.recallTotal).toBe(RECALL_QUERIES.length);
      expect(result.details).toHaveLength(RECALL_QUERIES.length);
    });
  });

  describe('getHistory', () => {
    it('should return recent runs with default limit', async () => {
      await service.getHistory();
      expect(prisma.evalRun.findMany).toHaveBeenCalledWith({
        orderBy: { timestamp: 'desc' },
        take: 20,
      });
    });

    it('should respect custom limit', async () => {
      await service.getHistory(5);
      expect(prisma.evalRun.findMany).toHaveBeenCalledWith({
        orderBy: { timestamp: 'desc' },
        take: 5,
      });
    });
  });

  describe('detectRegression', () => {
    it('should report insufficient data with < 2 runs', async () => {
      prisma.evalRun.findMany.mockResolvedValue([]);
      const result = await service.detectRegression();
      expect(result.hasRegression).toBe(false);
      expect(result.flags).toContain('Insufficient data (need at least 2 runs)');
    });

    it('should detect recall regression > 5%', async () => {
      prisma.evalRun.findMany.mockResolvedValue([
        { recallScore: 0.7, latencyP50Ms: 200 }, // latest - dropped
        { recallScore: 0.9, latencyP50Ms: 200 },
        { recallScore: 0.88, latencyP50Ms: 210 },
        { recallScore: 0.92, latencyP50Ms: 190 },
      ]);

      const result = await service.detectRegression();
      expect(result.hasRegression).toBe(true);
      expect(result.flags.some((f) => f.includes('Recall dropped'))).toBe(true);
    });

    it('should detect latency regression > 50%', async () => {
      prisma.evalRun.findMany.mockResolvedValue([
        { recallScore: 0.9, latencyP50Ms: 600 }, // latest - high latency
        { recallScore: 0.9, latencyP50Ms: 200 },
        { recallScore: 0.9, latencyP50Ms: 210 },
        { recallScore: 0.9, latencyP50Ms: 190 },
      ]);

      const result = await service.detectRegression();
      expect(result.hasRegression).toBe(true);
      expect(result.flags.some((f) => f.includes('Latency increased'))).toBe(true);
    });

    it('should not flag when metrics are stable', async () => {
      prisma.evalRun.findMany.mockResolvedValue([
        { recallScore: 0.9, latencyP50Ms: 200 },
        { recallScore: 0.9, latencyP50Ms: 200 },
        { recallScore: 0.88, latencyP50Ms: 210 },
      ]);

      const result = await service.detectRegression();
      expect(result.hasRegression).toBe(false);
      expect(result.flags).toHaveLength(0);
    });
  });
});
