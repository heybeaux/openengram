/**
 * Tests for the repository-artifact writer (EC-26). fs is stubbed.
 */

import type { CardInput } from '../../types/cards';

import type { RepositoryInput } from './gatherer';
import type { RepositoryPassLodResult } from './orchestrator';
import {
  renderArtifact,
  writeRepositoryArtifact,
  type RepositoryArtifactInput,
} from './writer';

function repoInput(): RepositoryInput {
  return {
    metadata: {
      name: 'engram-code',
      languages: ['typescript'],
      topLevelDirs: ['src'],
      readme: 'README',
    },
    subsystems: [
      {
        name: 'Auth',
        slug: 'auth',
        description: 'Handles login.',
        memberModulePaths: ['src/auth'],
        standardCard: 'auth card',
      },
      {
        name: 'Search',
        slug: 'search',
        memberModulePaths: ['src/search'],
        standardCard: 'search card',
      },
    ],
  };
}

function cards(): CardInput[] {
  return [
    {
      repoId: 'r',
      conceptPath: 'r/repository',
      lod: 'INDEX',
      level: 'REPOSITORY',
      content: 'engram-code — repository: 2 subsystems, typescript',
      sourcePass: 'synthesis-repository',
    },
    {
      repoId: 'r',
      conceptPath: 'r/repository',
      lod: 'SUMMARY',
      level: 'REPOSITORY',
      content: 'Short summary body.',
      sourcePass: 'synthesis-repository',
    },
    {
      repoId: 'r',
      conceptPath: 'r/repository',
      lod: 'STANDARD',
      level: 'REPOSITORY',
      content: 'Standard overview body across 2 subsystems.',
      sourcePass: 'synthesis-repository',
    },
    {
      repoId: 'r',
      conceptPath: 'r/repository',
      lod: 'DEEP',
      level: 'REPOSITORY',
      content: '## Overview\n\nDeep body.',
      sourcePass: 'synthesis-repository',
    },
  ];
}

function lods(): RepositoryPassLodResult[] {
  return [
    { lod: 'INDEX', tokenCost: 0, fallback: false, truncated: false },
    { lod: 'SUMMARY', tokenCost: 100, fallback: false, truncated: false },
    { lod: 'STANDARD', tokenCost: 200, fallback: false, truncated: false },
    { lod: 'DEEP', tokenCost: 800, fallback: false, truncated: false },
  ];
}

function art(over: Partial<RepositoryArtifactInput> = {}): RepositoryArtifactInput {
  return {
    repoId: 'r',
    input: repoInput(),
    cards: cards(),
    lods: lods(),
    totalTokens: 1100,
    model: 'anthropic/claude-opus-4-7',
    ...over,
  };
}

describe('renderArtifact', () => {
  it('emits YAML frontmatter with repo metadata + provenance', () => {
    const out = renderArtifact(art());
    expect(out.startsWith('---\n')).toBe(true);
    expect(out).toContain('repo: engram-code');
    expect(out).toContain('repo_id: r');
    expect(out).toContain('pass: synthesis-repository');
    expect(out).toContain('model: anthropic/claude-opus-4-7');
    expect(out).toContain('languages: typescript');
    expect(out).toContain('subsystems: 2');
    expect(out).toContain('total_tokens: 1100');
    expect(out).toContain('lod_summary:');
  });

  it('includes the INDEX, SUMMARY, STANDARD, and DEEP card bodies', () => {
    const out = renderArtifact(art());
    expect(out).toContain('engram-code — repository: 2 subsystems');
    expect(out).toContain('Short summary body.');
    expect(out).toContain('Standard overview body');
    expect(out).toContain('Deep body.');
  });

  it('lists each subsystem with slug, name, and description when present', () => {
    const out = renderArtifact(art());
    expect(out).toContain('`auth` (Auth) — Handles login.');
    expect(out).toContain('`search` (Search)');
  });

  it('handles a repo with zero subsystems', () => {
    const empty: RepositoryInput = {
      metadata: {
        name: 'empty-repo',
        languages: [],
        topLevelDirs: [],
      },
      subsystems: [],
    };
    const out = renderArtifact(
      art({
        input: empty,
        cards: cards().map((c) => ({ ...c })),
      }),
    );
    expect(out).toContain('subsystems: 0');
    expect(out).toContain('(no subsystems discovered)');
  });

  it('surfaces fallback flags in the lod_summary frontmatter line', () => {
    const out = renderArtifact(
      art({
        lods: [
          { lod: 'INDEX', tokenCost: 0, fallback: false, truncated: false },
          { lod: 'SUMMARY', tokenCost: 0, fallback: true, truncated: false },
          { lod: 'STANDARD', tokenCost: 200, fallback: false, truncated: false },
          { lod: 'DEEP', tokenCost: 0, fallback: true, truncated: false },
        ],
      }),
    );
    expect(out).toContain('summary: { fallback: true');
    expect(out).toContain('deep: { fallback: true');
  });
});

describe('writeRepositoryArtifact', () => {
  it('writes <artifactsRoot>/repository.md and returns the path + bytes', async () => {
    const writes: Array<{ path: string; contents: string }> = [];
    const dirs: string[] = [];
    const result = await writeRepositoryArtifact(art(), {
      artifactsRoot: '/tmp/.engram/artifacts',
      writeFile: async (p, c) => {
        writes.push({ path: p, contents: c });
      },
      mkdir: async (p) => {
        dirs.push(p as string);
        return undefined;
      },
    });
    expect(result.filePath).toBe('/tmp/.engram/artifacts/repository.md');
    expect(result.bytes).toBeGreaterThan(0);
    expect(writes).toHaveLength(1);
    expect(dirs).toEqual(['/tmp/.engram/artifacts']);
  });

  it('writes a coherent artifact body for the fixture mini-repo', async () => {
    // End-to-end coherence check matching the EC-26 exit criteria.
    let written = '';
    await writeRepositoryArtifact(art(), {
      artifactsRoot: '/x',
      writeFile: async (_p, c) => {
        written = c;
      },
      mkdir: async () => undefined,
    });
    expect(written).toContain('# Repository: engram-code');
    expect(written).toContain('## Summary');
    expect(written).toContain('## Overview');
    expect(written).toContain('## Subsystems');
    expect(written).toContain('## Deep');
    expect(written.indexOf('## Summary')).toBeLessThan(written.indexOf('## Overview'));
  });
});
