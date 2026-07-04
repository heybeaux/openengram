import {
  TransientEmbeddingError,
  assertValidEmbedding,
  isTransientEmbeddingError,
} from './embedding-validation.util';

describe('embedding-validation.util', () => {
  describe('TransientEmbeddingError', () => {
    it('should mark retryable embedding failures as transient', () => {
      const error = new TransientEmbeddingError('provider backlog');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('TransientEmbeddingError');
      expect(error.message).toBe('provider backlog');
      expect(error.transient).toBe(true);
      expect(isTransientEmbeddingError(error)).toBe(true);
    });

    it('should recognize wrapped errors with a transient marker', () => {
      expect(isTransientEmbeddingError({ transient: true })).toBe(true);
      expect(isTransientEmbeddingError({ transient: false })).toBe(false);
      expect(isTransientEmbeddingError(new Error('normal failure'))).toBe(false);
      expect(isTransientEmbeddingError(null)).toBe(false);
    });
  });

  describe('assertValidEmbedding', () => {
    it('should return a valid numeric embedding unchanged', () => {
      const embedding = [0, -1.5, 2.25];

      expect(assertValidEmbedding(embedding)).toBe(embedding);
    });

    it('should enforce expected dimensions when provided', () => {
      expect(() =>
        assertValidEmbedding([1, 2, 3], {
          expectedDimensions: 2,
          context: 'store mem-1',
        }),
      ).toThrow('Invalid embedding (store mem-1): expected 2 dimensions, got 3');
    });

    it.each([
      ['null', null],
      ['object', { 0: 1, 1: 2 }],
      ['string', '1,2,3'],
    ])('should reject non-array input: %s', (_label, value) => {
      expect(() => assertValidEmbedding(value)).toThrow('expected array');
    });

    it('should reject empty arrays', () => {
      expect(() => assertValidEmbedding([], { context: 'query' })).toThrow(
        'Invalid embedding (query): empty array',
      );
    });

    it.each([
      ['undefined', [1, undefined, 3]],
      ['null', [1, null, 3]],
      ['NaN', [1, Number.NaN, 3]],
      ['Infinity', [1, Infinity, 3]],
      ['string', [1, '2', 3]],
    ])('should reject non-finite values: %s', (_label, value) => {
      expect(() => assertValidEmbedding(value)).toThrow(
        'contains non-finite values (index 1:',
      );
    });

    it('should reject sparse-array holes that array every/some would skip', () => {
      const sparse = [0, 1, 2];
      delete sparse[1];

      expect(1 in sparse).toBe(false);
      expect(() => assertValidEmbedding(sparse)).toThrow(
        'contains non-finite values (index 1: undefined)',
      );
    });
  });
});
