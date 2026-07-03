/**
 * Tests for mechanical contracts extraction (EC-23).
 */

import type { StructureNode } from '../../parsers/types';
import {
  buildContractsFromStructure,
  sliceSignature,
} from './extractor';

function node(
  name: string,
  filePath: string,
  kind: StructureNode['kind'],
  metadata?: Record<string, unknown>,
  startLine = 1,
  endLine = 5,
): StructureNode {
  return { kind, name, filePath, startLine, endLine, metadata };
}

describe('sliceSignature', () => {
  it('extracts the first non-blank line, stripping the body brace', () => {
    const src = [
      '',
      'export function add(a: number, b: number): number {',
      '  return a + b;',
      '}',
    ].join('\n');
    const sig = sliceSignature(src, { startLine: 2, endLine: 4 });
    expect(sig).toBe('export function add(a: number, b: number): number');
  });

  it('handles arrow functions by keeping the `=>` marker', () => {
    const src = ['export const inc = (n: number): number => n + 1;'].join('\n');
    const sig = sliceSignature(src, { startLine: 1, endLine: 1 });
    expect(sig).toBe('export const inc = (n: number): number =>');
  });

  it('joins up to three lines when signature spans lines', () => {
    const src = [
      'export function long<T extends Record<string, unknown>>(',
      '  x: T,',
      '): T {',
    ].join('\n');
    const sig = sliceSignature(src, { startLine: 1, endLine: 3 });
    expect(sig).toContain('export function long');
    expect(sig).toContain('x: T');
    expect(sig.endsWith('{')).toBe(false);
  });

  it('returns empty when source is undefined', () => {
    expect(sliceSignature(undefined, { startLine: 1, endLine: 1 })).toBe('');
  });
});

describe('buildContractsFromStructure', () => {
  it('keeps only nodes flagged exported=true (typed kinds)', () => {
    const nodes: StructureNode[] = [
      node('Pub', 'src/a/file.ts', 'function', { exported: true }),
      node('priv', 'src/a/file.ts', 'function', { exported: false }),
      node('Cls', 'src/a/file.ts', 'class', { exported: true }),
    ];
    const sources: Record<string, string> = {
      'src/a/file.ts': [
        'export function Pub() { return 1; }',
        'function priv() {}',
        'export class Cls {}',
        '',
        '',
      ].join('\n'),
    };
    const modules = buildContractsFromStructure(
      nodes,
      'typescript',
      (p) => sources[p],
    );
    expect(modules).toHaveLength(1);
    expect(modules[0].modulePath).toBe('src/a');
    expect(modules[0].symbols.map((s) => s.name)).toEqual(['Cls', 'Pub']);
  });

  it('accepts python-style export nodes', () => {
    const nodes: StructureNode[] = [
      node('hello', 'pkg/mod.py', 'export', { source: '__all__' }, 1, 1),
    ];
    const modules = buildContractsFromStructure(nodes, 'python', () => 'def hello(): pass');
    expect(modules[0].symbols).toHaveLength(1);
    expect(modules[0].symbols[0].kind).toBe('export');
  });

  it('dedupes typed kind over bare export node', () => {
    const src = ['export function Foo(a: number) {}'].join('\n');
    const nodes: StructureNode[] = [
      node('Foo', 'src/a/x.ts', 'function', { exported: true }, 1, 1),
      node('Foo', 'src/a/x.ts', 'export', undefined, 1, 1),
    ];
    const modules = buildContractsFromStructure(nodes, 'typescript', () => src);
    expect(modules[0].symbols).toHaveLength(1);
    expect(modules[0].symbols[0].kind).toBe('function');
    expect(modules[0].symbols[0].signature).toContain('Foo');
  });

  it('groups by directory, alphabetical', () => {
    const nodes: StructureNode[] = [
      node('B', 'src/b/y.ts', 'function', { exported: true }),
      node('A', 'src/a/x.ts', 'function', { exported: true }),
    ];
    const modules = buildContractsFromStructure(nodes, 'typescript', () => '');
    expect(modules.map((m) => m.modulePath)).toEqual(['src/a', 'src/b']);
  });
});
