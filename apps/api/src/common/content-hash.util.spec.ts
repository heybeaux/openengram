import { generateContentHash } from './content-hash.util';

describe('content-hash.util', () => {
  it('should produce a stable SHA-256 hex digest', () => {
    expect(generateContentHash('hello world')).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    );
  });

  it('should normalize surrounding whitespace and casing before hashing', () => {
    const baseline = generateContentHash('memory content');

    expect(generateContentHash('  Memory Content  ')).toBe(baseline);
    expect(generateContentHash('\nMEMORY CONTENT\t')).toBe(baseline);
  });

  it('should preserve internal whitespace differences', () => {
    expect(generateContentHash('memory content')).not.toBe(
      generateContentHash('memory  content'),
    );
  });

  it('should hash empty or whitespace-only input after trimming', () => {
    expect(generateContentHash('')).toBe(generateContentHash('   '));
    expect(generateContentHash('\n\t')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});
