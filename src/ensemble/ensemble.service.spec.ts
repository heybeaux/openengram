/**
 * Ensemble Service Tests
 * 
 * Tests for RRF fusion algorithm and ensemble retrieval logic.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EnsembleService } from './ensemble.service';
import { ModelId, ModelSearchResult } from './ensemble.types';

describe('EnsembleService', () => {
  let service: EnsembleService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnsembleService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config: Record<string, any> = {
                ENSEMBLE_ENABLED: false, // Disable for unit tests
                LOCAL_EMBED_URL: 'http://localhost:8080',
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<EnsembleService>(EnsembleService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('reciprocalRankFusion', () => {
    it('should compute RRF scores correctly with default k=60', () => {
      const modelResults = new Map<ModelId, ModelSearchResult[]>();

      // BGE results
      modelResults.set('bge-base', [
        { memoryId: 'mem-1', model: 'bge-base', rank: 1, score: 0.95 },
        { memoryId: 'mem-2', model: 'bge-base', rank: 2, score: 0.85 },
        { memoryId: 'mem-3', model: 'bge-base', rank: 3, score: 0.75 },
      ]);

      // MiniLM results (different ordering)
      modelResults.set('minilm', [
        { memoryId: 'mem-2', model: 'minilm', rank: 1, score: 0.92 },
        { memoryId: 'mem-1', model: 'minilm', rank: 2, score: 0.88 },
        { memoryId: 'mem-4', model: 'minilm', rank: 3, score: 0.70 },
      ]);

      const results = service.reciprocalRankFusion(modelResults, 60);

      // mem-1: 1/(60+1) + 1/(60+2) ≈ 0.01639 + 0.01613 ≈ 0.03252
      // mem-2: 1/(60+2) + 1/(60+1) ≈ 0.01613 + 0.01639 ≈ 0.03252
      // mem-3: 1/(60+3) ≈ 0.01587
      // mem-4: 1/(60+3) ≈ 0.01587

      expect(results.length).toBe(4);

      // Top 2 should be mem-1 and mem-2 (they appear in both)
      const topIds = results.slice(0, 2).map(r => r.memoryId).sort();
      expect(topIds).toEqual(['mem-1', 'mem-2']);

      // Memories appearing in both models should have appearsInModels = 2
      const mem1 = results.find(r => r.memoryId === 'mem-1');
      expect(mem1?.appearsInModels).toBe(2);
      expect(mem1?.modelScores.size).toBe(2);

      // mem-4 only appears in minilm
      const mem4 = results.find(r => r.memoryId === 'mem-4');
      expect(mem4?.appearsInModels).toBe(1);
    });

    it('should apply model weights correctly', () => {
      const modelResults = new Map<ModelId, ModelSearchResult[]>();

      modelResults.set('bge-base', [
        { memoryId: 'mem-1', model: 'bge-base', rank: 1, score: 0.95 },
      ]);

      modelResults.set('minilm', [
        { memoryId: 'mem-2', model: 'minilm', rank: 1, score: 0.95 },
      ]);

      // Give BGE 2x weight
      const weights: Record<ModelId, number> = { 'bge-base': 2.0, 'minilm': 1.0 };
      const results = service.reciprocalRankFusion(modelResults, 60, weights);

      const mem1 = results.find(r => r.memoryId === 'mem-1');
      const mem2 = results.find(r => r.memoryId === 'mem-2');

      // mem-1 should have 2x the score of mem-2
      expect(mem1?.rrfScore).toBeCloseTo(mem2!.rrfScore * 2, 5);

      // mem-1 should be ranked first due to higher weight
      expect(results[0].memoryId).toBe('mem-1');
    });

    it('should handle empty results', () => {
      const modelResults = new Map<ModelId, ModelSearchResult[]>();
      modelResults.set('bge-base', []);
      modelResults.set('minilm', []);

      const results = service.reciprocalRankFusion(modelResults, 60);
      expect(results.length).toBe(0);
    });

    it('should handle single model results', () => {
      const modelResults = new Map<ModelId, ModelSearchResult[]>();

      modelResults.set('bge-base', [
        { memoryId: 'mem-1', model: 'bge-base', rank: 1, score: 0.95 },
        { memoryId: 'mem-2', model: 'bge-base', rank: 2, score: 0.85 },
      ]);

      const results = service.reciprocalRankFusion(modelResults, 60);

      expect(results.length).toBe(2);
      expect(results[0].memoryId).toBe('mem-1');
      expect(results[1].memoryId).toBe('mem-2');
    });

    it('should preserve model scores in results', () => {
      const modelResults = new Map<ModelId, ModelSearchResult[]>();

      modelResults.set('bge-base', [
        { memoryId: 'mem-1', model: 'bge-base', rank: 1, score: 0.95 },
      ]);

      modelResults.set('minilm', [
        { memoryId: 'mem-1', model: 'minilm', rank: 2, score: 0.88 },
      ]);

      const results = service.reciprocalRankFusion(modelResults, 60);
      const mem1 = results.find(r => r.memoryId === 'mem-1');

      expect(mem1?.modelScores.get('bge-base')).toEqual({ rank: 1, score: 0.95 });
      expect(mem1?.modelScores.get('minilm')).toEqual({ rank: 2, score: 0.88 });
    });

    it('should rank results by RRF score descending', () => {
      const modelResults = new Map<ModelId, ModelSearchResult[]>();

      // Create results where consensus matters
      modelResults.set('bge-base', [
        { memoryId: 'mem-1', model: 'bge-base', rank: 1, score: 0.95 },
        { memoryId: 'mem-3', model: 'bge-base', rank: 2, score: 0.90 },
      ]);

      modelResults.set('minilm', [
        { memoryId: 'mem-2', model: 'minilm', rank: 1, score: 0.95 },
        { memoryId: 'mem-1', model: 'minilm', rank: 2, score: 0.88 }, // mem-1 appears in both
      ]);

      const results = service.reciprocalRankFusion(modelResults, 60);

      // mem-1 should be first because it appears in both models
      expect(results[0].memoryId).toBe('mem-1');
      expect(results[0].rrfScore).toBeGreaterThan(results[1].rrfScore);
    });

    it('should use k parameter correctly', () => {
      const modelResults = new Map<ModelId, ModelSearchResult[]>();

      modelResults.set('bge-base', [
        { memoryId: 'mem-1', model: 'bge-base', rank: 1, score: 0.95 },
      ]);

      // With k=60: score = 1/(60+1) ≈ 0.01639
      const resultsK60 = service.reciprocalRankFusion(modelResults, 60);
      expect(resultsK60[0].rrfScore).toBeCloseTo(1 / 61, 5);

      // With k=10: score = 1/(10+1) ≈ 0.0909
      const resultsK10 = service.reciprocalRankFusion(modelResults, 10);
      expect(resultsK10[0].rrfScore).toBeCloseTo(1 / 11, 5);

      // Lower k should give higher scores
      expect(resultsK10[0].rrfScore).toBeGreaterThan(resultsK60[0].rrfScore);
    });
  });

  describe('getConfig', () => {
    it('should return configuration', () => {
      const config = service.getConfig();
      expect(config).toHaveProperty('enabled');
      expect(config).toHaveProperty('models');
      expect(config).toHaveProperty('weights');
      expect(config).toHaveProperty('rrfK');
    });
  });

  describe('isEnabled', () => {
    it('should return enabled status', () => {
      expect(typeof service.isEnabled()).toBe('boolean');
    });
  });
});

describe('EnsembleService RRF Edge Cases', () => {
  let service: EnsembleService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnsembleService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<EnsembleService>(EnsembleService);
  });

  it('should handle large result sets', () => {
    const modelResults = new Map<ModelId, ModelSearchResult[]>();

    // Generate 100 results per model
    const bgeResults: ModelSearchResult[] = [];
    const minilmResults: ModelSearchResult[] = [];

    for (let i = 0; i < 100; i++) {
      bgeResults.push({
        memoryId: `mem-${i}`,
        model: 'bge-base',
        rank: i + 1,
        score: 1 - i * 0.01,
      });

      // Shuffle for minilm (different ordering)
      minilmResults.push({
        memoryId: `mem-${99 - i}`,
        model: 'minilm',
        rank: i + 1,
        score: 1 - i * 0.01,
      });
    }

    modelResults.set('bge-base', bgeResults);
    modelResults.set('minilm', minilmResults);

    const results = service.reciprocalRankFusion(modelResults, 60);

    expect(results.length).toBe(100);

    // All memories should appear in both models
    for (const result of results) {
      expect(result.appearsInModels).toBe(2);
    }
  });

  it('should handle zero weight for a model', () => {
    const modelResults = new Map<ModelId, ModelSearchResult[]>();

    modelResults.set('bge-base', [
      { memoryId: 'mem-1', model: 'bge-base', rank: 1, score: 0.95 },
    ]);

    modelResults.set('minilm', [
      { memoryId: 'mem-2', model: 'minilm', rank: 1, score: 0.95 },
    ]);

    // Zero weight for minilm
    const weights: Record<ModelId, number> = { 'bge-base': 1.0, 'minilm': 0.0 };
    const results = service.reciprocalRankFusion(modelResults, 60, weights);

    // mem-1 should have positive score, mem-2 should have 0
    const mem1 = results.find(r => r.memoryId === 'mem-1');
    const mem2 = results.find(r => r.memoryId === 'mem-2');

    expect(mem1?.rrfScore).toBeGreaterThan(0);
    expect(mem2?.rrfScore).toBe(0);
  });

  it('should handle same memory at same rank in both models', () => {
    const modelResults = new Map<ModelId, ModelSearchResult[]>();

    modelResults.set('bge-base', [
      { memoryId: 'mem-1', model: 'bge-base', rank: 1, score: 0.95 },
    ]);

    modelResults.set('minilm', [
      { memoryId: 'mem-1', model: 'minilm', rank: 1, score: 0.93 },
    ]);

    const results = service.reciprocalRankFusion(modelResults, 60);

    expect(results.length).toBe(1);
    expect(results[0].memoryId).toBe('mem-1');
    expect(results[0].appearsInModels).toBe(2);

    // Score should be 2 * 1/(60+1) for rank 1 in both
    const expectedScore = 2 * (1 / 61);
    expect(results[0].rrfScore).toBeCloseTo(expectedScore, 5);
  });
});
