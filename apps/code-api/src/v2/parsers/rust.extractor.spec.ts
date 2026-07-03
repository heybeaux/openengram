/**
 * Tests for the Rust language extractor.
 */

import { clear, getByExtension, getByLanguage } from './registry';
import { rustExtractor, registerRustExtractor } from './rust.extractor';

const FILE = 'src/sample.rs';

describe('rust extractor', () => {
  beforeEach(() => {
    clear();
    registerRustExtractor();
  });

  afterEach(() => {
    clear();
  });

  it('registers itself for .rs and as language "rust"', () => {
    expect(getByLanguage('rust')).toBe(rustExtractor);
    expect(getByExtension('.rs')).toBe(rustExtractor);
    expect(getByExtension('rs')).toBe(rustExtractor);
  });

  it('emits a file-level module node spanning the file', () => {
    const src = `pub fn main() {}\n`;
    const result = rustExtractor.parse(FILE, src);

    expect(result.language).toBe('rust');
    expect(result.parseErrors).toEqual([]);

    const mod = result.nodes.find((n) => n.kind === 'module');
    expect(mod).toBeDefined();
    expect(mod?.name).toBe('sample');
    expect(mod?.filePath).toBe(FILE);
    expect(mod?.startLine).toBe(1);
  });

  it('extracts top-level fn declarations with contains edges and exported metadata', () => {
    const src = [
      'pub fn add(a: i32, b: i32) -> i32 { a + b }',
      '',
      'fn sub(a: i32, b: i32) -> i32 { a - b }',
    ].join('\n');

    const result = rustExtractor.parse(FILE, src);

    const fns = result.nodes.filter((n) => n.kind === 'function');
    expect(fns.map((f) => f.name).sort()).toEqual(['add', 'sub']);

    const add = fns.find((f) => f.name === 'add');
    expect(add?.metadata).toMatchObject({ exported: true });

    const sub = fns.find((f) => f.name === 'sub');
    expect(sub?.metadata).toMatchObject({ exported: false });

    const containsEdges = result.edges.filter((e) => e.type === 'contains');
    expect(containsEdges.some((e) => e.to === 'add')).toBe(true);
    expect(containsEdges.some((e) => e.to === 'sub')).toBe(true);
  });

  it('extracts struct, enum, and union as class nodes with shape metadata', () => {
    const src = [
      'pub struct User { pub name: String }',
      'pub enum Color { Red, Blue }',
      'pub union Bits { a: u32, b: f32 }',
    ].join('\n');

    const result = rustExtractor.parse(FILE, src);

    const classes = result.nodes.filter((n) => n.kind === 'class');
    expect(classes.map((c) => c.name).sort()).toEqual([
      'Bits',
      'Color',
      'User',
    ]);

    const user = classes.find((c) => c.name === 'User');
    expect(user?.metadata).toMatchObject({ exported: true, shape: 'struct' });

    const color = classes.find((c) => c.name === 'Color');
    expect(color?.metadata).toMatchObject({ shape: 'enum' });

    const bits = classes.find((c) => c.name === 'Bits');
    expect(bits?.metadata).toMatchObject({ shape: 'union' });
  });

  it('extracts traits as interface nodes and emits method declarations', () => {
    const src = [
      'pub trait Reader {',
      '  fn read(&self) -> i32;',
      '  fn close(&self) {}',
      '}',
    ].join('\n');

    const result = rustExtractor.parse(FILE, src);

    const iface = result.nodes.find((n) => n.kind === 'interface');
    expect(iface).toBeDefined();
    expect(iface?.name).toBe('Reader');

    const methods = result.nodes.filter((n) => n.kind === 'method');
    expect(methods.map((m) => m.name).sort()).toEqual(['close', 'read']);
    for (const m of methods) {
      expect(m.parent).toBe('Reader');
    }
  });

  it('extracts inherent impl methods with receiver type as parent', () => {
    const src = [
      'pub struct Server;',
      '',
      'impl Server {',
      '  pub fn serve(&self) {}',
      '  fn helper(&self) {}',
      '}',
    ].join('\n');

    const result = rustExtractor.parse(FILE, src);

    const methods = result.nodes.filter((n) => n.kind === 'method');
    expect(methods.map((m) => m.name).sort()).toEqual(['helper', 'serve']);
    for (const m of methods) {
      expect(m.parent).toBe('Server');
    }

    const containsEdges = result.edges.filter((e) => e.type === 'contains');
    expect(containsEdges.some((e) => e.to === 'Server.serve')).toBe(true);
    expect(containsEdges.some((e) => e.to === 'Server.helper')).toBe(true);
  });

  it('emits an extends edge from a type to a trait for `impl Trait for Type`', () => {
    const src = [
      'pub trait Reader { fn read(&self) -> i32; }',
      'pub struct Foo;',
      'impl Reader for Foo { fn read(&self) -> i32 { 0 } }',
    ].join('\n');

    const result = rustExtractor.parse(FILE, src);

    const extendsEdges = result.edges.filter((e) => e.type === 'extends');
    expect(extendsEdges).toHaveLength(1);
    expect(extendsEdges[0]).toMatchObject({ from: 'Foo', to: 'Reader' });
  });

  it('extracts use declarations as import nodes and imports edges', () => {
    const src = [
      'use std::collections::HashMap;',
      'use std::io::{Read, Write as W};',
      'use crate::util::*;',
      '',
      'fn main() {}',
    ].join('\n');

    const result = rustExtractor.parse(FILE, src);

    const imports = result.nodes.filter((n) => n.kind === 'import');
    const names = imports.map((i) => i.name).sort();
    expect(names).toEqual(
      [
        'crate::util::*',
        'std::collections::HashMap',
        'std::io::Read',
        'std::io::Write',
      ].sort(),
    );

    const writeImport = imports.find((i) => i.name === 'std::io::Write');
    expect(writeImport?.metadata).toMatchObject({ alias: 'W' });

    const importEdges = result.edges.filter((e) => e.type === 'imports');
    expect(importEdges.some((e) => e.to === 'std::collections::HashMap')).toBe(
      true,
    );
    expect(importEdges.some((e) => e.to === 'std::io::Read')).toBe(true);
    expect(importEdges.some((e) => e.to === 'crate::util::*')).toBe(true);
  });

  it('extracts nested mod items as module nodes', () => {
    const src = ['pub mod inner {', '  pub fn ping() {}', '}'].join('\n');

    const result = rustExtractor.parse(FILE, src);

    const inner = result.nodes.find(
      (n) => n.kind === 'module' && n.name === 'inner',
    );
    expect(inner).toBeDefined();
    expect(inner?.metadata).toMatchObject({ exported: true });

    const ping = result.nodes.find(
      (n) => n.kind === 'function' && n.name === 'ping',
    );
    expect(ping?.parent).toBe('inner');
  });

  it('collects call expressions within fn bodies as call nodes and calls edges', () => {
    const src = [
      'fn greet(name: &str) {',
      '  helper();',
      '  std::process::exit(0);',
      '}',
      '',
      'fn helper() {}',
    ].join('\n');

    const result = rustExtractor.parse(FILE, src);

    const callNodes = result.nodes.filter((n) => n.kind === 'call');
    const callNames = callNodes.map((c) => c.name);
    expect(callNames).toContain('helper');
    expect(callNames).toContain('std::process::exit');

    const callEdges = result.edges.filter((e) => e.type === 'calls');
    expect(callEdges.every((e) => e.from === 'greet')).toBe(true);
  });

  it('captures syntax errors in parseErrors without throwing', () => {
    const src = 'fn broken( {\n';
    const result = rustExtractor.parse(FILE, src);
    expect(result.parseErrors.length).toBeGreaterThan(0);
    expect(result.nodes.find((n) => n.kind === 'module')).toBeDefined();
  });
});
