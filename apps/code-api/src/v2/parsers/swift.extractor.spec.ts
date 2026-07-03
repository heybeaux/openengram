/**
 * Tests for the Swift language extractor.
 */

import { clear, getByExtension, getByLanguage } from './registry';
import { registerSwiftExtractor, swiftExtractor } from './swift.extractor';

const FILE = 'Sources/Sample.swift';

describe('swift extractor', () => {
  beforeEach(() => {
    clear();
    registerSwiftExtractor();
  });

  afterEach(() => {
    clear();
  });

  it('registers itself for .swift and as language "swift"', () => {
    expect(getByLanguage('swift')).toBe(swiftExtractor);
    expect(getByExtension('.swift')).toBe(swiftExtractor);
    expect(getByExtension('swift')).toBe(swiftExtractor);
  });

  it('emits a file-level module node named after the file stem', () => {
    const src = 'func nothing() {}\n';
    const result = swiftExtractor.parse(FILE, src);

    expect(result.language).toBe('swift');
    expect(result.parseErrors).toEqual([]);

    const mods = result.nodes.filter((n) => n.kind === 'module');
    expect(mods).toHaveLength(1);
    expect(mods[0].name).toBe('Sample');
    expect(mods[0].filePath).toBe(FILE);
    expect(mods[0].startLine).toBe(1);
  });

  it('extracts top-level functions with contains edges and call edges', () => {
    const src = [
      'func greet() {',
      '  print("hi")',
      '  helper()',
      '}',
      'func helper() {}',
    ].join('\n');

    const result = swiftExtractor.parse(FILE, src);

    const fns = result.nodes.filter((n) => n.kind === 'function');
    expect(fns.map((f) => f.name).sort()).toEqual(['greet', 'helper']);

    const greet = fns.find((f) => f.name === 'greet')!;
    expect(greet.parent).toBe('Sample');

    const contains = result.edges.filter((e) => e.type === 'contains');
    expect(contains.some((e) => e.from === 'Sample' && e.to === 'greet')).toBe(
      true,
    );

    const calls = result.edges.filter((e) => e.type === 'calls');
    expect(calls.some((e) => e.from === 'greet' && e.to === 'print')).toBe(
      true,
    );
    expect(calls.some((e) => e.from === 'greet' && e.to === 'helper')).toBe(
      true,
    );
  });

  it('extracts class, struct, enum, and actor declarations with shape metadata', () => {
    const src = [
      'class Foo {}',
      'struct Bar {}',
      'enum Baz {',
      '  case x, y',
      '}',
      'actor Qux {}',
    ].join('\n');

    const result = swiftExtractor.parse(FILE, src);
    const classes = result.nodes.filter((n) => n.kind === 'class');

    const byName = Object.fromEntries(classes.map((c) => [c.name, c]));
    expect(byName.Foo.metadata).toMatchObject({ shape: 'class' });
    expect(byName.Bar.metadata).toMatchObject({ shape: 'struct' });
    expect(byName.Baz.metadata).toMatchObject({ shape: 'enum' });
    expect(byName.Qux.metadata).toMatchObject({ shape: 'actor' });

    for (const name of ['Foo', 'Bar', 'Baz', 'Qux']) {
      expect(byName[name].parent).toBe('Sample');
    }
  });

  it('records inheritance and protocol conformance as extends edges', () => {
    const src = [
      'class Foo: BaseClass, Proto1, Proto2 {}',
      'struct Pt: Equatable, Hashable {}',
    ].join('\n');

    const result = swiftExtractor.parse(FILE, src);
    const extends_ = result.edges.filter((e) => e.type === 'extends');

    expect(extends_).toEqual(
      expect.arrayContaining([
        { from: 'Foo', to: 'BaseClass', type: 'extends' },
        { from: 'Foo', to: 'Proto1', type: 'extends' },
        { from: 'Foo', to: 'Proto2', type: 'extends' },
        { from: 'Pt', to: 'Equatable', type: 'extends' },
        { from: 'Pt', to: 'Hashable', type: 'extends' },
      ]),
    );
  });

  it('emits methods inside a type body as method nodes parented to the type', () => {
    const src = [
      'class Greeter {',
      '  func hello(name: String) -> String {',
      '    print(name)',
      '    return "hi"',
      '  }',
      '  func goodbye() {}',
      '}',
    ].join('\n');

    const result = swiftExtractor.parse(FILE, src);
    const methods = result.nodes.filter((n) => n.kind === 'method');
    expect(methods.map((m) => m.name).sort()).toEqual(['goodbye', 'hello']);
    for (const m of methods) {
      expect(m.parent).toBe('Greeter');
    }

    const contains = result.edges.filter((e) => e.type === 'contains');
    expect(
      contains.some((e) => e.from === 'Greeter' && e.to === 'Greeter.hello'),
    ).toBe(true);

    const calls = result.edges.filter((e) => e.type === 'calls');
    expect(
      calls.some((e) => e.from === 'Greeter.hello' && e.to === 'print'),
    ).toBe(true);
  });

  it('emits protocols as interface nodes with method declarations', () => {
    const src = [
      'protocol Greeter: AnyObject {',
      '  func greet() -> String',
      '  var name: String { get }',
      '}',
    ].join('\n');

    const result = swiftExtractor.parse(FILE, src);

    const ifaces = result.nodes.filter((n) => n.kind === 'interface');
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0].name).toBe('Greeter');
    expect(ifaces[0].parent).toBe('Sample');

    const methods = result.nodes.filter((n) => n.kind === 'method');
    expect(methods.map((m) => m.name)).toEqual(['greet']);
    expect(methods[0].parent).toBe('Greeter');
    expect(methods[0].metadata).toMatchObject({ declaration: true });

    const extends_ = result.edges.filter((e) => e.type === 'extends');
    expect(extends_).toEqual(
      expect.arrayContaining([
        { from: 'Greeter', to: 'AnyObject', type: 'extends' },
      ]),
    );
  });

  it('emits extensions as class nodes with shape "extension" and conformance edges', () => {
    const src = [
      'extension Foo: Hashable {',
      '  func extra() { print("x") }',
      '}',
    ].join('\n');

    const result = swiftExtractor.parse(FILE, src);
    const classes = result.nodes.filter((n) => n.kind === 'class');
    const ext = classes.find((c) => c.name === 'Foo');
    expect(ext).toBeDefined();
    expect(ext!.metadata).toMatchObject({ shape: 'extension' });

    const methods = result.nodes.filter((n) => n.kind === 'method');
    expect(methods.map((m) => m.name)).toEqual(['extra']);
    expect(methods[0].parent).toBe('Foo');

    const extends_ = result.edges.filter((e) => e.type === 'extends');
    expect(extends_.some((e) => e.from === 'Foo' && e.to === 'Hashable')).toBe(
      true,
    );

    const calls = result.edges.filter((e) => e.type === 'calls');
    expect(calls.some((e) => e.from === 'Foo.extra' && e.to === 'print')).toBe(
      true,
    );
  });

  it('extracts import declarations with dotted paths and submodule specifiers', () => {
    const src = [
      'import Foundation',
      'import UIKit.UIView',
      'import struct Foundation.URL',
    ].join('\n');

    const result = swiftExtractor.parse(FILE, src);
    const imports = result.nodes.filter((n) => n.kind === 'import');
    expect(imports.map((i) => i.name).sort()).toEqual([
      'Foundation',
      'Foundation.URL',
      'UIKit.UIView',
    ]);

    const submodule = imports.find((i) => i.name === 'Foundation.URL');
    expect(submodule?.metadata).toMatchObject({ specifier: 'struct' });

    const importEdges = result.edges.filter((e) => e.type === 'imports');
    expect(
      importEdges.some((e) => e.from === 'Sample' && e.to === 'UIKit.UIView'),
    ).toBe(true);
  });

  it('records method calls on navigation expressions with full dotted text', () => {
    const src = [
      'func work() {',
      '  Module.Sub.fn()',
      '  obj.method()',
      '  self.helper()',
      '}',
    ].join('\n');

    const result = swiftExtractor.parse(FILE, src);
    const calls = result.edges.filter((e) => e.type === 'calls');
    const targets = calls.map((c) => c.to).sort();
    expect(targets).toEqual(['Module.Sub.fn', 'obj.method', 'self.helper']);
  });

  it('records parse errors without throwing on malformed source', () => {
    const src = ['class Broken {', '  func a(', '}'].join('\n');

    const result = swiftExtractor.parse(FILE, src);
    expect(result.parseErrors.length).toBeGreaterThan(0);
    // The file-level module node is still emitted so downstream passes
    // have something to anchor to.
    expect(result.nodes.some((n) => n.kind === 'module')).toBe(true);
  });
});
