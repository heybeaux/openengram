/**
 * Tests for intent prompt assembly (EC-22).
 */

import type { StructureNode } from '../../parsers/types';
import { buildIntentPrompt, INTENT_SYSTEM_PROMPT } from './prompt';

function node(name: string, kind: StructureNode['kind'] = 'function'): StructureNode {
  return { kind, name, filePath: 'x.ts', startLine: 1, endLine: 1 };
}

describe('buildIntentPrompt', () => {
  it('includes module path, language, exported symbols, and the system prompt', () => {
    const out = buildIntentPrompt({
      modulePath: 'src/auth',
      structure: {
        nodes: [node('login'), node('Session', 'class')],
        edges: [],
        language: 'typescript',
      },
      files: [{ path: 'src/auth/login.ts', source: 'export function login(){}' }],
    });
    expect(out.system).toBe(INTENT_SYSTEM_PROMPT);
    expect(out.prompt).toContain('## Module: src/auth');
    expect(out.prompt).toContain('Language: `typescript`');
    expect(out.prompt).toContain('`login`');
    expect(out.prompt).toContain('`Session`');
    expect(out.prompt).toContain('export function login(){}');
    expect(out.truncated).toBe(false);
  });

  it('size-rank-sorts files (largest survives truncation)', () => {
    const tiny = 'a';
    const huge = 'x'.repeat(20_000);
    const out = buildIntentPrompt({
      modulePath: 'm',
      structure: { nodes: [], edges: [], language: 'ts' },
      files: [
        { path: 'tiny.ts', source: tiny },
        { path: 'huge.ts', source: huge },
      ],
      maxInputTokens: 1_500,
    });
    expect(out.prompt).toContain('huge.ts');
    expect(out.truncated).toBe(true);
  });

  it('truncates source when it exceeds the budget', () => {
    const out = buildIntentPrompt({
      modulePath: 'm',
      structure: { nodes: [], edges: [], language: 'ts' },
      files: [{ path: 'big.ts', source: 'y'.repeat(50_000) }],
      maxInputTokens: 1_000,
    });
    expect(out.truncated).toBe(true);
    // Prompt should be smaller than naive concat: total source is ~12.5k tokens,
    // budget is 1k.
    expect(out.estimatedTokens).toBeLessThan(2_000);
  });

  it('includes README content when provided', () => {
    const out = buildIntentPrompt({
      modulePath: 'm',
      structure: { nodes: [], edges: [], language: 'ts' },
      files: [{ path: 'a.ts', source: 'x' }],
      readme: 'This module exists because reasons.',
    });
    expect(out.prompt).toContain('This module exists because reasons.');
  });

  it('caps the symbol list at 30 entries with an overflow note', () => {
    const nodes = Array.from({ length: 40 }, (_, i) => node(`fn${i}`));
    const out = buildIntentPrompt({
      modulePath: 'm',
      structure: { nodes, edges: [], language: 'ts' },
      files: [{ path: 'a.ts', source: 'x' }],
    });
    expect(out.prompt).toContain('and 10 more');
  });

  it('marks "no source bundled" when no file has source', () => {
    const out = buildIntentPrompt({
      modulePath: 'm',
      structure: { nodes: [node('x')], edges: [], language: 'ts' },
      files: [{ path: 'a.ts' }],
    });
    expect(out.prompt).toContain('no source bundled');
  });
});
