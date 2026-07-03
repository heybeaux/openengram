/**
 * Tests for the Elixir language extractor.
 */

import { clear, getByExtension, getByLanguage } from './registry';
import { elixirExtractor, registerElixirExtractor } from './elixir.extractor';

const FILE = 'lib/sample.ex';

describe('elixir extractor', () => {
  beforeEach(() => {
    clear();
    registerElixirExtractor();
  });

  afterEach(() => {
    clear();
  });

  it('registers itself for .ex/.exs and as language "elixir"', () => {
    expect(getByLanguage('elixir')).toBe(elixirExtractor);
    expect(getByExtension('.ex')).toBe(elixirExtractor);
    expect(getByExtension('ex')).toBe(elixirExtractor);
    expect(getByExtension('.exs')).toBe(elixirExtractor);
    expect(getByExtension('exs')).toBe(elixirExtractor);
  });

  it('extracts a defmodule as a module node spanning the file', () => {
    const src = [
      'defmodule MyApp.Foo do',
      '  def hello, do: :world',
      'end',
      '',
    ].join('\n');

    const result = elixirExtractor.parse(FILE, src);

    expect(result.language).toBe('elixir');
    expect(result.parseErrors).toEqual([]);

    const mods = result.nodes.filter((n) => n.kind === 'module');
    expect(mods).toHaveLength(1);
    expect(mods[0].name).toBe('MyApp.Foo');
    expect(mods[0].filePath).toBe(FILE);
    expect(mods[0].startLine).toBe(1);
  });

  it('extracts def/defp with visibility metadata and contains edges', () => {
    const src = [
      'defmodule App do',
      '  def pub(x), do: x',
      '  defp priv(y), do: y + 1',
      '  defmacro mac(z), do: z',
      'end',
    ].join('\n');

    const result = elixirExtractor.parse(FILE, src);

    const fns = result.nodes.filter((n) => n.kind === 'function');
    expect(fns.map((f) => f.name).sort()).toEqual(['mac', 'priv', 'pub']);

    const pub = fns.find((f) => f.name === 'pub');
    expect(pub?.parent).toBe('App');
    expect(pub?.metadata).toMatchObject({ macro: 'def', visibility: 'public' });

    const priv = fns.find((f) => f.name === 'priv');
    expect(priv?.metadata).toMatchObject({
      macro: 'defp',
      visibility: 'private',
    });

    const mac = fns.find((f) => f.name === 'mac');
    expect(mac?.metadata).toMatchObject({ macro: 'defmacro' });

    const containsEdges = result.edges.filter((e) => e.type === 'contains');
    expect(containsEdges.some((e) => e.from === 'App' && e.to === 'pub')).toBe(
      true,
    );
    expect(containsEdges.some((e) => e.from === 'App' && e.to === 'priv')).toBe(
      true,
    );
  });

  it('handles zero-arity, guarded, and shorthand function heads', () => {
    const src = [
      'defmodule App do',
      '  def zero, do: 0',
      '  def guarded(x) when is_integer(x), do: x',
      '  def shorthand(a, b), do: a + b',
      'end',
    ].join('\n');

    const result = elixirExtractor.parse(FILE, src);
    const fns = result.nodes.filter((n) => n.kind === 'function');
    const names = fns.map((f) => f.name).sort();
    expect(names).toEqual(['guarded', 'shorthand', 'zero']);
  });

  it('extracts alias/import/require/use as import nodes and edges', () => {
    const src = [
      'defmodule App do',
      '  alias MyApp.Bar',
      '  import Enum',
      '  require Logger',
      '  use GenServer',
      'end',
    ].join('\n');

    const result = elixirExtractor.parse(FILE, src);

    const imports = result.nodes.filter((n) => n.kind === 'import');
    expect(imports.map((i) => i.name).sort()).toEqual([
      'Enum',
      'GenServer',
      'Logger',
      'MyApp.Bar',
    ]);

    const macros = new Set(imports.map((i) => i.metadata?.macro));
    expect(macros).toEqual(new Set(['alias', 'import', 'require', 'use']));

    const importEdges = result.edges.filter((e) => e.type === 'imports');
    expect(importEdges.some((e) => e.to === 'MyApp.Bar')).toBe(true);
    expect(importEdges.some((e) => e.to === 'GenServer')).toBe(true);
    expect(importEdges.every((e) => e.from === 'App')).toBe(true);
  });

  it('extracts defstruct/defprotocol/defimpl/defexception as class nodes', () => {
    const src = [
      'defmodule App.User do',
      '  defstruct [:name, :age]',
      'end',
      '',
      'defmodule App.Comparable do',
      '  defprotocol Comp do',
      '    def cmp(a, b)',
      '  end',
      '',
      '  defimpl Comp, for: Integer do',
      '    def cmp(a, b), do: a - b',
      '  end',
      'end',
      '',
      'defmodule App.MyError do',
      '  defexception [:message]',
      'end',
    ].join('\n');

    const result = elixirExtractor.parse(FILE, src);

    const classes = result.nodes.filter((n) => n.kind === 'class');
    const classMacros = classes.map((c) => c.metadata?.macro).sort();
    expect(classMacros).toEqual([
      'defexception',
      'defimpl',
      'defprotocol',
      'defstruct',
    ]);

    // defstruct uses the enclosing module name.
    const structNode = classes.find((c) => c.metadata?.macro === 'defstruct');
    expect(structNode?.name).toBe('App.User');

    // defimpl emits an extends edge to the implemented protocol.
    const extendsEdges = result.edges.filter((e) => e.type === 'extends');
    expect(extendsEdges.some((e) => e.to === 'Comp')).toBe(true);
  });

  it('records calls inside function bodies as call nodes and calls edges', () => {
    const src = [
      'defmodule App do',
      '  def run(x) do',
      '    Bar.helper(x)',
      '    helper2()',
      '    :ok',
      '  end',
      '',
      '  defp helper2, do: nil',
      'end',
    ].join('\n');

    const result = elixirExtractor.parse(FILE, src);

    const callNodes = result.nodes.filter((n) => n.kind === 'call');
    const callNames = callNodes.map((c) => c.name);
    expect(callNames).toContain('Bar.helper');
    expect(callNames).toContain('helper2');

    const callEdges = result.edges.filter((e) => e.type === 'calls');
    expect(callEdges.every((e) => e.from === 'App.run')).toBe(true);
    expect(callEdges.some((e) => e.to === 'Bar.helper')).toBe(true);
    expect(callEdges.some((e) => e.to === 'helper2')).toBe(true);
  });

  it('does not record definition macros as calls', () => {
    const src = [
      'defmodule App do',
      '  def outer do',
      '    inner()',
      '  end',
      'end',
    ].join('\n');

    const result = elixirExtractor.parse(FILE, src);
    const callNames = result.nodes
      .filter((n) => n.kind === 'call')
      .map((c) => c.name);
    expect(callNames).not.toContain('def');
    expect(callNames).not.toContain('defmodule');
    expect(callNames).toContain('inner');
  });

  it('handles .exs scripts without a defmodule', () => {
    const src = ['IO.puts("hello")', ':ok'].join('\n');

    const result = elixirExtractor.parse('scripts/run.exs', src);

    expect(result.parseErrors).toEqual([]);
    const mod = result.nodes.find((n) => n.kind === 'module');
    expect(mod).toBeDefined();
    expect(mod?.name).toBe('scripts/run.exs');
  });

  it('captures syntax errors in parseErrors without throwing', () => {
    const src = 'defmodule Broken do\n  def oops(\nend\n';
    const result = elixirExtractor.parse(FILE, src);
    expect(result.parseErrors.length).toBeGreaterThan(0);
    expect(result.nodes.find((n) => n.kind === 'module')).toBeDefined();
  });
});
