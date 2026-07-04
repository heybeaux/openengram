import {
  getDimensionsForModel,
  resolveEmbeddingModelId,
  resolveExpectedDimensions,
} from './embedding-model.util';

describe('embedding model utilities', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.EMBEDDING_MODEL;
    delete process.env.VECTOR_SEARCH_MODEL;
    delete process.env.EXPECTED_EMBED_DIMENSIONS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('resolves the write/search model from EMBEDDING_MODEL first, then VECTOR_SEARCH_MODEL, then default', () => {
    expect(resolveEmbeddingModelId()).toBe('bge-base');

    process.env.VECTOR_SEARCH_MODEL = 'minilm';
    expect(resolveEmbeddingModelId()).toBe('minilm');

    process.env.EMBEDDING_MODEL = 'openai-small';
    expect(resolveEmbeddingModelId()).toBe('openai-small');
  });

  it('returns expected dimensions for known model ids and undefined for unknown ids', () => {
    expect(getDimensionsForModel('openai-small')).toBe(1536);
    expect(getDimensionsForModel('openai-large')).toBe(3072);
    expect(getDimensionsForModel('bge-base')).toBe(768);
    expect(getDimensionsForModel('minilm')).toBe(384);
    expect(getDimensionsForModel('nomic')).toBe(768);
    expect(getDimensionsForModel('custom-model')).toBeUndefined();
  });

  it('uses EXPECTED_EMBED_DIMENSIONS override only when it is a positive integer', () => {
    process.env.EXPECTED_EMBED_DIMENSIONS = '1024';
    expect(resolveExpectedDimensions()).toBe(1024);

    process.env.EXPECTED_EMBED_DIMENSIONS = '0';
    process.env.EMBEDDING_MODEL = 'openai-large';
    expect(resolveExpectedDimensions()).toBe(3072);

    process.env.EXPECTED_EMBED_DIMENSIONS = 'not-a-number';
    process.env.EMBEDDING_MODEL = 'openai-small';
    expect(resolveExpectedDimensions()).toBe(1536);
  });

  it('returns undefined for unknown resolved model ids without a valid override', () => {
    process.env.EMBEDDING_MODEL = 'custom-model';
    expect(resolveExpectedDimensions()).toBeUndefined();
  });
});
