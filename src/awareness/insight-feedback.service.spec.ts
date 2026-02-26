import { InsightFeedbackService } from './insight-feedback.service';
import { InsightFeedbackAction } from './dto/insight-feedback.dto';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('InsightFeedbackService', () => {
  let service: InsightFeedbackService;
  let prisma: any;

  const mockInsight = {
    id: 'insight-1',
    layer: 'INSIGHT',
    userId: 'user-1',
    confidence: 0.7,
    raw: 'Test insight',
    metadata: {
      insightType: 'pattern_connection',
      actionable: true,
      acknowledged: false,
    },
  };

  beforeEach(() => {
    prisma = {
      memory: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };

    service = new InsightFeedbackService(prisma as unknown as PrismaService);
  });

  describe('recordFeedback', () => {
    it('should throw NotFoundException for non-existent insight', async () => {
      prisma.memory.findUnique.mockResolvedValue(null);

      await expect(
        service.recordFeedback('nonexistent', InsightFeedbackAction.HELPFUL),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for non-INSIGHT memory', async () => {
      prisma.memory.findUnique.mockResolvedValue({
        ...mockInsight,
        layer: 'SESSION',
      });

      await expect(
        service.recordFeedback('insight-1', InsightFeedbackAction.HELPFUL),
      ).rejects.toThrow(NotFoundException);
    });

    it('should increase confidence when marked helpful', async () => {
      prisma.memory.findUnique.mockResolvedValue(mockInsight);
      prisma.memory.findMany.mockResolvedValue([]);
      prisma.memory.update.mockResolvedValue({});

      const result = await service.recordFeedback(
        'insight-1',
        InsightFeedbackAction.HELPFUL,
      );

      expect(result.previousConfidence).toBe(0.7);
      expect(result.newConfidence).toBeCloseTo(0.8, 5); // 0.7 + 0.1
      expect(result.action).toBe(InsightFeedbackAction.HELPFUL);

      // Verify insight was updated
      const updateCall = prisma.memory.update.mock.calls[0][0];
      expect(updateCall.where.id).toBe('insight-1');
      expect(updateCall.data.confidence).toBeCloseTo(0.8, 5);
      expect(updateCall.data.metadata.acknowledged).toBe(true);
      expect(updateCall.data.metadata.lastFeedbackAction).toBe(
        InsightFeedbackAction.HELPFUL,
      );
      expect(updateCall.data.metadata.feedbackHistory).toHaveLength(1);
      expect(updateCall.data.metadata.feedbackHistory[0].action).toBe(
        InsightFeedbackAction.HELPFUL,
      );
    });

    it('should increase confidence more when acted on', async () => {
      prisma.memory.findUnique.mockResolvedValue(mockInsight);
      prisma.memory.findMany.mockResolvedValue([]);
      prisma.memory.update.mockResolvedValue({});

      const result = await service.recordFeedback(
        'insight-1',
        InsightFeedbackAction.ACTED_ON,
      );

      expect(result.newConfidence).toBeCloseTo(0.85); // 0.7 + 0.15
    });

    it('should decrease confidence when dismissed', async () => {
      prisma.memory.findUnique.mockResolvedValue(mockInsight);
      prisma.memory.findMany.mockResolvedValue([]);
      prisma.memory.update.mockResolvedValue({});

      const result = await service.recordFeedback(
        'insight-1',
        InsightFeedbackAction.DISMISSED,
      );

      expect(result.newConfidence).toBeCloseTo(0.6); // 0.7 - 0.1
    });

    it('should clamp confidence to [0, 1]', async () => {
      const highConfidence = { ...mockInsight, confidence: 0.95 };
      prisma.memory.findUnique.mockResolvedValue(highConfidence);
      prisma.memory.findMany.mockResolvedValue([]);
      prisma.memory.update.mockResolvedValue({});

      const result = await service.recordFeedback(
        'insight-1',
        InsightFeedbackAction.ACTED_ON,
      );

      expect(result.newConfidence).toBe(1); // clamped at 1
    });

    it('should adjust similar unacknowledged insights at half strength', async () => {
      prisma.memory.findUnique.mockResolvedValue(mockInsight);
      prisma.memory.findMany.mockResolvedValue([
        {
          id: 'insight-2',
          layer: 'INSIGHT',
          confidence: 0.6,
          metadata: { insightType: 'pattern_connection', acknowledged: false },
        },
        {
          id: 'insight-3',
          layer: 'INSIGHT',
          confidence: 0.5,
          metadata: { insightType: 'recurring_pattern', acknowledged: false }, // different type
        },
        {
          id: 'insight-4',
          layer: 'INSIGHT',
          confidence: 0.7,
          metadata: { insightType: 'pattern_connection', acknowledged: true }, // already acknowledged
        },
      ]);
      prisma.memory.update.mockResolvedValue({});

      const result = await service.recordFeedback(
        'insight-1',
        InsightFeedbackAction.DISMISSED,
      );

      expect(result.similarInsightsAdjusted).toBe(1); // only insight-2

      // insight-2 should be adjusted: 0.6 + (-0.1 * 0.5) = 0.55
      const updateCalls = prisma.memory.update.mock.calls;
      const insight2Update = updateCalls.find(
        (c: any) => c[0].where.id === 'insight-2',
      );
      expect(insight2Update).toBeDefined();
      expect(insight2Update![0].data.confidence).toBeCloseTo(0.55, 5);
    });

    it('should store comment in feedback history', async () => {
      prisma.memory.findUnique.mockResolvedValue(mockInsight);
      prisma.memory.findMany.mockResolvedValue([]);
      prisma.memory.update.mockResolvedValue({});

      await service.recordFeedback(
        'insight-1',
        InsightFeedbackAction.DISMISSED,
        'Not relevant to me',
      );

      expect(prisma.memory.update).toHaveBeenCalledWith({
        where: { id: 'insight-1' },
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            feedbackHistory: expect.arrayContaining([
              expect.objectContaining({
                action: InsightFeedbackAction.DISMISSED,
                comment: 'Not relevant to me',
              }),
            ]),
          }),
        }),
      });
    });
  });

  describe('getFeedbackStats', () => {
    it('should aggregate feedback stats by insight type', async () => {
      prisma.memory.findMany.mockResolvedValue([
        {
          metadata: {
            insightType: 'pattern_connection',
            feedbackHistory: [{ action: 'dismissed' }, { action: 'helpful' }],
          },
        },
        {
          metadata: {
            insightType: 'pattern_connection',
            feedbackHistory: [{ action: 'acted_on' }],
          },
        },
        {
          metadata: {
            insightType: 'stale_thread', // different type — should be excluded
            feedbackHistory: [{ action: 'dismissed' }],
          },
        },
      ]);

      const stats = await service.getFeedbackStats(
        'user-1',
        'pattern_connection',
      );

      expect(stats.totalFeedback).toBe(3);
      expect(stats.dismissed).toBe(1);
      expect(stats.actedOn).toBe(1);
      expect(stats.helpful).toBe(1);
    });

    it('should return zeros for unknown insight type', async () => {
      prisma.memory.findMany.mockResolvedValue([]);

      const stats = await service.getFeedbackStats('user-1', 'nonexistent');

      expect(stats.totalFeedback).toBe(0);
      expect(stats.avgConfidenceAdjustment).toBe(0);
    });
  });
});
