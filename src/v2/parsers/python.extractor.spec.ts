/**
 * Tests for the Python language extractor.
 *
 * Co-located under `src/` because Jest's `rootDir` is `src` — see the note in
 * harness.spec.ts for the longer rationale.
 */

import { clear, getByExtension, getByLanguage } from './registry';
import { pythonExtractor, registerPythonExtractor } from './python.extractor';

const FILE = 'sample.py';

describe('python extractor', () => {
  beforeEach(() => {
    clear();
    registerPythonExtractor();
  });

  afterEach(() => {
    clear();
  });

  it('registers itself for .py and as language "python"', () => {
    expect(getByLanguage('python')).toBe(pythonExtractor);
    expect(getByExtension('.py')).toBe(pythonExtractor);
    expect(getByExtension('py')).toBe(pythonExtractor);
  });

  it('extracts module-level functions with contains edges to the module', () => {
    const src = [
      'def alpha():',
      '    return 1',
      '',
      'def beta(x, y):',
      '    return x + y',
      '',
    ].join('\n');

    const result = pythonExtractor.parse(FILE, src);

    expect(result.language).toBe('python');
    expect(result.parseErrors).toEqual([]);

    const functions = result.nodes.filter((n) => n.kind === 'function');
    expect(functions.map((n) => n.name).sort()).toEqual(['alpha', 'beta']);
    expect(functions.every((n) => n.parent === undefined)).toBe(true);

    const containsToBeta = result.edges.find(
      (e) => e.type === 'contains' && e.to === 'beta',
    );
    expect(containsToBeta?.from).toBe(FILE);
  });

  it('extracts a class with methods and an extends edge', () => {
    const src = [
      'class Animal:',
      '    pass',
      '',
      'class Dog(Animal):',
      '    def bark(self):',
      '        return "woof"',
      '',
      '    def sit(self):',
      '        return True',
      '',
    ].join('\n');

    const result = pythonExtractor.parse(FILE, src);

    const classes = result.nodes.filter((n) => n.kind === 'class');
    expect(classes.map((n) => n.name).sort()).toEqual(['Animal', 'Dog']);

    const methods = result.nodes.filter((n) => n.kind === 'method');
    expect(methods.map((m) => m.name).sort()).toEqual(['bark', 'sit']);
    expect(methods.every((m) => m.parent === 'Dog')).toBe(true);

    const extendsEdge = result.edges.find((e) => e.type === 'extends');
    expect(extendsEdge).toEqual({ from: 'Dog', to: 'Animal', type: 'extends' });

    const dogContainsBark = result.edges.find(
      (e) => e.type === 'contains' && e.from === 'Dog' && e.to === 'bark',
    );
    expect(dogContainsBark).toBeDefined();
  });

  it('captures plain imports and from-imports with their edges', () => {
    const src = [
      'import os',
      'import sys as system',
      'from collections import OrderedDict, defaultdict as dd',
      'from .relative import foo',
      '',
    ].join('\n');

    const result = pythonExtractor.parse(FILE, src);

    const imports = result.nodes.filter((n) => n.kind === 'import');
    expect(imports.map((n) => n.name)).toEqual([
      'os',
      'sys',
      'collections',
      '.relative',
    ]);

    const sysNode = imports.find((n) => n.name === 'sys');
    expect(sysNode?.metadata?.alias).toBe('system');

    const collectionsNode = imports.find((n) => n.name === 'collections');
    expect(collectionsNode?.metadata?.symbols).toEqual([
      { name: 'OrderedDict' },
      { name: 'defaultdict', alias: 'dd' },
    ]);

    const importEdges = result.edges
      .filter((e) => e.type === 'imports')
      .map((e) => e.to)
      .sort();
    expect(importEdges).toEqual(['.relative', 'collections', 'os', 'sys']);
    expect(
      result.edges
        .filter((e) => e.type === 'imports')
        .every((e) => e.from === FILE),
    ).toBe(true);
  });

  it('captures decorators on functions and classes in metadata', () => {
    const src = [
      '@staticmethod',
      '@cache',
      'def memoized():',
      '    pass',
      '',
      '@dataclass(frozen=True)',
      'class Point:',
      '    x: int',
      '    y: int',
      '',
    ].join('\n');

    const result = pythonExtractor.parse(FILE, src);

    const fn = result.nodes.find(
      (n) => n.kind === 'function' && n.name === 'memoized',
    );
    expect(fn?.metadata?.decorators).toEqual(['staticmethod', 'cache']);

    const cls = result.nodes.find(
      (n) => n.kind === 'class' && n.name === 'Point',
    );
    expect(cls?.metadata?.decorators).toEqual(['dataclass(frozen=True)']);
  });

  it('emits export nodes for each name in __all__', () => {
    const src = [
      'def public():',
      '    pass',
      '',
      'def _private():',
      '    pass',
      '',
      "__all__ = ['public', \"PublicClass\"]",
      '',
      'class PublicClass:',
      '    pass',
      '',
    ].join('\n');

    const result = pythonExtractor.parse(FILE, src);

    const exports = result.nodes.filter((n) => n.kind === 'export');
    expect(exports.map((e) => e.name)).toEqual(['public', 'PublicClass']);
    expect(exports.every((e) => e.metadata?.source === '__all__')).toBe(true);
    expect(exports.every((e) => e.parent === FILE)).toBe(true);
  });

  it('captures syntax errors in parseErrors instead of throwing', () => {
    const src = ['def broken(:', '    pass', ''].join('\n');

    const result = pythonExtractor.parse(FILE, src);

    expect(result.parseErrors.length).toBeGreaterThan(0);
    expect(result.parseErrors.some((m) => /line \d+/.test(m))).toBe(true);
    // Even on syntax errors we still get the module node back.
    expect(result.nodes.some((n) => n.kind === 'module')).toBe(true);
  });
});
