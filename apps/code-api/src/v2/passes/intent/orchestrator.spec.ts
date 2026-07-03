/**
 * Tests for the intent pass orchestrator (EC-22).
 *
 * All LLM calls are stubbed. No filesystem, no network.
 */

import type { StructureEdge, StructureNode } from '../../parsers/types';
import type { LLMClient } from '../../llm/openrouter';
import {
  buildModulesFromStructure,
  groupNodesByModule,
  runIntentPass,
} from './orchestrator';

function node(name: string, filePath: string, kind: StructureNode['kind'] = 'function'): StructureNode {
  return { kind, name, filePath, startLine: 1, endLine: 10 };
}

describe('groupNodesByModule', () => {
  it('groups nodes by their directory', () => {
    const nodes: StructureNode[] = [
      node('foo', 'src/auth/login.ts'),
      node('bar', 'src/auth/logout.ts'),
      node('baz', 'src/billing/charge.ts'),
    ];
    const grouped = groupNodesByModule(nodes, []);
    expect([...grouped.keys()].sort()).toEqual(['src/auth', 'src/billing']);
    expect(grouped.get('src/auth')!.nodes.map((n) => n.name).sort()).toEqual(['bar', 'foo']);
    expect(grouped.get('src/billing')!.nodes.map((n) => n.name)).toEqual(['baz']);
  });

  it('attributes edges by matching the from-name to a module member', () => {
    const nodes: StructureNode[] = [
      node('login', 'src/auth/login.ts'),
      node('charge', 'src/billing/charge.ts'),
    ];
    const edges: StructureEdge[] = [
      { from: 'login', to: 'charge', type: 'calls' },
      { from: 'unknown', to: 'whatever', type: 'imports' },
    ];
    const grouped = groupNodesByModule(nodes, edges);
    expect(grouped.get('src/auth')!.edges).toHaveLength(1);
    expect(grouped.get('src/billing')!.edges).toHaveLength(0);
  });
});

describe('buildModulesFromStructure', () => {
  it('returns modules ordered alphabetically with resolved source', () => {
    const nodes = [node('foo', 'src/auth/login.ts'), node('bar', 'src/billing/charge.ts')];
    const modules = buildModulesFromStructure(
      nodes,
      [],
      'typescript',
      (p) => `// source of ${p}`,
    );
    expect(modules.map((m) => m.modulePath)).toEqual(['src/auth', 'src/billing']);
    expect(modules[0].files[0].source).toContain('login.ts');
  });
});

describe('runIntentPass', () => {
  const llmOk: LLMClient = async (req) => ({
    model: req.model,
    content: `## Intent for prompt of size ${req.prompt.length}`,
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
  });

  it('calls the LLM once per module and emits a card per success', async () => {
    const modules = [
      {
        modulePath: 'src/auth',
        structure: {
          nodes: [node('login', 'src/auth/login.ts')],
          edges: [],
          language: 'typescript',
        },
        files: [{ path: 'src/auth/login.ts', source: 'export function login(){}' }],
      },
      {
        modulePath: 'src/billing',
        structure: {
          nodes: [node('charge', 'src/billing/charge.ts')],
          edges: [],
          language: 'typescript',
        },
        files: [{ path: 'src/billing/charge.ts', source: 'export function charge(){}' }],
      },
    ];

    const calls: number[] = [];
    const llm: LLMClient = async (req) => {
      calls.push(req.prompt.length);
      return llmOk(req);
    };

    const result = await runIntentPass('repo-1', modules, { llm });
    expect(calls).toHaveLength(2);
    expect(result.modules.every((m) => m.card !== null)).toBe(true);
    expect(result.totalTokens).toBe(300);
    expect(result.passRun.status).toBe('SUCCESS');
    expect(result.modules[0].card!.sourcePass).toBe('intent');
    expect(result.modules[0].card!.level).toBe('MODULE');
  });

  it('skips modules with no source', async () => {
    const modules = [
      {
        modulePath: 'src/empty',
        structure: { nodes: [node('x', 'src/empty/x.ts')], edges: [], language: 'typescript' },
        files: [{ path: 'src/empty/x.ts' }],
      },
    ];
    const result = await runIntentPass('r', modules, { llm: llmOk });
    expect(result.modules[0].intent).toBeNull();
    expect(result.modules[0].skipReason).toBe('no-source');
    expect(result.totalTokens).toBe(0);
  });

  it('respects runTokenCap and skips remaining modules with budget-exceeded', async () => {
    const modules = [1, 2, 3].map((i) => ({
      modulePath: `src/mod${i}`,
      structure: {
        nodes: [node(`fn${i}`, `src/mod${i}/file.ts`)],
        edges: [],
        language: 'typescript',
      },
      files: [{ path: `src/mod${i}/file.ts`, source: `export const x = ${i}` }],
    }));

    const result = await runIntentPass('r', modules, {
      llm: llmOk,
      runTokenCap: 200, // first call returns 150; second sees totalTokens=150 < 200, runs; third skipped.
    });

    const skipped = result.modules.filter((m) => m.skipReason === 'budget-exceeded');
    const succeeded = result.modules.filter((m) => m.intent !== null);
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    expect(skipped.length).toBeGreaterThanOrEqual(1);
  });

  it('records llm-error per module without aborting the run', async () => {
    const modules = [
      {
        modulePath: 'src/a',
        structure: { nodes: [node('a', 'src/a/x.ts')], edges: [], language: 'ts' },
        files: [{ path: 'src/a/x.ts', source: 'x' }],
      },
      {
        modulePath: 'src/b',
        structure: { nodes: [node('b', 'src/b/y.ts')], edges: [], language: 'ts' },
        files: [{ path: 'src/b/y.ts', source: 'y' }],
      },
    ];
    let calls = 0;
    const llm: LLMClient = async (req) => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return llmOk(req);
    };
    const result = await runIntentPass('r', modules, { llm });
    expect(result.modules[0].skipReason).toBe('llm-error');
    expect(result.modules[0].errorMessage).toBe('boom');
    expect(result.modules[1].intent).not.toBeNull();
    expect(result.passRun.status).toBe('SUCCESS'); // 1/2 succeeded
  });

  it('marks pass FAILED when every module errors', async () => {
    const modules = [
      {
        modulePath: 'src/only',
        structure: { nodes: [node('z', 'src/only/z.ts')], edges: [], language: 'ts' },
        files: [{ path: 'src/only/z.ts', source: 'z' }],
      },
    ];
    const llm: LLMClient = async () => {
      throw new Error('nope');
    };
    const result = await runIntentPass('r', modules, { llm });
    expect(result.passRun.status).toBe('FAILED');
  });
});
