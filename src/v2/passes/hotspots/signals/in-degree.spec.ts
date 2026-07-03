/**
 * Tests for the in-degree signal collector (EC-44).
 *
 * Exercised through the injectable `readFile` hook so no real files
 * are touched. Each test wires up a small in-memory map from absolute
 * path to source text.
 */

import * as path from 'node:path';

import { collectInDegree, type ReadFile } from './in-degree';

const ROOT = path.resolve('/repo');
const abs = (rel: string) => path.resolve(ROOT, rel);

function fakeFs(files: Record<string, string>): {
  readFile: ReadFile;
  reads: string[];
} {
  const reads: string[] = [];
  const readFile: ReadFile = (p) => {
    reads.push(p);
    if (!(p in files)) {
      return Promise.reject(new Error(`ENOENT: ${p}`));
    }
    return Promise.resolve(files[p]);
  };
  return { readFile, reads };
}

describe('collectInDegree', () => {
  it('returns zeros for every file when there are no imports', async () => {
    const files = {
      [abs('src/a.ts')]: 'export const a = 1;\n',
      [abs('src/b.ts')]: 'export const b = 2;\n',
    };
    const { readFile } = fakeFs(files);
    const out = await collectInDegree({
      repoRoot: ROOT,
      files: Object.keys(files),
      readFile,
    });
    expect(out).toEqual([
      { filePath: 'src/a.ts', inDegree: 0, outDegree: 0 },
      { filePath: 'src/b.ts', inDegree: 0, outDegree: 0 },
    ]);
  });

  it('counts one inbound edge per importing file', async () => {
    const files = {
      [abs('src/util.ts')]: 'export const x = 1;\n',
      [abs('src/a.ts')]: "import { x } from './util';\n",
      [abs('src/b.ts')]: "import { x } from './util';\n",
      [abs('src/c.ts')]: "import { x } from './util';\n",
    };
    const { readFile } = fakeFs(files);
    const out = await collectInDegree({
      repoRoot: ROOT,
      files: Object.keys(files),
      readFile,
    });
    const util = out.find((s) => s.filePath === 'src/util.ts')!;
    expect(util.inDegree).toBe(3);
    expect(util.outDegree).toBe(0);
    const a = out.find((s) => s.filePath === 'src/a.ts')!;
    expect(a.inDegree).toBe(0);
    expect(a.outDegree).toBe(1);
  });

  it('deduplicates multiple imports from the same source file', async () => {
    const files = {
      [abs('src/util.ts')]: 'export const x = 1; export const y = 2;\n',
      [abs('src/a.ts')]:
        "import { x } from './util';\nimport { y } from './util';\nconst v = require('./util');\n",
    };
    const { readFile } = fakeFs(files);
    const out = await collectInDegree({
      repoRoot: ROOT,
      files: Object.keys(files),
      readFile,
    });
    const util = out.find((s) => s.filePath === 'src/util.ts')!;
    expect(util.inDegree).toBe(1);
    const a = out.find((s) => s.filePath === 'src/a.ts')!;
    expect(a.outDegree).toBe(1);
  });

  it('ignores bare specifiers (node_modules and node: builtins)', async () => {
    const files = {
      [abs('src/a.ts')]:
        "import { readFile } from 'node:fs/promises';\nimport React from 'react';\nimport { x } from '@scope/pkg';\n",
    };
    const { readFile } = fakeFs(files);
    const out = await collectInDegree({
      repoRoot: ROOT,
      files: Object.keys(files),
      readFile,
    });
    expect(out).toEqual([{ filePath: 'src/a.ts', inDegree: 0, outDegree: 0 }]);
  });

  it('resolves extensionless relative specifiers and index files', async () => {
    const files = {
      [abs('src/pkg/index.ts')]: 'export const k = 1;\n',
      [abs('src/util.ts')]: 'export const u = 1;\n',
      [abs('src/a.ts')]:
        "import { u } from './util';\nimport { k } from './pkg';\n",
    };
    const { readFile } = fakeFs(files);
    const out = await collectInDegree({
      repoRoot: ROOT,
      files: Object.keys(files),
      readFile,
    });
    const a = out.find((s) => s.filePath === 'src/a.ts')!;
    expect(a.outDegree).toBe(2);
    const util = out.find((s) => s.filePath === 'src/util.ts')!;
    const idx = out.find((s) => s.filePath === 'src/pkg/index.ts')!;
    expect(util.inDegree).toBe(1);
    expect(idx.inDegree).toBe(1);
  });

  it('excludes self-edges', async () => {
    // A file that (pathologically) imports itself should not bump its
    // own in-degree.
    const files = {
      [abs('src/loop.ts')]:
        "import { z } from './loop';\nexport const z = 1;\n",
    };
    const { readFile } = fakeFs(files);
    const out = await collectInDegree({
      repoRoot: ROOT,
      files: Object.keys(files),
      readFile,
    });
    expect(out).toEqual([
      { filePath: 'src/loop.ts', inDegree: 0, outDegree: 0 },
    ]);
  });

  it('ignores edges to files outside the input set', async () => {
    // util.ts is imported but not in the scoped file set, so no edge
    // should be recorded.
    const files = {
      [abs('src/a.ts')]: "import { u } from './util';\n",
    };
    const { readFile } = fakeFs(files);
    const out = await collectInDegree({
      repoRoot: ROOT,
      files: Object.keys(files),
      readFile,
    });
    const a = out.find((s) => s.filePath === 'src/a.ts')!;
    expect(a.outDegree).toBe(0);
  });

  it('wraps read failures with the offending path', async () => {
    const readFile: ReadFile = (p) => Promise.reject(new Error(`EACCES: ${p}`));
    await expect(
      collectInDegree({
        repoRoot: ROOT,
        files: [abs('src/a.ts')],
        readFile,
      }),
    ).rejects.toThrow(/in-degree: read failed for .*src\/a\.ts/);
  });
});
