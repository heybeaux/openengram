/**
 * Integration tests for the structure pass orchestrator.
 *
 * These tests stand up a real temp directory with a few source files, but
 * inject a stub parser instead of using the tree-sitter-backed one. Real
 * extractors are covered by their own specs under `src/v2/parsers/`; what
 * we care about here is that the orchestrator walks, dispatches, aggregates,
 * deduplicates, and rebases paths correctly.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ParseResult } from '../../parsers/types';
import { runStructurePass } from './orchestrator';

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ec12-structure-'));
  // A small multi-language layout to exercise the walker.
  writeFileSync(join(dir, 'index.ts'), "export const ts = 1;\n");
  writeFileSync(join(dir, 'service.py'), 'def svc():\n    return 1\n');
  writeFileSync(join(dir, 'main.go'), 'package main\nfunc main(){}\n');
  writeFileSync(join(dir, 'readme.txt'), 'no extractor for me\n');

  // Skipped via ALWAYS_SKIP_DIRS.
  mkdirSync(join(dir, 'node_modules', 'lib'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'lib', 'index.ts'), 'export const x = 1;\n');

  // Skipped via .gitignore.
  writeFileSync(join(dir, '.gitignore'), 'ignored/\n*.gen.ts\n');
  mkdirSync(join(dir, 'ignored'), { recursive: true });
  writeFileSync(join(dir, 'ignored', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'fixture.gen.ts'), 'export const g = 1;\n');

  return dir;
}

/**
 * Build a deterministic stub parser keyed by extension. Returns ParseResult
 * objects that mimic what a real extractor would produce.
 */
function stubParser(repoPath: string): (filePath: string) => ParseResult | null {
  return (filePath: string) => {
    if (filePath.endsWith('.ts')) {
      return {
        filePath,
        language: 'typescript',
        nodes: [
          {
            kind: 'module',
            name: filePath,
            filePath,
            startLine: 1,
            endLine: 1,
          },
          {
            kind: 'export',
            name: 'ts',
            filePath,
            startLine: 1,
            endLine: 1,
            parent: filePath,
          },
        ],
        edges: [
          { from: filePath, to: 'ts', type: 'contains' },
        ],
        parseErrors: [],
      };
    }
    if (filePath.endsWith('.py')) {
      return {
        filePath,
        language: 'python',
        nodes: [
          {
            kind: 'function',
            name: 'svc',
            filePath,
            startLine: 1,
            endLine: 2,
          },
        ],
        edges: [
          { from: filePath, to: 'svc', type: 'contains' },
        ],
        parseErrors: ['noisy-warning'],
      };
    }
    if (filePath.endsWith('.go')) {
      return {
        filePath,
        language: 'go',
        nodes: [
          {
            kind: 'function',
            name: 'main',
            filePath,
            startLine: 2,
            endLine: 2,
          },
        ],
        edges: [],
        parseErrors: [],
      };
    }
    // No extractor for .txt / .gitignore / etc.
    return null;
  };
}

describe('runStructurePass', () => {
  let repoPath: string;

  beforeEach(() => {
    repoPath = makeRepo();
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  it('walks the repo, parses supported files, and aggregates nodes/edges', async () => {
    const result = await runStructurePass(repoPath, 'repo-1', {
      parser: stubParser(repoPath),
    });

    expect(result.repoId).toBe('repo-1');
    expect(result.repoPath).toBe(repoPath);

    // We expect 3 supported files (ts/py/go), regardless of how many the
    // walker yielded — the .txt has no extractor so it returns null.
    expect(result.filesParsed).toBe(3);
    expect(result.filesWalked).toBeGreaterThanOrEqual(3);

    // .gitignore and ALWAYS_SKIP_DIRS must keep these out.
    expect(result.filesWalked).toBeLessThan(20);
    const allNodeNames = result.nodes.map((n) => n.name);
    expect(allNodeNames).toContain('svc');
    expect(allNodeNames).toContain('main');
    expect(allNodeNames).toContain('ts');
    expect(allNodeNames).not.toContain('a'); // from ignored/a.ts
    expect(allNodeNames).not.toContain('g'); // from fixture.gen.ts
  });

  it('records parseErrors against the affected file', async () => {
    const result = await runStructurePass(repoPath, 'repo-1', {
      parser: stubParser(repoPath),
    });

    const pyError = result.fileErrors.find((e) => e.filePath.endsWith('service.py'));
    expect(pyError).toBeDefined();
    expect(pyError!.errors).toEqual(['noisy-warning']);

    // Other languages had no errors and shouldn't appear.
    expect(
      result.fileErrors.find((e) => e.filePath.endsWith('index.ts')),
    ).toBeUndefined();
  });

  it('rebases extractor-supplied paths to repo-relative', async () => {
    const result = await runStructurePass(repoPath, 'repo-1', {
      parser: stubParser(repoPath),
    });

    for (const node of result.nodes) {
      expect(node.filePath).not.toMatch(/^\//);
      expect(node.filePath).not.toMatch(/^[A-Za-z]:\\/);
    }
  });

  it('deduplicates nodes and edges across files', async () => {
    // Two "files" that emit identical nodes+edges; aggregated result must
    // collapse them.
    const duplicateParser = (filePath: string): ParseResult => ({
      filePath,
      language: 'typescript',
      nodes: [
        {
          kind: 'function',
          name: 'shared',
          filePath: 'shared.ts',
          startLine: 1,
          endLine: 1,
        },
      ],
      edges: [{ from: 'shared.ts', to: 'shared', type: 'contains' }],
      parseErrors: [],
    });

    const result = await runStructurePass(repoPath, 'repo-1', {
      walker: () => [join(repoPath, 'a.ts'), join(repoPath, 'b.ts')],
      parser: duplicateParser,
    });

    expect(result.filesParsed).toBe(2);
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(1);
  });

  it('handles a parser returning null without crashing', async () => {
    const result = await runStructurePass(repoPath, 'repo-1', {
      walker: () => [join(repoPath, 'whatever.bin')],
      parser: () => null,
    });

    expect(result.filesWalked).toBe(1);
    expect(result.filesParsed).toBe(0);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.fileErrors).toEqual([]);
  });
});
