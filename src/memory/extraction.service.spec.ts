import { Test, TestingModule } from '@nestjs/testing';
import { ExtractionService, ExtractionResult } from './extraction.service';
import { LLMService } from '../llm/llm.service';

describe('ExtractionService', () => {
  let service: ExtractionService;
  let mockLlmService: jest.Mocked<LLMService>;

  beforeEach(async () => {
    mockLlmService = {
      json: jest.fn(),
      chat: jest.fn(),
      embed: jest.fn(),
      getProvider: jest.fn(),
      listProviders: jest.fn(),
      listEmbeddingProviders: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExtractionService,
        { provide: LLMService, useValue: mockLlmService },
      ],
    }).compile();

    service = module.get<ExtractionService>(ExtractionService);
  });

  describe('extract', () => {
    it('should extract 5W1H structure using LLM', async () => {
      const llmResponse = {
        who: 'John',
        what: 'prefers TypeScript over JavaScript',
        when: '2026-01-31',
        where: 'work environment',
        why: 'better type safety',
        how: 'for all new projects',
        topics: ['preferences', 'programming'],
        entities: ['TypeScript', 'JavaScript'],
      };

      mockLlmService.json.mockResolvedValue(llmResponse);

      const result = await service.extract('John prefers TypeScript over JavaScript for better type safety');

      expect(mockLlmService.json).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user' }),
        ]),
        undefined,
        { temperature: 0.2 },
      );

      expect(result).toEqual(llmResponse);
    });

    it('should handle null values in LLM response', async () => {
      const llmResponse = {
        who: null,
        what: 'some action',
        when: null,
        where: null,
        why: null,
        how: null,
        topics: [],
        entities: [],
      };

      mockLlmService.json.mockResolvedValue(llmResponse);

      const result = await service.extract('some action');

      expect(result.who).toBeNull();
      expect(result.when).toBeNull();
      expect(result.topics).toEqual([]);
    });

    it('should ensure topics is always an array', async () => {
      mockLlmService.json.mockResolvedValue({
        who: null,
        what: 'test',
        when: null,
        where: null,
        why: null,
        how: null,
        topics: 'not an array', // Malformed response
        entities: [],
      });

      const result = await service.extract('test');

      expect(Array.isArray(result.topics)).toBe(true);
      expect(result.topics).toEqual([]);
    });

    it('should ensure entities is always an array', async () => {
      mockLlmService.json.mockResolvedValue({
        who: null,
        what: 'test',
        when: null,
        where: null,
        why: null,
        how: null,
        topics: [],
        entities: null, // Malformed response
      });

      const result = await service.extract('test');

      expect(Array.isArray(result.entities)).toBe(true);
      expect(result.entities).toEqual([]);
    });

    it('should fallback to basic extraction on LLM failure', async () => {
      mockLlmService.json.mockRejectedValue(new Error('LLM unavailable'));

      const result = await service.extract('John discussed the project deadline');

      expect(result.what).toContain('John discussed the project deadline');
      expect(result.who).toBe('John');
    });

    it('should not throw when LLM fails', async () => {
      mockLlmService.json.mockRejectedValue(new Error('Network error'));

      await expect(service.extract('test input')).resolves.toBeDefined();
    });
  });

  describe('basicExtraction (via fallback)', () => {
    beforeEach(() => {
      mockLlmService.json.mockRejectedValue(new Error('LLM unavailable'));
    });

    it('should extract names as WHO', async () => {
      const result = await service.extract('Alice and Bob discussed the project');
      expect(result.who).toBe('Alice');
    });

    it('should truncate long content for WHAT', async () => {
      const longText = 'A'.repeat(300);
      const result = await service.extract(longText);
      expect(result.what!.length).toBeLessThanOrEqual(203); // 200 + '...'
      expect(result.what).toContain('...');
    });

    it('should not truncate short content', async () => {
      const shortText = 'Short message';
      const result = await service.extract(shortText);
      expect(result.what).toBe(shortText);
    });

    it('should extract coding topics', async () => {
      const result = await service.extract('Need to fix this bug in the code');
      expect(result.topics).toContain('coding');
    });

    it('should extract design topics', async () => {
      const result = await service.extract('The UI design needs better colors');
      expect(result.topics).toContain('design');
    });

    it('should extract business topics', async () => {
      const result = await service.extract('Client meeting about the budget');
      expect(result.topics).toContain('business');
    });

    it('should extract preferences topics', async () => {
      const result = await service.extract('I prefer dark mode and always use it');
      expect(result.topics).toContain('preferences');
    });

    it('should extract technical topics', async () => {
      const result = await service.extract('Database server integration with API');
      expect(result.topics).toContain('technical');
    });

    it('should extract multiple topics', async () => {
      const result = await service.extract('I prefer this API design for the client');
      expect(result.topics.length).toBeGreaterThan(1);
    });

    it('should extract named entities', async () => {
      const result = await service.extract('Microsoft and Apple are tech companies');
      expect(result.entities).toContain('Microsoft');
      expect(result.entities).toContain('Apple');
    });

    it('should filter out common words from entities', async () => {
      const result = await service.extract('The project starts on Monday in January');
      expect(result.entities).not.toContain('The');
      expect(result.entities).not.toContain('Monday');
      expect(result.entities).not.toContain('January');
    });

    it('should handle text with no extractable names', async () => {
      const result = await service.extract('the quick brown fox jumps');
      expect(result.who).toBeNull();
    });

    it('should return null for WHEN, WHERE, WHY, HOW in basic extraction', async () => {
      const result = await service.extract('Some random text');
      expect(result.when).toBeNull();
      expect(result.where).toBeNull();
      expect(result.why).toBeNull();
      expect(result.how).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', async () => {
      mockLlmService.json.mockRejectedValue(new Error('fail'));
      const result = await service.extract('');
      expect(result).toBeDefined();
      expect(result.what).toBe('');
    });

    it('should handle special characters', async () => {
      mockLlmService.json.mockResolvedValue({
        who: null,
        what: 'Test with émojis 🎉 and spëcial chârs',
        when: null,
        where: null,
        why: null,
        how: null,
        topics: [],
        entities: [],
      });

      const result = await service.extract('Test with émojis 🎉 and spëcial chârs');
      expect(result.what).toContain('émojis');
    });

    it('should handle JSON-like content in raw text', async () => {
      const rawText = '{"key": "value"} is the JSON format';
      mockLlmService.json.mockResolvedValue({
        who: null,
        what: rawText,
        when: null,
        where: null,
        why: null,
        how: null,
        topics: ['technical'],
        entities: ['JSON'],
      });

      const result = await service.extract(rawText);
      expect(result.what).toBe(rawText);
    });
  });
});
