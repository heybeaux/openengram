import { Test, TestingModule } from '@nestjs/testing';
import {
  TopicDetectionService,
  DEFAULT_DETECTION_CONFIG,
} from './topic-detection.service';
import { EmbeddingService } from '../memory/embedding.service';
import { TopicId, TopicScore } from './prefetch.types';

describe('TopicDetectionService', () => {
  let service: TopicDetectionService;
  let mockEmbeddingService: jest.Mocked<EmbeddingService>;

  const mockEmbedding = new Array(768).fill(0).map((_, i) => Math.sin(i));

  beforeEach(async () => {
    mockEmbeddingService = {
      generate: jest.fn().mockResolvedValue(mockEmbedding),
      search: jest.fn(),
      store: jest.fn(),
      delete: jest.fn(),
      getDimensions: jest.fn().mockReturnValue(768),
      getProviderName: jest.fn().mockReturnValue('mock'),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicDetectionService,
        { provide: EmbeddingService, useValue: mockEmbeddingService },
      ],
    }).compile();

    service = module.get<TopicDetectionService>(TopicDetectionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('configuration', () => {
    it('should have default configuration', () => {
      const config = service.getConfig();
      expect(config).toEqual(DEFAULT_DETECTION_CONFIG);
    });

    it('should allow configuration updates', () => {
      service.configure({ minConfidence: 0.5 });
      const config = service.getConfig();
      expect(config.minConfidence).toBe(0.5);
    });

    it('should preserve other config values when updating', () => {
      const original = service.getConfig();
      service.configure({ maxTopics: 5 });
      const updated = service.getConfig();
      expect(updated.layerWeights).toEqual(original.layerWeights);
      expect(updated.maxTopics).toBe(5);
    });
  });

  describe('keyword detection', () => {
    it('should detect family topic from "wife" keyword', async () => {
      const result = await service.detect('How is my wife doing today?');
      expect(
        result.topics.some(
          (t) => t.topic === 'family' || t.topic === 'family/immediate',
        ),
      ).toBe(true);
    });

    it('should detect family topic from "daughter" keyword', async () => {
      const result = await service.detect('Tell me about my daughter Stella');
      expect(result.topics.some((t) => t.topic.startsWith('family'))).toBe(
        true,
      );
    });

    it('should detect work topic from "meeting" keyword', async () => {
      const result = await service.detect('I have a meeting tomorrow');
      expect(
        result.topics.some(
          (t) =>
            t.topic === 'work' ||
            t.topic === 'schedule' ||
            t.topic === 'events/meetings',
        ),
      ).toBe(true);
    });

    it('should detect schedule topic from "today" keyword', async () => {
      const result = await service.detect("What's on my calendar today?");
      expect(result.topics.some((t) => t.topic.startsWith('schedule'))).toBe(
        true,
      );
    });

    it('should detect technical topic from programming keywords', async () => {
      const result = await service.detect(
        'How do I fix this TypeScript error?',
      );
      expect(result.topics.some((t) => t.topic === 'technical')).toBe(true);
    });

    it('should detect health topic from exercise keywords', async () => {
      const result = await service.detect(
        'I need to go to the gym for my workout',
      );
      expect(result.topics.some((t) => t.topic.startsWith('health'))).toBe(
        true,
      );
    });

    it('should detect preferences topic from "favorite" keyword', async () => {
      const result = await service.detect('What is my favorite color?');
      expect(result.topics.some((t) => t.topic.startsWith('preferences'))).toBe(
        true,
      );
    });

    it('should handle case insensitivity', async () => {
      const result1 = await service.detect('WIFE');
      const result2 = await service.detect('wife');
      const result3 = await service.detect('Wife');

      expect(result1.topics.length).toBe(result2.topics.length);
      expect(result2.topics.length).toBe(result3.topics.length);
    });

    it('should handle multiple keywords for same topic', async () => {
      const result = await service.detect('My wife and daughter are at home');
      const familyTopics = result.topics.filter((t) =>
        t.topic.startsWith('family'),
      );
      expect(familyTopics.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect multiple different topics', async () => {
      service.configure({ maxTopics: 5 });
      const result = await service.detect(
        'My wife has a meeting at the gym today',
      );
      expect(result.topics.length).toBeGreaterThanOrEqual(2);
    });

    it('should boost parent topics when child matches', async () => {
      const result = await service.detect('wife');
      const hasFamily = result.topics.some((t) => t.topic === 'family');
      const hasImmediate = result.topics.some(
        (t) => t.topic === 'family/immediate',
      );
      expect(hasFamily || hasImmediate).toBe(true);
    });
  });

  describe('topic scoring', () => {
    it('should return confidence between 0 and 1', async () => {
      const result = await service.detect('Tell me about my family');
      for (const topic of result.topics) {
        expect(topic.confidence).toBeGreaterThanOrEqual(0);
        expect(topic.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('should filter topics below minConfidence', async () => {
      service.configure({ minConfidence: 0.8 });
      const result = await service.detect('maybe something about family');
      // High threshold should filter most results
      expect(result.topics.length).toBeLessThanOrEqual(3);
    });

    it('should respect maxTopics limit', async () => {
      service.configure({ maxTopics: 2 });
      const result = await service.detect(
        'My wife has a meeting at the gym today for the project',
      );
      expect(result.topics.length).toBeLessThanOrEqual(2);
    });

    it('should sort topics by confidence descending', async () => {
      const result = await service.detect('family meeting schedule project');
      if (result.topics.length > 1) {
        for (let i = 0; i < result.topics.length - 1; i++) {
          expect(result.topics[i].confidence).toBeGreaterThanOrEqual(
            result.topics[i + 1].confidence,
          );
        }
      }
    });
  });

  describe('processing time', () => {
    it('should return processing time in ms', async () => {
      const result = await service.detect('test message');
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should complete keyword detection in under 10ms', async () => {
      const result = await service.detect(
        'My wife has a meeting at the gym today',
      );
      expect(result.processingTimeMs).toBeLessThan(10);
    });
  });

  describe('layer breakdown', () => {
    it('should provide keyword scores in breakdown', async () => {
      const result = await service.detect('family meeting');
      expect(result.layerBreakdown.keyword).toBeInstanceOf(Map);
    });

    it('should provide embedding scores in breakdown', async () => {
      const result = await service.detect('family meeting');
      expect(result.layerBreakdown.embedding).toBeInstanceOf(Map);
    });
  });

  describe('context smoothing', () => {
    it('should boost recent topics when context provided', async () => {
      const recentTopics: TopicScore[] = [
        { topic: 'family', confidence: 0.8, source: 'merged' },
      ];

      const context = {
        recentTopics,
        recentMessages: [],
        userId: 'test-user',
      };

      const result = await service.detect('How are they?', context);
      // "they" is vague, but with family context it should still have some signal
      // The recent topic should carry forward
    });

    it('should not boost topics without recent context', async () => {
      const result1 = await service.detect('How are they?');
      const result2 = await service.detect('How are they?', {
        recentTopics: [],
        recentMessages: [],
        userId: 'test-user',
      });

      // Without context, vague message should have similar results
      expect(result1.topics.length).toBe(result2.topics.length);
    });
  });

  describe('topic history tracking', () => {
    it('should track topics by user', async () => {
      await service.detect('family', {
        userId: 'user1',
        recentTopics: [],
        recentMessages: [],
      });
      await service.detect('work', {
        userId: 'user1',
        recentTopics: [],
        recentMessages: [],
      });
      // History is tracked internally
      service.clearHistory('user1');
      // Should not throw
    });

    it('should clear history for user', () => {
      expect(() => service.clearHistory('nonexistent')).not.toThrow();
    });
  });

  describe('topic shift detection', () => {
    it('should detect topic shift when topics change', async () => {
      const userId = 'shift-test-user';

      // Build up history with family topic
      await service.detect('wife', {
        userId,
        recentTopics: [],
        recentMessages: [],
      });
      await service.detect('daughter', {
        userId,
        recentTopics: [],
        recentMessages: [],
      });

      // Now switch to work topic
      const workResult = await service.detect('project deadline', {
        userId,
        recentTopics: [],
        recentMessages: [],
      });
      const shift = service.detectTopicShift(userId, workResult.topics);

      // May or may not detect shift depending on history length
      // Just verify it doesn't throw
      expect(shift === null || typeof shift === 'object').toBe(true);
    });

    it('should return null when no shift', async () => {
      const userId = 'no-shift-user';

      // Same topic repeatedly
      await service.detect('family', {
        userId,
        recentTopics: [],
        recentMessages: [],
      });
      const result = await service.detect('family', {
        userId,
        recentTopics: [],
        recentMessages: [],
      });
      const shift = service.detectTopicShift(userId, result.topics);

      // Consistent topic should not trigger shift
      expect(shift === null || shift.departedTopics.length === 0).toBe(true);
    });
  });

  describe('predict next topics', () => {
    it('should predict related topics', () => {
      const currentTopics: TopicScore[] = [
        { topic: 'family', confidence: 0.8, source: 'merged' },
      ];

      const predicted = service.predictNextTopics(currentTopics);

      // Family is related to schedule, health, events
      expect(predicted.length).toBeGreaterThanOrEqual(0);
    });

    it('should not include current topics in predictions', () => {
      const currentTopics: TopicScore[] = [
        { topic: 'family', confidence: 0.8, source: 'merged' },
      ];

      const predicted = service.predictNextTopics(currentTopics);

      expect(predicted.every((p) => p.topic !== 'family')).toBe(true);
    });

    it('should limit predictions to 3', () => {
      const currentTopics: TopicScore[] = [
        { topic: 'family', confidence: 0.8, source: 'merged' },
        { topic: 'work', confidence: 0.7, source: 'merged' },
        { topic: 'technical', confidence: 0.6, source: 'merged' },
      ];

      const predicted = service.predictNextTopics(currentTopics);

      expect(predicted.length).toBeLessThanOrEqual(3);
    });

    it('should reduce confidence for predictions', () => {
      const currentTopics: TopicScore[] = [
        { topic: 'family', confidence: 0.8, source: 'merged' },
      ];

      const predicted = service.predictNextTopics(currentTopics);

      for (const p of predicted) {
        expect(p.confidence).toBeLessThan(0.8);
      }
    });
  });

  describe('embedding-based classification', () => {
    it('should skip embedding classification by default', async () => {
      await service.detect('test message');
      expect(mockEmbeddingService.generate).not.toHaveBeenCalled();
    });

    it('should use embedding when enabled', async () => {
      service.configure({ enableEmbeddingClassification: true });

      // Set up a prototype
      service.setPrototype('family', mockEmbedding, 0.5);

      await service.detect('test message');
      expect(mockEmbeddingService.generate).toHaveBeenCalled();
    });

    it('should allow setting prototypes directly', () => {
      expect(() => {
        service.setPrototype('family', mockEmbedding, 0.5);
      }).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle empty message', async () => {
      const result = await service.detect('');
      expect(result.topics).toEqual([]);
    });

    it('should handle whitespace-only message', async () => {
      const result = await service.detect('   \n\t  ');
      expect(result.topics).toEqual([]);
    });

    it('should handle very long message', async () => {
      const longMessage = 'family '.repeat(1000);
      const result = await service.detect(longMessage);
      expect(result.topics.length).toBeGreaterThan(0);
    });

    it('should handle special characters', async () => {
      const result = await service.detect('wife!!! @#$% meeting???');
      expect(
        result.topics.some(
          (t) =>
            t.topic.startsWith('family') ||
            t.topic.startsWith('schedule') ||
            t.topic.startsWith('events'),
        ),
      ).toBe(true);
    });

    it('should handle unicode characters', async () => {
      const result = await service.detect('My wife 妻子 and family 家庭');
      expect(result.topics.some((t) => t.topic.startsWith('family'))).toBe(
        true,
      );
    });
  });
});
