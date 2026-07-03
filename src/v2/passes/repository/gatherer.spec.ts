/**
 * Tests for repository-pass input gathering (EC-26).
 */

import type { SubsystemInput } from '../../types/cards';

import {
  estimateInputTokens,
  REPOSITORY_MAX_INPUT_TOKENS,
  summarizeSubsystems,
  trimReadme,
  type RepositoryInput,
} from './gatherer';

function sub(over: Partial<SubsystemInput> = {}): SubsystemInput {
  return {
    repoId: 'r',
    name: 'Auth',
    slug: 'auth',
    description: 'Handles login.',
    memberModulePaths: ['src/auth'],
    ...over,
  };
}

describe('summarizeSubsystems', () => {
  it('sorts by slug and copies fields', () => {
    const out = summarizeSubsystems([
      sub({ name: 'Billing', slug: 'billing', memberModulePaths: ['src/billing'] }),
      sub({ name: 'Auth', slug: 'auth' }),
    ]);
    expect(out.map((s) => s.slug)).toEqual(['auth', 'billing']);
    expect(out[0]).toMatchObject({
      name: 'Auth',
      slug: 'auth',
      description: 'Handles login.',
    });
  });

  it('attaches standard cards via the lookup callback', () => {
    const lookup = (slug: string): string | undefined =>
      slug === 'auth' ? '## Auth\n\nLogin module.' : undefined;
    const out = summarizeSubsystems([sub()], lookup);
    expect(out[0].standardCard).toContain('Login module');
  });

  it('returns an empty array for empty input', () => {
    expect(summarizeSubsystems([])).toEqual([]);
  });

  it('copies memberModulePaths defensively (no aliasing)', () => {
    const original = sub({ memberModulePaths: ['a', 'b'] });
    const out = summarizeSubsystems([original]);
    out[0].memberModulePaths.push('c');
    expect(original.memberModulePaths).toEqual(['a', 'b']);
  });
});

describe('trimReadme', () => {
  it('returns undefined for empty/whitespace input', () => {
    expect(trimReadme(undefined)).toBeUndefined();
    expect(trimReadme('')).toBeUndefined();
    expect(trimReadme('   \n\n  ')).toBeUndefined();
  });

  it('clamps long readmes to the budget', () => {
    const huge = 'x'.repeat(20_000);
    const out = trimReadme(huge, 100); // 100 tokens ≈ 400 chars
    expect(out).toBeDefined();
    expect(out!.length).toBeLessThan(500);
  });

  it('passes short readmes through unchanged (modulo trim)', () => {
    expect(trimReadme('  # Hello\n')).toBe('# Hello');
  });
});

describe('estimateInputTokens', () => {
  it('sums metadata + subsystem content', () => {
    const input: RepositoryInput = {
      metadata: {
        name: 'engram-code',
        languages: ['typescript', 'python'],
        topLevelDirs: ['src', 'docs'],
        readme: 'A repo about things.',
      },
      subsystems: [
        {
          name: 'Auth',
          slug: 'auth',
          description: 'Handles login.',
          memberModulePaths: ['src/auth'],
          standardCard: 'x'.repeat(400), // ~100 tokens
        },
      ],
    };
    const tokens = estimateInputTokens(input);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(REPOSITORY_MAX_INPUT_TOKENS);
  });

  it('returns zero for an empty repo', () => {
    const tokens = estimateInputTokens({
      metadata: { name: '', languages: [], topLevelDirs: [] },
      subsystems: [],
    });
    expect(tokens).toBe(0);
  });
});
