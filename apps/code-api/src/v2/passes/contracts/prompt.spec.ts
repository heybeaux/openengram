/**
 * Tests for contracts prompt assembly + response parsing (EC-23).
 */

import type { ContractSymbol } from './extractor';
import {
  buildContractsPrompt,
  CONTRACT_STABILITIES,
  parseContractsResponse,
} from './prompt';

function sym(name: string, over: Partial<ContractSymbol> = {}): ContractSymbol {
  return {
    name,
    kind: 'function',
    filePath: 'src/x.ts',
    startLine: 1,
    signature: `export function ${name}(): void`,
    language: 'typescript',
    ...over,
  };
}

describe('buildContractsPrompt', () => {
  it('includes module path, language, and every symbol in the prompt', () => {
    const built = buildContractsPrompt({
      modulePath: 'src/auth',
      language: 'typescript',
      symbols: [sym('login'), sym('logout')],
    });
    expect(built.prompt).toContain('src/auth');
    expect(built.prompt).toContain('typescript');
    expect(built.prompt).toContain('`login`');
    expect(built.prompt).toContain('`logout`');
    expect(built.includedNames.sort()).toEqual(['login', 'logout']);
    expect(built.truncated).toBe(false);
  });

  it('mentions JSON output format in the system prompt', () => {
    const built = buildContractsPrompt({
      modulePath: 'src/x',
      language: 'typescript',
      symbols: [sym('a')],
    });
    expect(built.system).toMatch(/JSON/);
    expect(built.system).toMatch(/stable.*experimental.*internal/s);
  });

  it('marks truncated when the input budget is too tight', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      sym(`fn${i}`, { signature: 'export function x(arg: VeryLongTypeName): AnotherLongReturn' }),
    );
    const built = buildContractsPrompt({
      modulePath: 'src/big',
      language: 'typescript',
      symbols: many,
      maxInputTokens: 600,
    });
    expect(built.truncated).toBe(true);
    expect(built.includedNames.length).toBeLessThan(many.length);
    expect(built.includedNames.length).toBeGreaterThan(0);
  });

  it('includes intent context when provided', () => {
    const built = buildContractsPrompt({
      modulePath: 'src/x',
      language: 'typescript',
      symbols: [sym('a')],
      intent: 'This module handles auth and tokens.',
    });
    expect(built.prompt).toContain('Module intent');
    expect(built.prompt).toContain('handles auth');
  });
});

describe('parseContractsResponse', () => {
  it('parses a clean JSON object response', () => {
    const raw = JSON.stringify({
      login: { description: 'Authenticate a user.', stability: 'stable' },
      _internal: { description: 'helper', stability: 'internal' },
    });
    const { annotations, missing } = parseContractsResponse(raw, ['login', '_internal']);
    expect(annotations.get('login')?.description).toBe('Authenticate a user.');
    expect(annotations.get('_internal')?.stability).toBe('internal');
    expect(missing).toEqual([]);
  });

  it('tolerates markdown code fences around the JSON', () => {
    const raw = '```json\n{"foo":{"description":"x","stability":"stable"}}\n```';
    const { annotations } = parseContractsResponse(raw, ['foo']);
    expect(annotations.get('foo')?.description).toBe('x');
  });

  it('defaults bad stability values to "stable"', () => {
    const raw = '{"bar":{"description":"d","stability":"weird"}}';
    const { annotations } = parseContractsResponse(raw, ['bar']);
    expect(annotations.get('bar')?.stability).toBe('stable');
  });

  it('reports missing symbols', () => {
    const raw = '{"a":{"description":"x","stability":"stable"}}';
    const { missing } = parseContractsResponse(raw, ['a', 'b']);
    expect(missing).toEqual(['b']);
  });

  it('returns empty annotations on malformed JSON', () => {
    const { annotations, missing } = parseContractsResponse('not json at all', ['a']);
    expect(annotations.size).toBe(0);
    expect(missing).toEqual(['a']);
  });

  it('exposes all valid stability values', () => {
    expect([...CONTRACT_STABILITIES].sort()).toEqual([
      'experimental',
      'internal',
      'stable',
    ]);
  });
});
