/**
 * Tests for structural gotcha detection (EC-24).
 */

import { detectModuleGotchas } from './detector';

describe('detectModuleGotchas — tag comments', () => {
  it('flags TODO/FIXME/HACK/XXX/WARNING/NOTE in line comments', () => {
    const src = [
      '// TODO: rewrite this',
      'function x() {}',
      '// FIXME(beaux): broken on Windows',
      '// HACK -- temporary',
      '# XXX: legacy',
      '// WARNING: races with caller',
      '// NOTE: assumes UTC',
    ].join('\n');
    const result = detectModuleGotchas({
      modulePath: 'src/a',
      files: [{ path: 'src/a/x.ts', source: src, language: 'typescript' }],
    });
    const tags = result.candidates
      .filter((c) => c.kind === 'tag-comment')
      .map((c) => c.metadata?.tag);
    expect(tags).toEqual(['TODO', 'FIXME', 'HACK', 'XXX', 'WARNING', 'NOTE']);
  });

  it('ignores tag-shaped words inside non-comment code', () => {
    const src = ['const TODO = "not a comment";', 'function foo() { return "FIXME"; }'].join('\n');
    const result = detectModuleGotchas({
      modulePath: 'src/a',
      files: [{ path: 'src/a/x.ts', source: src, language: 'typescript' }],
    });
    expect(result.candidates.filter((c) => c.kind === 'tag-comment')).toHaveLength(0);
  });
});

describe('detectModuleGotchas — long docstrings', () => {
  it('flags JSDoc blocks > 5 lines', () => {
    const block = ['/**', ' * line a', ' * line b', ' * line c', ' * line d', ' * line e', ' */'].join('\n');
    const result = detectModuleGotchas({
      modulePath: 'src/a',
      files: [{ path: 'src/a/x.ts', source: block, language: 'typescript' }],
    });
    expect(result.candidates.some((c) => c.kind === 'long-docstring')).toBe(true);
  });

  it('skips short JSDoc blocks', () => {
    const block = ['/**', ' * brief', ' */'].join('\n');
    const result = detectModuleGotchas({
      modulePath: 'src/a',
      files: [{ path: 'src/a/x.ts', source: block, language: 'typescript' }],
    });
    expect(result.candidates.filter((c) => c.kind === 'long-docstring')).toHaveLength(0);
  });

  it('flags triple-quoted python docstrings > 5 lines', () => {
    const src = [
      'def foo():',
      '    """',
      '    line a',
      '    line b',
      '    line c',
      '    line d',
      '    line e',
      '    """',
      '    pass',
    ].join('\n');
    const result = detectModuleGotchas({
      modulePath: 'pkg',
      files: [{ path: 'pkg/x.py', source: src, language: 'python' }],
    });
    expect(result.candidates.some((c) => c.kind === 'long-docstring')).toBe(true);
  });
});

describe('detectModuleGotchas — sibling docs', () => {
  it('emits one sibling-doc candidate per doc', () => {
    const result = detectModuleGotchas({
      modulePath: 'src/a',
      files: [{ path: 'src/a/x.ts', source: '// clean', language: 'typescript' }],
      siblingDocs: [
        { path: 'src/a/README.md', source: '# Auth\nThis module handles login.' },
        { path: 'src/a/ADR-001.md', source: '# ADR-001\nWe chose JWT because...' },
      ],
    });
    const docs = result.candidates.filter((c) => c.kind === 'sibling-doc');
    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.metadata?.name).sort()).toEqual(['ADR-001.md', 'README.md']);
  });
});

describe('detectModuleGotchas — convention outliers', () => {
  it('flags classes missing the dominant decorator', () => {
    const file = (name: string, dec?: string) =>
      (dec ? `@${dec}\n` : '') + `export class ${name} { foo() {} }`;
    const src = [
      file('A', 'Injectable'),
      file('B', 'Injectable'),
      file('C', 'Injectable'),
      file('D'),
    ].join('\n\n');
    const result = detectModuleGotchas({
      modulePath: 'src/svc',
      files: [{ path: 'src/svc/all.ts', source: src, language: 'typescript' }],
    });
    const outliers = result.candidates.filter((c) => c.kind === 'convention-outlier');
    expect(outliers).toHaveLength(1);
    expect(outliers[0].metadata?.missing).toBe('@Injectable');
    expect(outliers[0].excerpt).toContain('class D');
  });

  it('does not flag when fewer than 3 classes exist', () => {
    const src = '@Injectable\nexport class A {}\n\nexport class B {}';
    const result = detectModuleGotchas({
      modulePath: 'src/svc',
      files: [{ path: 'src/svc/x.ts', source: src, language: 'typescript' }],
    });
    expect(result.candidates.filter((c) => c.kind === 'convention-outlier')).toHaveLength(0);
  });

  it('does not flag when dominant ratio is below 70%', () => {
    const src = [
      '@Injectable\nexport class A {}',
      'export class B {}',
      'export class C {}',
      'export class D {}',
    ].join('\n\n');
    const result = detectModuleGotchas({
      modulePath: 'src/svc',
      files: [{ path: 'src/svc/x.ts', source: src, language: 'typescript' }],
    });
    expect(result.candidates.filter((c) => c.kind === 'convention-outlier')).toHaveLength(0);
  });
});

describe('detectModuleGotchas — ordering + empty', () => {
  it('returns candidates sorted by file then line', () => {
    const src = ['// TODO: a', '', '// FIXME: b'].join('\n');
    const result = detectModuleGotchas({
      modulePath: 'src/a',
      files: [
        { path: 'src/a/z.ts', source: src, language: 'typescript' },
        { path: 'src/a/a.ts', source: '// TODO: aa', language: 'typescript' },
      ],
    });
    const tags = result.candidates.filter((c) => c.kind === 'tag-comment');
    expect(tags[0].filePath).toBe('src/a/a.ts');
    expect(tags[1].filePath).toBe('src/a/z.ts');
  });

  it('returns an empty candidate list for a clean module', () => {
    const result = detectModuleGotchas({
      modulePath: 'src/clean',
      files: [{ path: 'src/clean/x.ts', source: 'export function f() { return 1; }' }],
    });
    expect(result.candidates).toHaveLength(0);
  });
});
