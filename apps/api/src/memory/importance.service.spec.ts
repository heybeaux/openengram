import { Test, TestingModule } from '@nestjs/testing';
import { ImportanceService, ImportanceInput } from './importance.service';
import { ImportanceHint, MemoryLayer } from '@prisma/client';

describe('ImportanceService', () => {
  let service: ImportanceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ImportanceService],
    }).compile();

    service = module.get<ImportanceService>(ImportanceService);
  });

  describe('calculate', () => {
    it('should return base score of ~0.17 when no inputs provided', () => {
      const result = service.calculate({});
      // Base 50 / 300 = 0.167
      expect(result).toBeCloseTo(0.17, 1);
    });

    describe('hint boosts', () => {
      it('should not boost score for LOW hint', () => {
        const result = service.calculate({ hint: ImportanceHint.LOW });
        expect(result).toBeCloseTo(0.17, 1); // 50 / 300
      });

      it('should boost score for MEDIUM hint', () => {
        const result = service.calculate({ hint: ImportanceHint.MEDIUM });
        // (50 + 25) / 300 = 0.25
        expect(result).toBeCloseTo(0.25, 1);
      });

      it('should boost score for HIGH hint', () => {
        const result = service.calculate({ hint: ImportanceHint.HIGH });
        // (50 + 50) / 300 = 0.333
        expect(result).toBeCloseTo(0.33, 1);
      });

      it('should boost score significantly for CRITICAL hint', () => {
        const result = service.calculate({ hint: ImportanceHint.CRITICAL });
        // (50 + 100) / 300 = 0.5
        expect(result).toBeCloseTo(0.5, 1);
      });
    });

    describe('layer weights', () => {
      it('should apply 2x weight for IDENTITY layer', () => {
        const result = service.calculate({ layer: MemoryLayer.IDENTITY });
        // 50 * 2.0 / 300 = 0.333
        expect(result).toBeCloseTo(0.33, 1);
      });

      it('should apply 1.5x weight for PROJECT layer', () => {
        const result = service.calculate({ layer: MemoryLayer.PROJECT });
        // 50 * 1.5 / 300 = 0.25
        expect(result).toBeCloseTo(0.25, 1);
      });

      it('should apply 1x weight for SESSION layer', () => {
        const result = service.calculate({ layer: MemoryLayer.SESSION });
        // 50 * 1.0 / 300 = 0.167
        expect(result).toBeCloseTo(0.17, 1);
      });

      it('should apply 0.5x weight for TASK layer', () => {
        const result = service.calculate({ layer: MemoryLayer.TASK });
        // 50 * 0.5 / 300 = 0.083
        expect(result).toBeCloseTo(0.08, 1);
      });
    });

    describe('correction boost', () => {
      it('should add 50 to score for corrections', () => {
        const result = service.calculate({ isCorrection: true });
        // (50 + 50) / 300 = 0.333
        expect(result).toBeCloseTo(0.33, 1);
      });
    });

    describe('repetition boost', () => {
      it('should add 10 per repetition', () => {
        const result = service.calculate({ repetitionCount: 3 });
        // (50 + 30) / 300 = 0.267
        expect(result).toBeCloseTo(0.27, 1);
      });

      it('should handle high repetition counts', () => {
        const result = service.calculate({ repetitionCount: 10 });
        // (50 + 100) / 300 = 0.5
        expect(result).toBeCloseTo(0.5, 1);
      });
    });

    describe('reference boost', () => {
      it('should add 5 per reference', () => {
        const result = service.calculate({ referenceCount: 4 });
        // (50 + 20) / 300 = 0.233
        expect(result).toBeCloseTo(0.23, 1);
      });
    });

    describe('position boost', () => {
      it('should apply 1.2x multiplier for primacy', () => {
        const result = service.calculate({ isPrimacy: true });
        // 50 * 1.2 / 300 = 0.2
        expect(result).toBeCloseTo(0.2, 1);
      });

      it('should apply 1.2x multiplier for recency', () => {
        const result = service.calculate({ isRecency: true });
        // 50 * 1.2 / 300 = 0.2
        expect(result).toBeCloseTo(0.2, 1);
      });
    });

    describe('combined inputs', () => {
      it('should combine all boosts correctly', () => {
        const input: ImportanceInput = {
          hint: ImportanceHint.HIGH,
          layer: MemoryLayer.IDENTITY,
          isCorrection: true,
          repetitionCount: 2,
          referenceCount: 2,
          isPrimacy: true,
        };
        const result = service.calculate(input);
        // (50 + 50 + 50 + 20 + 10) * 1.2 * 2.0 / 300 = 432 / 300 = 1.0 (capped)
        expect(result).toBe(1);
      });

      it('should cap score at 1.0', () => {
        const input: ImportanceInput = {
          hint: ImportanceHint.CRITICAL,
          layer: MemoryLayer.IDENTITY,
          isCorrection: true,
          repetitionCount: 10,
          referenceCount: 10,
          isPrimacy: true,
        };
        const result = service.calculate(input);
        expect(result).toBe(1);
      });
    });

    it('should return score with 2 decimal places', () => {
      const result = service.calculate({ hint: ImportanceHint.MEDIUM });
      expect(result.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(
        2,
      );
    });
  });

  describe('recalculate', () => {
    it('should increase score by 2% on retrieval', () => {
      const result = service.recalculate(0.5, 'retrieved');
      expect(result).toBeCloseTo(0.51, 2);
    });

    it('should increase score by 5% on usage', () => {
      const result = service.recalculate(0.5, 'used');
      expect(result).toBeCloseTo(0.525, 2);
    });

    it('should increase score by 10% on confirmation', () => {
      const result = service.recalculate(0.5, 'confirmed');
      expect(result).toBeCloseTo(0.55, 2);
    });

    it('should decrease score by 50% on correction', () => {
      const result = service.recalculate(0.8, 'corrected');
      expect(result).toBeCloseTo(0.4, 2);
    });

    it('should cap score at 1.0', () => {
      const result = service.recalculate(0.99, 'confirmed');
      expect(result).toBeLessThanOrEqual(1);
    });

    it('should not go below 0', () => {
      const result = service.recalculate(0.01, 'corrected');
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe('applyDecay', () => {
    it('should not decay IDENTITY layer memories', () => {
      const lastAccess = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
      const result = service.applyDecay(0.8, lastAccess, MemoryLayer.IDENTITY);
      expect(result).toBe(0.8);
    });

    it('should decay PROJECT layer at 1% per day', () => {
      const lastAccess = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
      const result = service.applyDecay(1.0, lastAccess, MemoryLayer.PROJECT);
      // exp(-0.01 * 10) ≈ 0.905
      expect(result).toBeCloseTo(0.905, 2);
    });

    it('should decay SESSION layer at 2% per day', () => {
      const lastAccess = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
      const result = service.applyDecay(1.0, lastAccess, MemoryLayer.SESSION);
      // exp(-0.02 * 10) ≈ 0.819
      expect(result).toBeCloseTo(0.819, 2);
    });

    it('should decay TASK layer at 5% per day', () => {
      const lastAccess = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
      const result = service.applyDecay(1.0, lastAccess, MemoryLayer.TASK);
      // exp(-0.05 * 10) ≈ 0.607
      expect(result).toBeCloseTo(0.607, 2);
    });

    it('should not decay recently accessed memories significantly', () => {
      const lastAccess = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1 day ago
      const result = service.applyDecay(1.0, lastAccess, MemoryLayer.SESSION);
      // exp(-0.02 * 1) ≈ 0.98
      expect(result).toBeCloseTo(0.98, 2);
    });

    it('should handle very old memories', () => {
      const lastAccess = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); // 1 year ago
      const result = service.applyDecay(1.0, lastAccess, MemoryLayer.TASK);
      expect(result).toBeLessThan(0.01);
    });
  });
});
