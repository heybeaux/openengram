/**
 * Tests for the complexity signal collector (EC-44).
 *
 * Exercised through the injectable `readFile` hook. Each test asserts
 * on both the `sloc` and `cyclomatic` heuristics so a regression in
 * the comment/string stripper or the decision counter is caught.
 */

import * as path from 'node:path';

import { collectComplexity, type ReadFile } from './complexity';

const ROOT = path.resolve('/repo');
const abs = (rel: string) => path.resolve(ROOT, rel);

function fakeFs(files: Record<string, string>): { readFile: ReadFile } {
  const readFile: ReadFile = (p) =>
    p in files
      ? Promise.resolve(files[p])
      : Promise.reject(new Error(`ENOENT: ${p}`));
  return { readFile };
}

describe('collectComplexity', () => {
  it('returns baseline 1 for straight-line code and counts sloc', async () => {
    const src = ['const a = 1;', 'const b = 2;', 'export { a, b };'].join('\n');
    const { readFile } = fakeFs({ [abs('src/x.ts')]: src });
    const [sig] = await collectComplexity({
      repoRoot: ROOT,
      files: [abs('src/x.ts')],
      readFile,
    });
    expect(sig.filePath).toBe('src/x.ts');
    expect(sig.sloc).toBe(3);
    expect(sig.cyclomatic).toBe(1);
  });

  it('counts McCabe-style decisions: if, else if, for, while, case, catch', async () => {
    const src = [
      'function f(x) {',
      '  if (x > 0) {',
      '    for (let i = 0; i < x; i++) {',
      '      while (i < 5) {',
      '        switch (i) {',
      '          case 1: break;',
      '          case 2: break;',
      '        }',
      '      }',
      '    }',
      '  } else if (x < 0) {',
      '    try { f(-x); } catch (e) { return e; }',
      '  }',
      '  return x;',
      '}',
    ].join('\n');
    const { readFile } = fakeFs({ [abs('src/f.ts')]: src });
    const [sig] = await collectComplexity({
      repoRoot: ROOT,
      files: [abs('src/f.ts')],
      readFile,
    });
    // 2x if, 1x for, 1x while, 2x case, 1x catch = 7 decisions, +1 baseline = 8.
    expect(sig.cyclomatic).toBe(8);
  });

  it('counts &&, ||, and ternary ? as decisions', async () => {
    const src = 'const v = a && b || c ? d : e;\n';
    const { readFile } = fakeFs({ [abs('src/v.ts')]: src });
    const [sig] = await collectComplexity({
      repoRoot: ROOT,
      files: [abs('src/v.ts')],
      readFile,
    });
    // 1x &&, 1x ||, 1x ternary = 3 decisions, +1 baseline = 4.
    expect(sig.cyclomatic).toBe(4);
  });

  it('does not count ?? or ?. as decisions', async () => {
    const src = 'const v = a ?? b; const w = a?.b;\n';
    const { readFile } = fakeFs({ [abs('src/v.ts')]: src });
    const [sig] = await collectComplexity({
      repoRoot: ROOT,
      files: [abs('src/v.ts')],
      readFile,
    });
    expect(sig.cyclomatic).toBe(1);
  });

  it('strips comments before counting (sloc and decisions)', async () => {
    const src = [
      '// if this counted, cyclomatic would be wrong',
      '/* if (a || b) { ... } */',
      'const a = 1;',
      '',
      'const b = 2; // inline comment still counts the code',
    ].join('\n');
    const { readFile } = fakeFs({ [abs('src/c.ts')]: src });
    const [sig] = await collectComplexity({
      repoRoot: ROOT,
      files: [abs('src/c.ts')],
      readFile,
    });
    expect(sig.sloc).toBe(2);
    expect(sig.cyclomatic).toBe(1);
  });

  it('strips string-literal contents before counting', async () => {
    // The `||` and `if` inside the string should not inflate cyclomatic.
    const src = "const msg = 'if a || b then c'; const real = a ? b : c;\n";
    const { readFile } = fakeFs({ [abs('src/s.ts')]: src });
    const [sig] = await collectComplexity({
      repoRoot: ROOT,
      files: [abs('src/s.ts')],
      readFile,
    });
    // Only the real ternary should count.
    expect(sig.cyclomatic).toBe(2);
  });

  it('handles a multi-line block comment without counting it as sloc', async () => {
    const src = [
      '/**',
      ' * docblock with code-shaped lines',
      ' * if (x) return y;',
      ' */',
      'const a = 1;',
    ].join('\n');
    const { readFile } = fakeFs({ [abs('src/d.ts')]: src });
    const [sig] = await collectComplexity({
      repoRoot: ROOT,
      files: [abs('src/d.ts')],
      readFile,
    });
    expect(sig.sloc).toBe(1);
    expect(sig.cyclomatic).toBe(1);
  });

  it('wraps read failures with the offending path', async () => {
    const readFile: ReadFile = (p) => Promise.reject(new Error(`EACCES: ${p}`));
    await expect(
      collectComplexity({
        repoRoot: ROOT,
        files: [abs('src/x.ts')],
        readFile,
      }),
    ).rejects.toThrow(/complexity: read failed for .*src\/x\.ts/);
  });
});
