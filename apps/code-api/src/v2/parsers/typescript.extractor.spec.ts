/**
 * Tests for the TypeScript tree-sitter extractor.
 *
 * Co-located under `src/` because Jest's rootDir is `src` (see EC-8 spec for
 * the rationale). Tests exercise the extractor directly, not through the
 * harness, so they don't need a tmpdir + writeFile dance.
 */

import { clear, getByExtension, getByLanguage } from './registry';
import {
  registerTypeScriptExtractor,
  typescriptExtractor,
} from './typescript.extractor';

describe('v2 typescript extractor', () => {
  beforeEach(() => {
    clear();
  });

  afterEach(() => {
    clear();
  });

  it('registers under .ts and .tsx with language id "typescript"', () => {
    registerTypeScriptExtractor();
    expect(getByLanguage('typescript')).toBe(typescriptExtractor);
    expect(getByExtension('.ts')).toBe(typescriptExtractor);
    expect(getByExtension('.tsx')).toBe(typescriptExtractor);
  });

  it('extracts exported functions with a contains edge and export node', () => {
    const result = typescriptExtractor.parse(
      'src/example.ts',
      'export function greet(name: string): string {\n  return `hi ${name}`;\n}\n',
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.language).toBe('typescript');

    const fn = result.nodes.find((n) => n.kind === 'function');
    expect(fn).toMatchObject({
      kind: 'function',
      name: 'greet',
      parent: 'src/example',
      startLine: 1,
    });
    expect(fn?.metadata).toMatchObject({ exported: true, default: false });

    const exportNode = result.nodes.find((n) => n.kind === 'export');
    expect(exportNode?.name).toBe('greet');

    expect(result.edges).toContainEqual({
      from: 'src/example',
      to: 'greet',
      type: 'contains',
    });
  });

  it('extracts exported classes, methods, and extends edges', () => {
    const source = [
      'export class Dog extends Animal {',
      '  bark(): void {',
      '    console.log("woof");',
      '  }',
      '  fetch(): void {}',
      '}',
      '',
    ].join('\n');
    const result = typescriptExtractor.parse('src/dog.ts', source);

    expect(result.parseErrors).toEqual([]);

    const cls = result.nodes.find((n) => n.kind === 'class');
    expect(cls).toMatchObject({ name: 'Dog', parent: 'src/dog' });
    expect(cls?.metadata).toMatchObject({ exported: true });

    const methods = result.nodes.filter((n) => n.kind === 'method');
    expect(methods.map((m) => m.name).sort()).toEqual(['bark', 'fetch']);
    expect(methods.every((m) => m.parent === 'Dog')).toBe(true);

    expect(result.edges).toContainEqual({
      from: 'Dog',
      to: 'Animal',
      type: 'extends',
    });
    expect(result.edges).toContainEqual({
      from: 'Dog',
      to: 'Dog.bark',
      type: 'contains',
    });
  });

  it('extracts interface declarations', () => {
    const result = typescriptExtractor.parse(
      'src/types.ts',
      'export interface User {\n  id: string;\n  name: string;\n}\n',
    );

    expect(result.parseErrors).toEqual([]);

    const iface = result.nodes.find((n) => n.kind === 'interface');
    expect(iface).toMatchObject({
      name: 'User',
      parent: 'src/types',
      kind: 'interface',
    });
    expect(iface?.metadata).toMatchObject({ exported: true });

    expect(result.edges).toContainEqual({
      from: 'src/types',
      to: 'User',
      type: 'contains',
    });
  });

  it('extracts imports with source path and imports edges', () => {
    const source = [
      'import { readFileSync } from "node:fs";',
      'import path from "node:path";',
      'import * as os from "node:os";',
      'import "./side-effect";',
      '',
    ].join('\n');
    const result = typescriptExtractor.parse('src/app.ts', source);

    expect(result.parseErrors).toEqual([]);

    const imports = result.nodes.filter((n) => n.kind === 'import');
    const sources = imports.map((i) => i.name).sort();
    expect(sources).toEqual([
      './side-effect',
      'node:fs',
      'node:os',
      'node:path',
    ]);

    expect(result.edges).toContainEqual({
      from: 'src/app',
      to: 'node:fs',
      type: 'imports',
    });
    expect(result.edges.filter((e) => e.type === 'imports')).toHaveLength(4);
  });

  it('captures call sites within functions as calls edges', () => {
    const source = [
      'import { helper } from "./helper";',
      '',
      'export function main(): void {',
      '  helper();',
      '  console.log("done");',
      '  nested(deeper());',
      '}',
      '',
    ].join('\n');
    const result = typescriptExtractor.parse('src/main.ts', source);

    expect(result.parseErrors).toEqual([]);

    const callEdges = result.edges.filter((e) => e.type === 'calls');
    const targets = callEdges.map((e) => e.to).sort();
    // We collect both `nested` and the inner `deeper` it wraps, plus member
    // expressions like `console.log` show up by their full textual form.
    expect(targets).toEqual(
      ['console.log', 'deeper', 'helper', 'nested'].sort(),
    );
    expect(callEdges.every((e) => e.from === 'main')).toBe(true);

    const callNodes = result.nodes.filter((n) => n.kind === 'call');
    expect(callNodes.length).toBeGreaterThanOrEqual(4);
    expect(callNodes.every((n) => n.parent === 'main')).toBe(true);
  });

  it('captures parse errors on malformed TypeScript without throwing', () => {
    // Missing closing brace + dangling parameter list.
    const source = 'function broken(x: number {\n  return ;\n';
    expect(() => typescriptExtractor.parse('src/broken.ts', source)).not.toThrow();

    const result = typescriptExtractor.parse('src/broken.ts', source);
    expect(result.parseErrors.length).toBeGreaterThan(0);
    expect(result.language).toBe('typescript');
    // Module node is still emitted so downstream passes have something to anchor on.
    expect(result.nodes.some((n) => n.kind === 'module')).toBe(true);
  });

  it('extracts bare identifiers for `export const X = ...` forms (EC-18)', () => {
    const source = [
      'export const EXIT = {',
      '  OK: 0,',
      '  USAGE: 64,',
      '} as const;',
      '',
      'export let counter = 0, label = "x";',
      '',
    ].join('\n');
    const result = typescriptExtractor.parse('src/exit.ts', source);

    expect(result.parseErrors).toEqual([]);
    const exportNames = result.nodes
      .filter((n) => n.kind === 'export')
      .map((n) => n.name)
      .sort();
    expect(exportNames).toEqual(['EXIT', 'counter', 'label']);
  });

  it('extracts each identifier from `export { a, b, c as d }` (EC-18)', () => {
    const source = [
      'const cardFilePath = "";',
      'const readCard = () => null;',
      'const writeCard = () => null;',
      'const original = 1;',
      'export { cardFilePath, readCard, writeCard, original as alias };',
      '',
    ].join('\n');
    const result = typescriptExtractor.parse('src/cli.ts', source);

    expect(result.parseErrors).toEqual([]);
    const exportNames = result.nodes
      .filter((n) => n.kind === 'export')
      .map((n) => n.name)
      .sort();
    expect(exportNames).toEqual(['alias', 'cardFilePath', 'readCard', 'writeCard']);
  });

  it('extracts re-exports and namespace re-exports (EC-18)', () => {
    const source = [
      'export { foo } from "./foo";',
      'export * from "./bar";',
      '',
    ].join('\n');
    const result = typescriptExtractor.parse('src/index.ts', source);

    expect(result.parseErrors).toEqual([]);
    const exports = result.nodes.filter((n) => n.kind === 'export');
    const named = exports.find((e) => e.name === 'foo');
    expect(named).toBeDefined();
    expect(named?.metadata).toMatchObject({ source: './foo', reexport: true });
    const star = exports.find((e) => e.name === '*');
    expect(star).toBeDefined();
    expect(star?.metadata).toMatchObject({ source: './bar', reexport: true });
  });

  it('extracts destructured exports as one symbol per binding (EC-18)', () => {
    const source = [
      'const obj = { a: 1, b: 2 };',
      'export const { a, b: renamed } = obj;',
      'export const [x, ...rest] = [1, 2, 3];',
      '',
    ].join('\n');
    const result = typescriptExtractor.parse('src/destr.ts', source);

    expect(result.parseErrors).toEqual([]);
    const exportNames = result.nodes
      .filter((n) => n.kind === 'export')
      .map((n) => n.name)
      .sort();
    expect(exportNames).toEqual(['a', 'renamed', 'rest', 'x']);
  });

  it('extracts default exports with appropriate names (EC-18)', () => {
    const namedFn = typescriptExtractor.parse(
      'src/a.ts',
      'export default function foo() {}\n',
    );
    expect(namedFn.nodes.find((n) => n.kind === 'export')?.name).toBe('foo');

    const namedCls = typescriptExtractor.parse(
      'src/b.ts',
      'export default class Foo {}\n',
    );
    expect(namedCls.nodes.find((n) => n.kind === 'export')?.name).toBe('Foo');

    const anonExpr = typescriptExtractor.parse('src/c.ts', 'export default 42;\n');
    expect(anonExpr.nodes.find((n) => n.kind === 'export')?.name).toBe('default');

    const anonFn = typescriptExtractor.parse(
      'src/d.ts',
      'export default function () {}\n',
    );
    expect(anonFn.nodes.find((n) => n.kind === 'export')?.name).toBe('default');
  });

  it('extracts `export type` and `export enum` declarations (EC-18)', () => {
    const source = [
      'export type Alias = string;',
      'export enum Color { Red, Green }',
      '',
    ].join('\n');
    const result = typescriptExtractor.parse('src/te.ts', source);
    expect(result.parseErrors).toEqual([]);
    const names = result.nodes
      .filter((n) => n.kind === 'export')
      .map((n) => n.name)
      .sort();
    expect(names).toEqual(['Alias', 'Color']);
  });

  it('every emitted export symbol name is a bare identifier (EC-18 regression guard)', () => {
    // Mixed fixture covering every export shape we touch. The single
    // assertion below is the real guard: source text must never leak into
    // a symbol name, regardless of which export form produced it.
    const source = [
      'import { dep } from "./dep";',
      '',
      'export const EXIT = { OK: 0 } as const;',
      'export let mutA = 1, mutB = 2;',
      'export const { a, b: renamed } = { a: 1, b: 2 };',
      'export const [first, ...rest] = [1, 2, 3];',
      'export function fn(): void {}',
      'export class Cls extends Base {',
      '  m(): void { dep(); }',
      '}',
      'export interface Iface { x: number; }',
      'export type Alias = string;',
      'export enum Color { Red, Green }',
      'export { mutA, mutB as renamedMut };',
      'export { thing } from "./other";',
      'export * from "./star";',
      'export default function namedDefault() {}',
      '',
    ].join('\n');
    const result = typescriptExtractor.parse('src/all.ts', source);

    expect(result.parseErrors).toEqual([]);
    const valid = /^[A-Za-z_$][\w$]*$|^\*$|^default$/;
    const exports = result.nodes.filter((n) => n.kind === 'export');
    expect(exports.length).toBeGreaterThan(0);
    for (const node of exports) {
      expect(node.name).toMatch(valid);
    }
  });

  it('handles .tsx by selecting the tsx grammar', () => {
    const source = [
      'export function View(): JSX.Element {',
      '  return <div onClick={handler()}>hi</div>;',
      '}',
      '',
    ].join('\n');
    const result = typescriptExtractor.parse('src/view.tsx', source);

    expect(result.parseErrors).toEqual([]);
    expect(result.nodes.some((n) => n.kind === 'function' && n.name === 'View')).toBe(true);
  });
});
