/**
 * Tests for the Go language extractor.
 */

import { clear, getByExtension, getByLanguage } from './registry';
import { goExtractor, registerGoExtractor } from './go.extractor';

const FILE = 'pkg/sample.go';

describe('go extractor', () => {
  beforeEach(() => {
    clear();
    registerGoExtractor();
  });

  afterEach(() => {
    clear();
  });

  it('registers itself for .go and as language "go"', () => {
    expect(getByLanguage('go')).toBe(goExtractor);
    expect(getByExtension('.go')).toBe(goExtractor);
    expect(getByExtension('go')).toBe(goExtractor);
  });

  it('extracts a package module node spanning the file', () => {
    const src = `package main\n\nfunc main() {}\n`;
    const result = goExtractor.parse(FILE, src);

    expect(result.language).toBe('go');
    expect(result.parseErrors).toEqual([]);

    const mod = result.nodes.find((n) => n.kind === 'module');
    expect(mod).toBeDefined();
    expect(mod?.name).toBe('main');
    expect(mod?.filePath).toBe(FILE);
    expect(mod?.startLine).toBe(1);
  });

  it('extracts top-level function declarations with contains edges', () => {
    const src = [
      'package util',
      '',
      'func Add(a, b int) int { return a + b }',
      '',
      'func sub(a, b int) int { return a - b }',
    ].join('\n');

    const result = goExtractor.parse(FILE, src);

    const fns = result.nodes.filter((n) => n.kind === 'function');
    expect(fns.map((f) => f.name).sort()).toEqual(['Add', 'sub']);

    const addFn = fns.find((f) => f.name === 'Add');
    expect(addFn?.metadata).toMatchObject({ exported: true });

    const subFn = fns.find((f) => f.name === 'sub');
    expect(subFn?.metadata).toMatchObject({ exported: false });

    const containsEdges = result.edges.filter((e) => e.type === 'contains');
    expect(containsEdges.some((e) => e.to === 'Add')).toBe(true);
    expect(containsEdges.some((e) => e.to === 'sub')).toBe(true);
  });

  it('extracts method declarations with receiver type as parent', () => {
    const src = [
      'package svc',
      '',
      'type Server struct{}',
      '',
      'func (s *Server) Serve() {}',
      'func (s Server) String() string { return "" }',
    ].join('\n');

    const result = goExtractor.parse(FILE, src);

    const methods = result.nodes.filter((n) => n.kind === 'method');
    expect(methods.map((m) => m.name).sort()).toEqual(['Serve', 'String']);

    for (const m of methods) {
      expect(m.parent).toBe('Server');
      expect(m.metadata?.receiver).toBe('Server');
    }

    const containsEdges = result.edges.filter((e) => e.type === 'contains');
    expect(containsEdges.some((e) => e.to === 'Server.Serve')).toBe(true);
    expect(containsEdges.some((e) => e.to === 'Server.String')).toBe(true);
  });

  it('extracts struct type declarations as class nodes', () => {
    const src = [
      'package model',
      '',
      'type User struct {',
      '  Name string',
      '  Age  int',
      '}',
    ].join('\n');

    const result = goExtractor.parse(FILE, src);

    const cls = result.nodes.find((n) => n.kind === 'class');
    expect(cls).toBeDefined();
    expect(cls?.name).toBe('User');
    expect(cls?.metadata).toMatchObject({ exported: true });
  });

  it('extracts struct embedding as extends edges', () => {
    const src = [
      'package model',
      '',
      'type Base struct{ ID int }',
      '',
      'type Admin struct {',
      '  Base',
      '  Role string',
      '}',
    ].join('\n');

    const result = goExtractor.parse(FILE, src);

    const extendsEdges = result.edges.filter((e) => e.type === 'extends');
    expect(extendsEdges).toHaveLength(1);
    expect(extendsEdges[0]).toMatchObject({ from: 'Admin', to: 'Base' });
  });

  it('extracts interface declarations as interface nodes', () => {
    const src = [
      'package io',
      '',
      'type Reader interface {',
      '  Read(p []byte) (int, error)',
      '}',
    ].join('\n');

    const result = goExtractor.parse(FILE, src);

    const iface = result.nodes.find((n) => n.kind === 'interface');
    expect(iface).toBeDefined();
    expect(iface?.name).toBe('Reader');
  });

  it('extracts import declarations with imports edges', () => {
    const src = [
      'package main',
      '',
      'import (',
      '  "fmt"',
      '  "net/http"',
      ')',
      '',
      'func main() {}',
    ].join('\n');

    const result = goExtractor.parse(FILE, src);

    const imports = result.nodes.filter((n) => n.kind === 'import');
    expect(imports.map((i) => i.name).sort()).toEqual(['fmt', 'net/http']);

    const importEdges = result.edges.filter((e) => e.type === 'imports');
    expect(importEdges.some((e) => e.to === 'fmt')).toBe(true);
    expect(importEdges.some((e) => e.to === 'net/http')).toBe(true);
  });

  it('collects call expressions within functions as call nodes and calls edges', () => {
    const src = [
      'package main',
      '',
      'import "fmt"',
      '',
      'func greet(name string) {',
      '  fmt.Println(name)',
      '  helper()',
      '}',
      '',
      'func helper() {}',
    ].join('\n');

    const result = goExtractor.parse(FILE, src);

    const callNodes = result.nodes.filter((n) => n.kind === 'call');
    const callNames = callNodes.map((c) => c.name);
    expect(callNames).toContain('fmt.Println');
    expect(callNames).toContain('helper');

    const callEdges = result.edges.filter((e) => e.type === 'calls');
    expect(callEdges.every((e) => e.from === 'greet')).toBe(true);
  });

  it('captures syntax errors in parseErrors without throwing', () => {
    const src = 'package main\n\nfunc broken( {\n';
    const result = goExtractor.parse(FILE, src);
    expect(result.parseErrors.length).toBeGreaterThan(0);
    expect(result.nodes.find((n) => n.kind === 'module')).toBeDefined();
  });
});
