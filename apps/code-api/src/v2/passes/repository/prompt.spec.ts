/**
 * Tests for the repository-synthesis prompt builder (EC-26).
 */

import { approxTokenCount } from '../synthesis.pass';

import type { RepositoryInput } from './gatherer';
import {
  buildRepositoryPrompt,
  REPOSITORY_SYSTEM_PROMPT,
  type LlmLod,
} from './prompt';

function input(over: Partial<RepositoryInput> = {}): RepositoryInput {
  return {
    metadata: {
      name: 'engram-code',
      languages: ['typescript', 'python'],
      topLevelDirs: ['src', 'docs', 'prisma'],
      readme: '# engram-code\n\nMulti-pass code understanding.',
      ...(over.metadata ?? {}),
    },
    subsystems: over.subsystems ?? [
      {
        name: 'Auth',
        slug: 'auth',
        description: 'Handles login.',
        memberModulePaths: ['src/auth'],
        standardCard: '## Subsystem: Auth\n\nLogin + tokens.',
      },
      {
        name: 'Ingestion',
        slug: 'ingestion',
        description: 'Owns parsing.',
        memberModulePaths: ['src/ingest', 'src/parsers'],
        standardCard: '## Subsystem: Ingestion\n\nParses repos.',
      },
    ],
  };
}

describe('buildRepositoryPrompt', () => {
  it.each<[LlmLod, string]>([
    ['summary', 'SUMMARY'],
    ['standard', 'STANDARD'],
    ['deep', 'DEEP'],
  ])('builds a %s prompt with header + subsystems + LoD instructions', (lod, label) => {
    const built = buildRepositoryPrompt(input(), lod);
    expect(built.lod).toBe(lod);
    expect(built.system).toBe(REPOSITORY_SYSTEM_PROMPT);
    expect(built.prompt).toContain('engram-code');
    expect(built.prompt).toContain('typescript');
    expect(built.prompt).toContain(label);
    expect(built.prompt).toContain('### Subsystem: Auth');
    expect(built.prompt).toContain('### Subsystem: Ingestion');
    expect(built.prompt).toContain('--- README excerpt ---');
    expect(built.truncated).toBe(false);
  });

  it('lists subsystems in slug order (deterministic)', () => {
    const a = buildRepositoryPrompt(
      input({
        subsystems: [
          {
            name: 'Zeta',
            slug: 'zeta',
            memberModulePaths: [],
            standardCard: 'z',
          },
          {
            name: 'Alpha',
            slug: 'alpha',
            memberModulePaths: [],
            standardCard: 'a',
          },
        ],
      }),
      'summary',
    );
    const idxAlpha = a.prompt.indexOf('Subsystem: Alpha');
    const idxZeta = a.prompt.indexOf('Subsystem: Zeta');
    expect(idxAlpha).toBeGreaterThan(0);
    expect(idxAlpha).toBeLessThan(idxZeta);
  });

  it('omits the README block when no readme is supplied', () => {
    const built = buildRepositoryPrompt(
      input({
        metadata: {
          name: 'engram-code',
          languages: [],
          topLevelDirs: [],
          readme: undefined,
        },
      }),
      'summary',
    );
    expect(built.prompt).not.toContain('--- README excerpt ---');
  });

  it('marks truncated when subsystem cards exceed the input budget', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      name: `Sub${i}`,
      slug: `s${i.toString().padStart(3, '0')}`,
      memberModulePaths: [`src/s${i}`],
      standardCard: 'A long subsystem card body. '.repeat(50),
    }));
    const built = buildRepositoryPrompt(
      input({ subsystems: many }),
      'standard',
      { maxInputTokens: 1500 },
    );
    expect(built.truncated).toBe(true);
    expect(built.prompt).toContain('Subsystem: Sub0');
    expect(built.prompt).not.toContain('Subsystem: Sub99');
  });

  it('respects the 4k default input budget', () => {
    // Build a realistic-sized input and confirm we stay under the cap.
    const subsystems = Array.from({ length: 10 }, (_, i) => ({
      name: `S${i}`,
      slug: `s${i}`,
      description: 'desc',
      memberModulePaths: ['src/' + i],
      standardCard: 'card body. '.repeat(80), // ~200 tokens each
    }));
    const built = buildRepositoryPrompt(
      input({ subsystems }),
      'standard',
    );
    expect(built.estimatedInputTokens).toBeLessThanOrEqual(4_000);
  });

  it('uses the correct output budget per LoD', () => {
    expect(buildRepositoryPrompt(input(), 'summary').maxOutputTokens).toBe(100);
    expect(buildRepositoryPrompt(input(), 'standard').maxOutputTokens).toBe(500);
    expect(buildRepositoryPrompt(input(), 'deep').maxOutputTokens).toBe(2000);
  });

  it('handles a repo with zero subsystems gracefully', () => {
    const built = buildRepositoryPrompt(
      input({ subsystems: [] }),
      'summary',
    );
    expect(built.prompt).toContain('no subsystems discovered');
    expect(built.truncated).toBe(false);
  });

  it('passes the system prompt verbatim', () => {
    const built = buildRepositoryPrompt(input(), 'summary');
    expect(built.system).toBe(REPOSITORY_SYSTEM_PROMPT);
    expect(built.system).toContain('senior staff engineer');
    expect(approxTokenCount(built.system)).toBeGreaterThan(0);
  });
});
