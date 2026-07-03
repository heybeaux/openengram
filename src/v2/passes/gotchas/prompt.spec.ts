/**
 * Tests for gotchas prompt assembly (EC-24).
 */

import type { GotchaCandidate } from './detector';
import { buildGotchasPrompt } from './prompt';

function cand(over: Partial<GotchaCandidate> = {}): GotchaCandidate {
  return {
    kind: 'tag-comment',
    filePath: 'src/a/x.ts',
    line: 1,
    excerpt: '// TODO: fix this',
    metadata: { tag: 'TODO' },
    ...over,
  };
}

describe('buildGotchasPrompt', () => {
  it('includes module path + every candidate when budget allows', () => {
    const built = buildGotchasPrompt({
      modulePath: 'src/auth',
      candidates: [cand(), cand({ line: 10, excerpt: '// FIXME: races', metadata: { tag: 'FIXME' } })],
    });
    expect(built.prompt).toContain('src/auth');
    expect(built.prompt).toContain('src/a/x.ts:L1');
    expect(built.prompt).toContain('src/a/x.ts:L10');
    expect(built.includedCount).toBe(2);
    expect(built.truncated).toBe(false);
  });

  it('puts tag-comments ahead of docstrings and sibling docs', () => {
    const built = buildGotchasPrompt({
      modulePath: 'src/a',
      candidates: [
        cand({ kind: 'sibling-doc', filePath: 'src/a/README.md', line: 1, excerpt: 'readme', metadata: { name: 'README.md' } }),
        cand({ kind: 'long-docstring', filePath: 'src/a/y.ts', line: 5, excerpt: '/** long */', metadata: { lines: 6 } }),
        cand({ kind: 'tag-comment', filePath: 'src/a/x.ts', line: 1, excerpt: '// TODO', metadata: { tag: 'TODO' } }),
      ],
    });
    const tagIdx = built.prompt.indexOf('[tag-comment');
    const docIdx = built.prompt.indexOf('[long-docstring');
    const sibIdx = built.prompt.indexOf('[sibling-doc');
    expect(tagIdx).toBeGreaterThan(0);
    expect(tagIdx).toBeLessThan(docIdx);
    expect(docIdx).toBeLessThan(sibIdx);
  });

  it('marks truncated and drops tail when budget is tight', () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      cand({ line: i + 1, excerpt: `// TODO: candidate ${i} ` + 'x'.repeat(80) }),
    );
    const built = buildGotchasPrompt({
      modulePath: 'src/big',
      candidates: many,
      maxInputTokens: 600,
    });
    expect(built.truncated).toBe(true);
    expect(built.includedCount).toBeLessThan(many.length);
    expect(built.includedCount).toBeGreaterThan(0);
  });

  it('includes the intent context when supplied', () => {
    const built = buildGotchasPrompt({
      modulePath: 'src/a',
      candidates: [cand()],
      intent: 'Auth module — handles JWT tokens.',
    });
    expect(built.prompt).toContain('Module intent');
    expect(built.prompt).toContain('Auth module');
  });

  it('formats metadata key=value pairs inline', () => {
    const built = buildGotchasPrompt({
      modulePath: 'src/a',
      candidates: [
        cand({
          kind: 'convention-outlier',
          excerpt: 'class D (no @Injectable)',
          metadata: { missing: '@Injectable', dominantRatio: 0.75 },
        }),
      ],
    });
    expect(built.prompt).toMatch(/missing=@Injectable/);
    expect(built.prompt).toMatch(/dominantRatio=0\.75/);
  });

  it('asks for markdown-only output in the system prompt', () => {
    const built = buildGotchasPrompt({ modulePath: 'src/a', candidates: [cand()] });
    expect(built.system).toMatch(/bullet list/i);
    expect(built.system).toMatch(/no headings/i);
  });
});
