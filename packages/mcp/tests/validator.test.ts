import { describe, it, expect } from 'vitest';
import {
  validateContent, validateQuery, validateId, validateLayer,
  validateLayers, validateTags, validateLimit, validateMaxTokens,
} from '../src/security/validator.js';

describe('validateContent', () => {
  it('accepts valid content', () => {
    expect(validateContent('hello world')).toBe('hello world');
  });

  it('trims whitespace', () => {
    expect(validateContent('  hello  ')).toBe('hello');
  });

  it('strips control characters', () => {
    expect(validateContent('hello\x00world')).toBe('helloworld');
  });

  it('rejects empty string', () => {
    expect(() => validateContent('')).toThrow('non-empty');
  });

  it('rejects non-string', () => {
    expect(() => validateContent(123)).toThrow('non-empty');
  });

  it('rejects content over 50000 chars', () => {
    expect(() => validateContent('a'.repeat(50001))).toThrow('maximum length');
  });

  it('accepts content at exactly 50000 chars', () => {
    const result = validateContent('a'.repeat(50000));
    expect(result.length).toBe(50000);
  });
});

describe('validateQuery', () => {
  it('accepts valid query', () => {
    expect(validateQuery('what is my name?')).toBe('what is my name?');
  });

  it('rejects query over 2000 chars', () => {
    expect(() => validateQuery('a'.repeat(2001))).toThrow('maximum length');
  });
});

describe('validateId', () => {
  it('accepts valid IDs', () => {
    expect(validateId('abc-123_def')).toBe('abc-123_def');
    expect(validateId('cm5abc123')).toBe('cm5abc123');
  });

  it('rejects empty string', () => {
    expect(() => validateId('')).toThrow('Invalid ID');
  });

  it('rejects IDs with special characters', () => {
    expect(() => validateId('abc/../etc')).toThrow('Invalid ID');
    expect(() => validateId('id with spaces')).toThrow('Invalid ID');
  });

  it('rejects IDs over 128 chars', () => {
    expect(() => validateId('a'.repeat(129))).toThrow('Invalid ID');
  });
});

describe('validateLayer', () => {
  it('accepts valid layers', () => {
    expect(validateLayer('SESSION')).toBe('SESSION');
    expect(validateLayer('semantic')).toBe('SEMANTIC');
  });

  it('returns undefined for undefined', () => {
    expect(validateLayer(undefined)).toBeUndefined();
  });

  it('rejects invalid layer', () => {
    expect(() => validateLayer('INVALID')).toThrow('Invalid layer');
  });
});

describe('validateLayers', () => {
  it('validates array of layers', () => {
    expect(validateLayers(['SESSION', 'core'])).toEqual(['SESSION', 'CORE']);
  });

  it('rejects non-array', () => {
    expect(() => validateLayers('SESSION')).toThrow('must be an array');
  });
});

describe('validateTags', () => {
  it('accepts valid tags', () => {
    expect(validateTags(['foo', 'bar'])).toEqual(['foo', 'bar']);
  });

  it('rejects too many tags', () => {
    expect(() => validateTags(new Array(21).fill('tag'))).toThrow('Maximum 20');
  });

  it('rejects non-string tags', () => {
    expect(() => validateTags([123])).toThrow('must be a string');
  });
});

describe('validateLimit', () => {
  it('returns default for undefined', () => {
    expect(validateLimit(undefined)).toBe(10);
  });

  it('clamps to max', () => {
    expect(validateLimit(100)).toBe(50);
  });

  it('returns default for invalid', () => {
    expect(validateLimit(-1)).toBe(10);
  });
});

describe('validateMaxTokens', () => {
  it('returns default for undefined', () => {
    expect(validateMaxTokens(undefined)).toBe(4000);
  });

  it('clamps to max', () => {
    expect(validateMaxTokens(100000)).toBe(32000);
  });
});
