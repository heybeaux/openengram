import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { QueryExpansionService } from './query-expansion.service';
import { LLMService } from '../llm/llm.service';
import { ExpansionStrategy } from './dto/multi-query.dto';

describe('QueryExpansionService', () => {
  let service: QueryExpansionService;
  let llmService: jest.Mocked<LLMService>;

  const mockConfig = {
    get: jest.fn(),
  };

  const mockLLM = {
    json: jest.fn(),
    chat: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryExpansionService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: LLMService, useValue: mockLLM },
      ],
    }).compile();

    service = module.get<QueryExpansionService>(QueryExpansionService);
    llmService = module.get(LLMService);
  });

  describe('expand', () => {
    describe('with rules strategy', () => {
      it('should always include original query', async () => {
        const result = await service.expand('test query', {
          strategy: ExpansionStrategy.RULES,
          maxVariants: 5,
        });

        expect(result.variants).toContain('test query');
        expect(result.sources['test query']).toBe('original');
      });

      it('should expand "What does X like?" pattern', async () => {
        const result = await service.expand('What does Beaux like?', {
          strategy: ExpansionStrategy.RULES,
          maxVariants: 10,
        });

        expect(result.variants).toContain('What does Beaux like?');
        expect(result.variants.some(v => v.toLowerCase().includes('preference'))).toBe(true);
        expect(result.llmUsed).toBe(false);
      });

      it('should expand "Tell me about X" pattern', async () => {
        const result = await service.expand('Tell me about Stella', {
          strategy: ExpansionStrategy.RULES,
          maxVariants: 10,
        });

        expect(result.variants.some(v => v.includes('details') || v.includes('information'))).toBe(true);
      });

      it('should apply synonym substitution for "like"', async () => {
        const result = await service.expand('I like pizza', {
          strategy: ExpansionStrategy.RULES,
          maxVariants: 10,
        });

        // Should have synonyms like "prefer", "enjoy", "love"
        const hasSubstitution = result.variants.some(v => 
          v.includes('prefer') || v.includes('enjoy') || v.includes('love')
        );
        expect(hasSubstitution).toBe(true);
      });

      it('should apply synonym substitution for "learn"', async () => {
        const result = await service.expand('What did I learn?', {
          strategy: ExpansionStrategy.RULES,
          maxVariants: 10,
        });

        const hasSubstitution = result.variants.some(v => 
          v.includes('discover') || v.includes('realize') || v.includes('understand')
        );
        expect(hasSubstitution).toBe(true);
      });

      it('should expand "How do I X?" pattern', async () => {
        const result = await service.expand('How do I deploy to production?', {
          strategy: ExpansionStrategy.RULES,
          maxVariants: 10,
        });

        const hasExpansion = result.variants.some(v => 
          v.includes('guide') || v.includes('steps') || v.includes('process')
        );
        expect(hasExpansion).toBe(true);
      });

      it('should expand "Why does X?" pattern', async () => {
        const result = await service.expand('Why does this fail?', {
          strategy: ExpansionStrategy.RULES,
          maxVariants: 10,
        });

        const hasExpansion = result.variants.some(v => 
          v.includes('reason') || v.includes('cause') || v.includes('explanation')
        );
        expect(hasExpansion).toBe(true);
      });

      it('should expand "best practices" pattern', async () => {
        const result = await service.expand('deployment best practices', {
          strategy: ExpansionStrategy.RULES,
          maxVariants: 10,
        });

        const hasExpansion = result.variants.some(v => 
          v.includes('guidelines') || v.includes('recommendations') || v.includes('tips')
        );
        expect(hasExpansion).toBe(true);
      });

      it('should expand "problems with" pattern', async () => {
        const result = await service.expand('problems with the API', {
          strategy: ExpansionStrategy.RULES,
          maxVariants: 10,
        });

        const hasExpansion = result.variants.some(v => 
          v.includes('bugs') || v.includes('errors') || v.includes('fix')
        );
        expect(hasExpansion).toBe(true);
      });

      it('should handle queries with no matching patterns', async () => {
        const result = await service.expand('xyz123abc', {
          strategy: ExpansionStrategy.RULES,
          maxVariants: 5,
        });

        // Should at least have the original query
        expect(result.variants).toContain('xyz123abc');
        expect(result.variants.length).toBeGreaterThanOrEqual(1);
      });

      it('should not exceed maxVariants limit', async () => {
        const result = await service.expand('What does Beaux like?', {
          strategy: ExpansionStrategy.RULES,
          maxVariants: 3,
        });

        expect(result.variants.length).toBeLessThanOrEqual(3);
      });

      it('should deduplicate similar variants', async () => {
        const result = await service.expand('I like food', {
          strategy: ExpansionStrategy.RULES,
          maxVariants: 20,
        });

        // Check for unique variants (no duplicates)
        const uniqueVariants = new Set(result.variants);
        expect(uniqueVariants.size).toBe(result.variants.length);
      });

      it('should track timing information', async () => {
        const result = await service.expand('test query', {
          strategy: ExpansionStrategy.RULES,
          maxVariants: 5,
        });

        expect(result.timings.rulesMs).toBeGreaterThanOrEqual(0);
        expect(result.timings.totalMs).toBeGreaterThanOrEqual(0);
        expect(result.timings.llmMs).toBe(0); // LLM not used
      });
    });

    describe('with LLM strategy', () => {
      it('should call LLM for expansion', async () => {
        mockLLM.json.mockResolvedValue(['variant 1', 'variant 2', 'variant 3']);

        const result = await service.expand('test query', {
          strategy: ExpansionStrategy.LLM,
          maxVariants: 5,
          llm: {
            enabled: true,
            fallbackOnly: false,
            timeoutMs: 2000,
            temperature: 0.8,
          },
        });

        expect(mockLLM.json).toHaveBeenCalled();
        expect(result.llmUsed).toBe(true);
      });

      it('should include LLM variants in result', async () => {
        mockLLM.json.mockResolvedValue(['LLM variant 1', 'LLM variant 2']);

        const result = await service.expand('test query', {
          strategy: ExpansionStrategy.LLM,
          maxVariants: 5,
          llm: {
            enabled: true,
            fallbackOnly: false,
            timeoutMs: 2000,
            temperature: 0.8,
          },
        });

        expect(result.variants).toContain('LLM variant 1');
        expect(result.variants).toContain('LLM variant 2');
        expect(result.sources['LLM variant 1']).toBe('llm');
      });

      it('should handle LLM timeout gracefully', async () => {
        mockLLM.json.mockImplementation(() => new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 100)
        ));

        const result = await service.expand('test query', {
          strategy: ExpansionStrategy.LLM,
          maxVariants: 5,
          llm: {
            enabled: true,
            fallbackOnly: false,
            timeoutMs: 50,
            temperature: 0.8,
          },
        });

        // Should fall back gracefully
        expect(result.variants).toContain('test query');
      });

      it('should handle LLM errors gracefully', async () => {
        mockLLM.json.mockRejectedValue(new Error('LLM error'));

        const result = await service.expand('test query', {
          strategy: ExpansionStrategy.LLM,
          maxVariants: 5,
          llm: {
            enabled: true,
            fallbackOnly: false,
            timeoutMs: 2000,
            temperature: 0.8,
          },
        });

        // Should fall back to original
        expect(result.variants).toContain('test query');
      });

      it('should validate LLM response is array of strings', async () => {
        mockLLM.json.mockResolvedValue({ invalid: 'response' });

        const result = await service.expand('test query', {
          strategy: ExpansionStrategy.LLM,
          maxVariants: 5,
          llm: {
            enabled: true,
            fallbackOnly: false,
            timeoutMs: 2000,
            temperature: 0.8,
          },
        });

        // Should fall back to original
        expect(result.variants).toContain('test query');
      });

      it('should filter out empty or too-long variants from LLM', async () => {
        mockLLM.json.mockResolvedValue([
          'good variant',
          '',  // Empty
          'a'.repeat(150),  // Too long
          'another good variant',
        ]);

        const result = await service.expand('test query', {
          strategy: ExpansionStrategy.LLM,
          maxVariants: 5,
          llm: {
            enabled: true,
            fallbackOnly: false,
            timeoutMs: 2000,
            temperature: 0.8,
          },
        });

        expect(result.variants).toContain('good variant');
        expect(result.variants).toContain('another good variant');
        expect(result.variants.some(v => v === '')).toBe(false);
        expect(result.variants.some(v => v.length > 100)).toBe(false);
      });
    });

    describe('with hybrid strategy', () => {
      it('should use rules first, then LLM as fallback', async () => {
        mockLLM.json.mockResolvedValue(['LLM variant']);

        const result = await service.expand('What does Beaux like?', {
          strategy: ExpansionStrategy.HYBRID,
          maxVariants: 10,
          llm: {
            enabled: true,
            fallbackOnly: true,
            timeoutMs: 2000,
            temperature: 0.8,
          },
        });

        // Should have rule variants
        expect(result.variants.some(v => v.includes('preferences'))).toBe(true);
        // Should track both sources
        expect(Object.values(result.sources).includes('rules')).toBe(true);
      });

      it('should invoke LLM when rules produce few variants', async () => {
        mockLLM.json.mockResolvedValue(['LLM variant 1', 'LLM variant 2']);

        const result = await service.expand('xyz123', {
          strategy: ExpansionStrategy.HYBRID,
          maxVariants: 10,
          llm: {
            enabled: true,
            fallbackOnly: true,
            timeoutMs: 2000,
            temperature: 0.8,
          },
        });

        // Should have called LLM as fallback
        expect(mockLLM.json).toHaveBeenCalled();
      });

      it('should not exceed maxVariants when combining rules and LLM', async () => {
        mockLLM.json.mockResolvedValue([
          'LLM variant 1', 'LLM variant 2', 'LLM variant 3',
          'LLM variant 4', 'LLM variant 5', 'LLM variant 6',
        ]);

        const result = await service.expand('What does Beaux like?', {
          strategy: ExpansionStrategy.HYBRID,
          maxVariants: 5,
          llm: {
            enabled: true,
            fallbackOnly: false,
            timeoutMs: 2000,
            temperature: 0.8,
          },
        });

        expect(result.variants.length).toBeLessThanOrEqual(5);
      });
    });
  });

  describe('expandWithRules', () => {
    it('should handle "remember when" pattern', async () => {
      const result = await service.expand('remember when we went to the beach', {
        strategy: ExpansionStrategy.RULES,
        maxVariants: 10,
      });

      const hasExpansion = result.variants.some(v => 
        v.includes('memory') || v.includes('happened')
      );
      expect(hasExpansion).toBe(true);
    });

    it('should handle "who is" pattern', async () => {
      const result = await service.expand('who is Deanna', {
        strategy: ExpansionStrategy.RULES,
        maxVariants: 10,
      });

      const hasExpansion = result.variants.some(v => 
        v.includes('about') || v.includes('details') || v === 'Deanna'
      );
      expect(hasExpansion).toBe(true);
    });

    it('should handle "what is" pattern', async () => {
      const result = await service.expand('what is Engram', {
        strategy: ExpansionStrategy.RULES,
        maxVariants: 10,
      });

      const hasExpansion = result.variants.some(v => 
        v.includes('definition') || v.includes('explanation') || v === 'Engram'
      );
      expect(hasExpansion).toBe(true);
    });

    it('should apply related concept expansion', async () => {
      const result = await service.expand('work projects', {
        strategy: ExpansionStrategy.RULES,
        maxVariants: 15,
      });

      // "work" has related concepts like job, career, profession
      const hasRelated = result.variants.some(v => 
        v.includes('job') || v.includes('career') || v.includes('task')
      );
      expect(hasRelated).toBe(true);
    });
  });

  describe('registerPersonExpansions', () => {
    it('should register custom person expansions', async () => {
      service.registerPersonExpansions('Stella', ['daughter', 'child']);

      const result = await service.expand('Tell me about Stella', {
        strategy: ExpansionStrategy.RULES,
        maxVariants: 15,
      });

      // Should expand Stella to daughter
      const hasExpansion = result.variants.some(v => 
        v.includes('daughter') || v.includes('child')
      );
      expect(hasExpansion).toBe(true);
    });

    it('should handle case-insensitive person matching', async () => {
      service.registerPersonExpansions('beaux', ['user', 'human']);

      const result = await service.expand('What does Beaux like?', {
        strategy: ExpansionStrategy.RULES,
        maxVariants: 15,
      });

      const hasExpansion = result.variants.some(v => 
        v.includes('user') || v.includes('human')
      );
      expect(hasExpansion).toBe(true);
    });
  });
});
