import {
  extractCapabilitySignals,
  extractPreferenceSignals,
  inferPrefCategory,
  basicExtraction,
} from './extraction-signals';
import { MemoryType } from '@prisma/client';

describe('ExtractionSignals', () => {
  // ==================== extractCapabilitySignals ====================

  describe('extractCapabilitySignals', () => {
    it('should extract "successfully" pattern with 0.8 confidence', () => {
      const signals = extractCapabilitySignals(
        'I successfully deployed the app to production.',
      );
      expect(signals.length).toBeGreaterThanOrEqual(1);
      expect(signals[0].capability).toBe('deployed the app to production');
      expect(signals[0].confidence).toBe(0.8);
    });

    it('should extract "built" pattern with 0.7 confidence', () => {
      const signals = extractCapabilitySignals(
        'He built a REST API for the project.',
      );
      expect(signals).toHaveLength(1);
      expect(signals[0].capability).toBe('a REST API for the project');
      expect(signals[0].confidence).toBe(0.7);
    });

    it.each([
      'created',
      'developed',
      'implemented',
      'deployed',
      'shipped',
      'launched',
    ])('should match "%s" verb pattern', (verb) => {
      const signals = extractCapabilitySignals(`${verb} a new microservice.`);
      expect(signals.length).toBeGreaterThanOrEqual(1);
      expect(signals[0].confidence).toBe(0.7);
    });

    it('should extract "fixed" pattern', () => {
      const signals = extractCapabilitySignals(
        'She fixed the authentication bug.',
      );
      expect(signals).toHaveLength(1);
      expect(signals[0].capability).toBe('the authentication bug');
      expect(signals[0].confidence).toBe(0.7);
    });

    it('should extract "configured" pattern with 0.6 confidence', () => {
      const signals = extractCapabilitySignals('I configured the CI pipeline.');
      expect(signals).toHaveLength(1);
      expect(signals[0].confidence).toBe(0.6);
    });

    it('should extract "proficient in" pattern with 0.9 confidence', () => {
      const signals = extractCapabilitySignals(
        'She is proficient in TypeScript.',
      );
      expect(signals).toHaveLength(1);
      expect(signals[0].capability).toBe('TypeScript');
      expect(signals[0].confidence).toBe(0.9);
    });

    it.each(['skilled in', 'experienced with', 'expert at'])(
      'should match "%s" pattern with 0.9 confidence',
      (phrase) => {
        const signals = extractCapabilitySignals(`He is ${phrase} Python.`);
        expect(signals.length).toBeGreaterThanOrEqual(1);
        expect(signals[0].confidence).toBe(0.9);
      },
    );

    it('should deduplicate capabilities (case-insensitive)', () => {
      const signals = extractCapabilitySignals(
        'Successfully deployed the app. He also deployed the App.',
      );
      // "deployed the app" matched by "successfully" first, second match is same lowercase
      expect(signals.length).toBeLessThanOrEqual(2);
      const keys = signals.map((s) => s.capability.toLowerCase());
      const unique = new Set(keys);
      expect(unique.size).toBe(keys.length);
    });

    it('should return empty array for text with no signals', () => {
      expect(extractCapabilitySignals('The weather is nice today.')).toEqual(
        [],
      );
    });

    it('should return empty array for empty string', () => {
      expect(extractCapabilitySignals('')).toEqual([]);
    });

    it('should handle very long text without crashing', () => {
      const longText = 'a '.repeat(10000) + 'successfully built something.';
      const signals = extractCapabilitySignals(longText);
      expect(signals.length).toBeGreaterThanOrEqual(0);
    });

    it('should extract multiple different signals', () => {
      const signals = extractCapabilitySignals(
        'She successfully built the API. She is proficient in Rust.',
      );
      expect(signals.length).toBeGreaterThanOrEqual(2);
    });

    it('should trim whitespace from capability', () => {
      const signals = extractCapabilitySignals(
        'successfully   handled the migration  .',
      );
      if (signals.length > 0) {
        expect(signals[0].capability).toBe(signals[0].capability.trim());
      }
    });
  });

  // ==================== extractPreferenceSignals ====================

  describe('extractPreferenceSignals', () => {
    it('should extract "I prefer" as strong', () => {
      const signals = extractPreferenceSignals('I prefer dark mode.', null);
      expect(signals).toHaveLength(1);
      expect(signals[0].strength).toBe('strong');
      expect(signals[0].preference).toBe('dark mode');
    });

    it('should extract "always use" as strong', () => {
      const signals = extractPreferenceSignals(
        'I always use TypeScript.',
        null,
      );
      expect(signals).toHaveLength(1);
      expect(signals[0].strength).toBe('strong');
    });

    it('should extract "never use" as strong', () => {
      const signals = extractPreferenceSignals(
        'I never use var in JavaScript.',
        null,
      );
      expect(signals).toHaveLength(1);
      expect(signals[0].strength).toBe('strong');
    });

    it('should extract "don\'t like" as moderate', () => {
      const signals = extractPreferenceSignals(
        "I don't like tabs for indentation.",
        null,
      );
      expect(signals).toHaveLength(1);
      expect(signals[0].strength).toBe('moderate');
    });

    it('should extract "like" as moderate', () => {
      const signals = extractPreferenceSignals('I like using VS Code.', null);
      expect(signals).toHaveLength(1);
      expect(signals[0].strength).toBe('moderate');
    });

    it('should extract "favorite is" as strong', () => {
      const signals = extractPreferenceSignals(
        'My favorite editor is Neovim.',
        null,
      );
      expect(signals).toHaveLength(1);
      expect(signals[0].strength).toBe('strong');
    });

    it('should extract "usually" as weak', () => {
      const signals = extractPreferenceSignals(
        'I usually write tests first.',
        null,
      );
      expect(signals).toHaveLength(1);
      expect(signals[0].strength).toBe('weak');
    });

    it('should deduplicate preferences (case-insensitive)', () => {
      const signals = extractPreferenceSignals(
        'I prefer Dark Mode. I also like dark mode.',
        null,
      );
      const keys = signals.map((s) => s.preference.toLowerCase());
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('should fallback to raw text when memoryType is PREFERENCE and no patterns match', () => {
      const signals = extractPreferenceSignals(
        'Spaces over tabs always',
        'PREFERENCE' as MemoryType,
      );
      expect(signals).toHaveLength(1);
      expect(signals[0].strength).toBe('moderate');
      expect(signals[0].preference).toBe('Spaces over tabs always');
    });

    it('should NOT fallback when memoryType is not PREFERENCE', () => {
      const signals = extractPreferenceSignals(
        'Some random text with no patterns',
        'FACT' as MemoryType,
      );
      expect(signals).toEqual([]);
    });

    it('should return empty array for empty string with null type', () => {
      expect(extractPreferenceSignals('', null)).toEqual([]);
    });

    it('should truncate fallback preference to 150 chars', () => {
      const longText = 'x'.repeat(300);
      const signals = extractPreferenceSignals(
        longText,
        'PREFERENCE' as MemoryType,
      );
      expect(signals[0].preference.length).toBe(150);
    });

    it('should include inferred category', () => {
      const signals = extractPreferenceSignals(
        'I prefer using dark theme in my editor.',
        null,
      );
      expect(signals[0].category).toBeDefined();
      expect(typeof signals[0].category).toBe('string');
    });
  });

  // ==================== inferPrefCategory ====================

  describe('inferPrefCategory', () => {
    it.each([
      ['I use VS Code editor', 'tooling'],
      ['The framework is great', 'tooling'],
      ['programming language choice', 'tooling'],
    ])('should classify "%s" as %s', (text, expected) => {
      expect(inferPrefCategory(text)).toBe(expected);
    });

    it.each([
      ['dark theme UI', 'interface'],
      ['the UX design is clean', 'interface'],
      ['I like light color schemes', 'interface'],
    ])('should classify "%s" as %s', (text, expected) => {
      expect(inferPrefCategory(text)).toBe(expected);
    });

    it.each([
      ['I love coffee', 'food'],
      ['tea over coffee', 'food'],
      ['favorite food is pizza', 'food'],
    ])('should classify "%s" as %s', (text, expected) => {
      expect(inferPrefCategory(text)).toBe(expected);
    });

    it.each([
      ['send me an email', 'communication'],
      ['slack message preferred', 'communication'],
      ['meeting at 3pm', 'communication'],
    ])('should classify "%s" as %s', (text, expected) => {
      expect(inferPrefCategory(text)).toBe(expected);
    });

    it.each([
      ['deploy to production', 'workflow'],
      ['CI pipeline config', 'workflow'],
      ['the process is slow', 'workflow'],
    ])('should classify "%s" as %s', (text, expected) => {
      expect(inferPrefCategory(text)).toBe(expected);
    });

    it('should return "general" for unrecognized text', () => {
      expect(inferPrefCategory('the sky is blue')).toBe('general');
    });

    it('should be case-insensitive', () => {
      expect(inferPrefCategory('COFFEE is life')).toBe('food');
    });

    it('should handle empty string', () => {
      expect(inferPrefCategory('')).toBe('general');
    });
  });

  // ==================== basicExtraction ====================

  describe('basicExtraction', () => {
    it('should return a complete ExtractionResult', () => {
      const result = basicExtraction('Beaux built a new API.');
      expect(result).toHaveProperty('who');
      expect(result).toHaveProperty('what');
      expect(result).toHaveProperty('when', null);
      expect(result).toHaveProperty('where', null);
      expect(result).toHaveProperty('why', null);
      expect(result).toHaveProperty('how', null);
      expect(result).toHaveProperty('topics');
      expect(result).toHaveProperty('entities');
      expect(result).toHaveProperty('memoryType');
      expect(result).toHaveProperty('typeConfidence', 0.5);
      expect(result).toHaveProperty('capabilities');
      expect(result).toHaveProperty('preferenceSignals');
      expect(result).toHaveProperty('confidence');
    });

    it('should replace "User" with userName when provided', () => {
      const result = basicExtraction('User prefers dark mode.', 'Beaux');
      expect(result.what).toContain('Beaux');
      expect(result.what).not.toContain('User');
    });

    it('should replace "the user" case-insensitively', () => {
      const result = basicExtraction('The user likes coffee.', 'Beaux');
      expect(result.what).toContain('Beaux');
    });

    it('should truncate long text to 200 chars with ellipsis', () => {
      const longText = 'a'.repeat(300);
      const result = basicExtraction(longText);
      expect(result.what).toHaveLength(203); // 200 + '...'
      expect(result.what.endsWith('...')).toBe(true);
    });

    it('should not truncate text <= 200 chars', () => {
      const text = 'Short text here.';
      const result = basicExtraction(text);
      expect(result.what).toBe(text);
    });

    it('should extract topics from text', () => {
      const result = basicExtraction('Working on the code and API.');
      expect(result.topics).toContain('coding');
    });

    it('should include userName as entity when provided', () => {
      const result = basicExtraction('Some text.', 'Beaux');
      const entityNames = result.entities.map((e) => e.name);
      expect(entityNames).toContain('Beaux');
    });

    it('should extract capability signals', () => {
      const result = basicExtraction('Successfully deployed the new service.');
      expect(result.capabilities.length).toBeGreaterThan(0);
    });

    it('should extract preference signals', () => {
      const result = basicExtraction('I prefer TypeScript over JavaScript.');
      expect(result.preferenceSignals.length).toBeGreaterThan(0);
    });

    it('should set confidence values', () => {
      const result = basicExtraction('Beaux likes coffee.', 'Beaux');
      expect(result.confidence.whoConfidence).toBe(0.3);
      expect(result.confidence.whatConfidence).toBe(0.4);
      expect(result.confidence.whenConfidence).toBeNull();
    });

    it('should handle empty string', () => {
      const result = basicExtraction('');
      expect(result.what).toBe('');
      expect(result.who).toBeNull();
      expect(result.topics).toEqual([]);
    });

    it('should handle special characters', () => {
      const result = basicExtraction('Code uses <div> & "quotes" © 2024.');
      expect(result).toBeDefined();
      expect(result.what).toContain('<div>');
    });

    it('should set whoConfidence to null when no name found', () => {
      const result = basicExtraction('no names here at all');
      expect(result.confidence.whoConfidence).toBeNull();
    });
  });
});
