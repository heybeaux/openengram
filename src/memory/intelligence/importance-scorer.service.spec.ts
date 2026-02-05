import { ImportanceScorerService } from './importance-scorer.service';
import { MemoryLayer } from '@prisma/client';

describe('ImportanceScorerService', () => {
  let scorer: ImportanceScorerService;

  beforeEach(() => {
    scorer = new ImportanceScorerService();
  });

  const createMockMemory = (overrides: Partial<any> = {}) => ({
    id: 'test-memory-1',
    userId: 'user-1',
    raw: 'Test memory content',
    layer: MemoryLayer.SESSION,
    importanceScore: 0.5,
    userPinned: false,
    safetyCritical: false,
    retrievalCount: 0,
    usedCount: 0,
    createdAt: new Date(),
    ...overrides,
  });

  describe('computeScore', () => {
    it('should return base score for new memory with no boosts', () => {
      const now = new Date();
      const memory = createMockMemory({ createdAt: now });

      const result = scorer.computeScore(memory, now);

      expect(result.baseScore).toBe(0.5);
      expect(result.effectiveScore).toBeGreaterThanOrEqual(0.5);
      expect(result.effectiveScore).toBeLessThanOrEqual(1.0);
    });

    it('should apply novelty boost to new memories', () => {
      const now = new Date();
      const memory = createMockMemory({ createdAt: now });

      const result = scorer.computeScore(memory, now);

      expect(result.noveltyBoost).toBe(0.15); // Full novelty boost
    });

    it('should taper novelty boost over 7 days', () => {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      const memory = createMockMemory({ createdAt: threeDaysAgo });

      const result = scorer.computeScore(memory, now);

      // Should be about 4/7 of the full boost
      expect(result.noveltyBoost).toBeCloseTo(0.15 * (4 / 7), 2);
    });

    it('should return zero novelty boost for memories older than 7 days', () => {
      const now = new Date();
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
      const memory = createMockMemory({ createdAt: tenDaysAgo });

      const result = scorer.computeScore(memory, now);

      expect(result.noveltyBoost).toBe(0);
    });

    it('should apply pinned boost', () => {
      const now = new Date();
      const memory = createMockMemory({ createdAt: now, userPinned: true });

      const result = scorer.computeScore(memory, now);

      expect(result.pinnedBoost).toBe(0.5);
      expect(result.effectiveScore).toBeGreaterThan(0.9);
    });

    it('should enforce safety floor for safety-critical memories', () => {
      const now = new Date();
      const oldMemory = createMockMemory({
        createdAt: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000), // 1 year old
        safetyCritical: true,
        importanceScore: 0.3, // Low base score
      });

      const result = scorer.computeScore(oldMemory, now);

      expect(result.safetyFloor).toBe(0.6);
      expect(result.effectiveScore).toBeGreaterThanOrEqual(0.6);
    });

    it('should not cap non-safety memories at safety floor', () => {
      const now = new Date();
      const oldMemory = createMockMemory({
        createdAt: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000),
        safetyCritical: false,
        importanceScore: 0.2,
      });

      const result = scorer.computeScore(oldMemory, now);

      expect(result.safetyFloor).toBe(0);
      expect(result.effectiveScore).toBeLessThan(0.6);
    });
  });

  describe('computeDecayFactor', () => {
    it('should not decay IDENTITY layer memories', () => {
      const now = new Date();
      const oldMemory = createMockMemory({
        layer: MemoryLayer.IDENTITY,
        createdAt: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000),
      });

      const decay = scorer.computeDecayFactor(oldMemory, now);

      expect(decay).toBe(1.0);
    });

    it('should decay SESSION memories with 14-day half-life', () => {
      const now = new Date();
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const memory = createMockMemory({
        layer: MemoryLayer.SESSION,
        createdAt: fourteenDaysAgo,
      });

      const decay = scorer.computeDecayFactor(memory, now);

      expect(decay).toBeCloseTo(0.5, 1); // Half-life reached
    });

    it('should decay TASK memories faster (3-day half-life)', () => {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      const memory = createMockMemory({
        layer: MemoryLayer.TASK,
        createdAt: threeDaysAgo,
      });

      const decay = scorer.computeDecayFactor(memory, now);

      expect(decay).toBeCloseTo(0.5, 1); // Half-life reached
    });

    it('should enforce minimum decay factor', () => {
      const now = new Date();
      const veryOld = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      const memory = createMockMemory({
        layer: MemoryLayer.TASK,
        createdAt: veryOld,
      });

      const decay = scorer.computeDecayFactor(memory, now);

      expect(decay).toBeGreaterThanOrEqual(0.1);
    });
  });

  describe('computeUsageBoost', () => {
    it('should return 0 for unused memories', () => {
      const memory = createMockMemory({ retrievalCount: 0, usedCount: 0 });

      const boost = scorer.computeUsageBoost(memory);

      expect(boost).toBe(0);
    });

    it('should increase boost with usage', () => {
      const memory = createMockMemory({ retrievalCount: 5, usedCount: 5 });

      const boost = scorer.computeUsageBoost(memory);

      expect(boost).toBe(0.2); // 10 uses * 0.02
    });

    it('should cap usage boost at maximum', () => {
      const memory = createMockMemory({ retrievalCount: 100, usedCount: 100 });

      const boost = scorer.computeUsageBoost(memory);

      expect(boost).toBe(0.3); // Capped at maxUsageBoost
    });
  });
});
