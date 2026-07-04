import { toValidatedVectorLiteral } from './vector-literal.util';

describe('toValidatedVectorLiteral', () => {
  it('serializes a numeric embedding for pgvector', () => {
    expect(toValidatedVectorLiteral([0, 1.25, -3.5], 'test embedding')).toBe('[0,1.25,-3.5]');
  });

  it('rejects empty or non-array embeddings', () => {
    expect(() => toValidatedVectorLiteral([], 'empty embedding')).toThrow(
      'Invalid embedding for empty embedding: expected non-empty array',
    );
    expect(() => toValidatedVectorLiteral('not-an-array' as unknown as number[], 'bad embedding')).toThrow(
      'Invalid embedding for bad embedding: expected non-empty array',
    );
  });

  it('rejects non-finite and non-number values with the failing index', () => {
    expect(() => toValidatedVectorLiteral([1, Number.NaN], 'nan embedding')).toThrow(
      'Invalid embedding for nan embedding: non-finite value at index 1',
    );
    expect(() => toValidatedVectorLiteral([1, Infinity], 'infinite embedding')).toThrow(
      'Invalid embedding for infinite embedding: non-finite value at index 1',
    );
    expect(() => toValidatedVectorLiteral([1, '2' as unknown as number], 'string embedding')).toThrow(
      'Invalid embedding for string embedding: non-finite value at index 1',
    );
  });
});
