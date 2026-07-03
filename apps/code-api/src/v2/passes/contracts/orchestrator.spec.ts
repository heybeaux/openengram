/**
 * Tests for the contracts pass orchestrator (EC-23).
 *
 * All LLM calls are stubbed.
 */

import type { LLMClient } from '../../llm/openrouter';
import type { ContractModuleSymbols } from './extractor';
import {
  renderContractsMarkdown,
  runContractsPass,
} from './orchestrator';

function moduleBundle(
  modulePath: string,
  names: string[],
): ContractModuleSymbols {
  return {
    modulePath,
    language: 'typescript',
    symbols: names.map((n) => ({
      name: n,
      kind: 'function' as const,
      filePath: `${modulePath}/x.ts`,
      startLine: 1,
      signature: `export function ${n}(): void`,
      language: 'typescript',
    })),
  };
}

const llmStable: LLMClient = async (req) => {
  // Build a response that annotates every symbol in the prompt.
  const matches = [...req.prompt.matchAll(/`([A-Za-z_][\w]*)` \(/g)].map((m) => m[1]);
  const body: Record<string, { description: string; stability: string }> = {};
  for (const name of matches) {
    body[name] = { description: `Does ${name}.`, stability: 'stable' };
  }
  return {
    model: req.model,
    content: JSON.stringify(body),
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
  };
};

describe('runContractsPass', () => {
  it('annotates symbols and emits a card per module', async () => {
    const modules = [moduleBundle('src/a', ['foo', 'bar']), moduleBundle('src/b', ['baz'])];
    const result = await runContractsPass('repo-1', modules, { llm: llmStable });

    expect(result.modules).toHaveLength(2);
    expect(result.modules.every((m) => m.card !== null)).toBe(true);
    expect(result.totalTokens).toBe(300);
    expect(result.passRun.status).toBe('SUCCESS');

    const aMod = result.modules.find((m) => m.modulePath === 'src/a')!;
    expect(aMod.symbols.map((s) => s.description).every((d) => d.startsWith('Does '))).toBe(true);
    expect(aMod.card!.sourcePass).toBe('contracts');
    expect(aMod.card!.level).toBe('MODULE');
    expect(aMod.card!.content).toContain('| `foo` | function |');
  });

  it('skips modules with zero symbols', async () => {
    const modules: ContractModuleSymbols[] = [
      { modulePath: 'src/empty', language: 'typescript', symbols: [] },
    ];
    const result = await runContractsPass('r', modules, { llm: llmStable });
    expect(result.modules[0].skipReason).toBe('no-symbols');
    expect(result.totalTokens).toBe(0);
  });

  it('honours runTokenCap and marks remaining modules budget-exceeded', async () => {
    const modules = [
      moduleBundle('src/m1', ['a']),
      moduleBundle('src/m2', ['b']),
      moduleBundle('src/m3', ['c']),
    ];
    const result = await runContractsPass('r', modules, {
      llm: llmStable,
      runTokenCap: 200,
    });
    const succeeded = result.modules.filter((m) => m.card !== null);
    const skipped = result.modules.filter((m) => m.skipReason === 'budget-exceeded');
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    expect(skipped.length).toBeGreaterThanOrEqual(1);
  });

  it('records llm-error per module without aborting the run', async () => {
    const modules = [moduleBundle('src/a', ['a']), moduleBundle('src/b', ['b'])];
    let calls = 0;
    const llm: LLMClient = async (req) => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return llmStable(req);
    };
    const result = await runContractsPass('r', modules, { llm });
    expect(result.modules[0].skipReason).toBe('llm-error');
    expect(result.modules[0].errorMessage).toBe('boom');
    expect(result.modules[1].card).not.toBeNull();
    expect(result.passRun.status).toBe('SUCCESS');
  });

  it('marks pass FAILED when every module errors', async () => {
    const modules = [moduleBundle('src/only', ['x'])];
    const llm: LLMClient = async () => {
      throw new Error('nope');
    };
    const result = await runContractsPass('r', modules, { llm });
    expect(result.passRun.status).toBe('FAILED');
  });

  it('defaults stability to "stable" for symbols missing from the LLM response', async () => {
    const modules = [moduleBundle('src/a', ['known', 'missing'])];
    const partial: LLMClient = async () => ({
      model: 'm',
      content: JSON.stringify({ known: { description: 'k', stability: 'experimental' } }),
      totalTokens: 50,
    });
    const result = await runContractsPass('r', modules, { llm: partial });
    const annotated = result.modules[0].symbols;
    const missing = annotated.find((s) => s.name === 'missing')!;
    expect(missing.description).toBe('');
    expect(missing.stability).toBe('stable');
  });

  it('passes intent context to the prompt builder when resolver provided', async () => {
    const modules = [moduleBundle('src/a', ['foo'])];
    let seenPrompt = '';
    const llm: LLMClient = async (req) => {
      seenPrompt = req.prompt;
      return llmStable(req);
    };
    await runContractsPass('r', modules, {
      llm,
      resolveIntent: (p) => (p === 'src/a' ? 'auth module' : undefined),
    });
    expect(seenPrompt).toContain('auth module');
  });
});

describe('renderContractsMarkdown', () => {
  it('renders a table with one row per symbol', () => {
    const md = renderContractsMarkdown('src/a', [
      {
        name: 'foo',
        kind: 'function',
        signature: 'export function foo(): void',
        filePath: 'src/a/x.ts',
        startLine: 1,
        description: 'Does foo.',
        stability: 'stable',
      },
    ]);
    expect(md).toContain('## Contracts: src/a');
    expect(md).toContain('| `foo` | function |');
    expect(md).toContain('Does foo.');
    expect(md).toContain('stable |');
  });

  it('emits `(no exports)` when the symbol list is empty', () => {
    const md = renderContractsMarkdown('src/a', []);
    expect(md).toContain('(no exports)');
  });

  it('escapes pipe characters in cell content', () => {
    const md = renderContractsMarkdown('src/a', [
      {
        name: 'foo',
        kind: 'function',
        signature: 'export function foo(): A | B',
        filePath: 'src/a/x.ts',
        startLine: 1,
        description: 'left | right',
        stability: 'stable',
      },
    ]);
    expect(md).toContain('A \\| B');
    expect(md).toContain('left \\| right');
  });
});
