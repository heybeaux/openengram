/**
 * Tests for the subsystem-detection orchestrator (EC-25).
 *
 * All LLM calls are stubbed. The Prisma surface is hand-rolled.
 */

import type { StructureEdge, StructureNode } from '../../parsers/types';
import type { LLMClient } from '../../llm/openrouter';

import {
  buildModuleNodes,
  EC_DAILY_TOKEN_CAP_ENV,
  persistSubsystemPass,
  renderSubsystemMarkdown,
  resolveRunTokenCap,
  runSubsystemPass,
  SUBSYSTEM_DEFAULT_RUN_TOKEN_CAP,
  type SubsystemPersistClient,
} from './orchestrator';
import type { ModuleNode } from './detector';

function node(filePath: string, name = filePath): StructureNode {
  return { kind: 'module', name, filePath, startLine: 1, endLine: 1 };
}

function imp(from: string, to: string): StructureEdge {
  return { from, to, type: 'imports' };
}

/** Predictable LLM stub — names each cluster `Cluster N`-style. */
const stableLLM: LLMClient = async (req) => {
  const match = req.prompt.match(/Cluster #(\d+)/);
  const clusterId = match ? match[1] : 'X';
  return {
    model: req.model,
    content: JSON.stringify({
      name: `Cluster ${clusterId} Subsys`,
      description: `Owns cluster ${clusterId}.`,
    }),
    totalTokens: 100,
  };
};

describe('buildModuleNodes', () => {
  it('collects unique module paths from the structure nodes', () => {
    const nodes: StructureNode[] = [
      node('src/a/x.ts'),
      node('src/a/y.ts'),
      node('src/b/z.ts'),
    ];
    const out = buildModuleNodes(nodes);
    expect(out.map((m) => m.modulePath)).toEqual(['src/a', 'src/b']);
  });

  it('threads intent + embedding + topFiles via resolvers', () => {
    const nodes: StructureNode[] = [node('src/a/x.ts')];
    const out = buildModuleNodes(
      nodes,
      (p) => (p === 'src/a' ? 'auth module' : undefined),
      (p) => (p === 'src/a' ? [1, 2, 3] : null),
      (p) => (p === 'src/a' ? ['src/a/x.ts'] : undefined),
    );
    expect(out[0]).toEqual({
      modulePath: 'src/a',
      intent: 'auth module',
      embedding: [1, 2, 3],
      topFiles: ['src/a/x.ts'],
    });
  });
});

describe('runSubsystemPass', () => {
  it('detects clusters, names them via the LLM, and emits cards + subsystems', async () => {
    const structureNodes: StructureNode[] = [
      node('src/a/x.ts'),
      node('src/a/y.ts'),
      node('src/b/z.ts'),
      node('src/b/w.ts'),
    ];
    const structureEdges: StructureEdge[] = [
      imp('src/a/x.ts', 'src/a/y.ts'), // intra — dropped
      imp('src/a/x.ts', 'src/b/z.ts'),
      imp('src/b/z.ts', 'src/b/w.ts'),
    ];
    const moduleNodes: ModuleNode[] = [
      { modulePath: 'src/a', intent: 'a stuff', topFiles: ['src/a/x.ts'] },
      { modulePath: 'src/b', intent: 'b stuff', topFiles: ['src/b/z.ts'] },
    ];

    const result = await runSubsystemPass(
      'repo-1',
      structureNodes,
      structureEdges,
      moduleNodes,
      { llm: stableLLM, quietWarnings: true },
    );

    expect(result.repoId).toBe('repo-1');
    expect(result.subsystems.length).toBeGreaterThan(0);
    expect(result.cards.length).toBe(result.subsystems.length);

    for (const sub of result.subsystems) {
      expect(sub.name).toMatch(/^Cluster \d+ Subsys$/);
      expect(sub.slug).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
      expect(sub.memberModulePaths.length).toBeGreaterThan(0);
    }

    for (const card of result.cards) {
      expect(card.level).toBe('SUBSYSTEM');
      expect(card.lod).toBe('STANDARD');
      expect(card.sourcePass).toBe('subsystem');
      expect(card.conceptPath).toMatch(/^repo-1\/subsystems\//);
      expect(card.content).toContain('## Subsystem:');
    }

    expect(result.passRun.status).toBe('SUCCESS');
    expect(result.passRun.passName).toBe('subsystem');
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it('falls back to a deterministic name when the LLM returns garbage', async () => {
    const garbage: LLMClient = async () => ({
      model: 'm',
      content: 'NOT JSON',
      totalTokens: 10,
    });
    const result = await runSubsystemPass(
      'r',
      [node('src/auth/x.ts'), node('src/auth/y.ts')],
      [],
      [{ modulePath: 'src/auth' }],
      { llm: garbage, quietWarnings: true },
    );
    expect(result.subsystems).toHaveLength(1);
    const sub = result.subsystems[0];
    expect(sub.name).toContain('Auth');
    const clusterResult = result.clusters[0];
    expect(clusterResult.nameFallback).toBe(true);
  });

  it('records llm-error per cluster without aborting the pass', async () => {
    let calls = 0;
    const flaky: LLMClient = async (req) => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return stableLLM(req);
    };

    const nodes: StructureNode[] = [
      node('src/a/x.ts'),
      node('src/b/y.ts'),
    ];
    // No edges → each module its own cluster, two LLM calls total.
    const result = await runSubsystemPass(
      'r',
      nodes,
      [],
      [{ modulePath: 'src/a' }, { modulePath: 'src/b' }],
      { llm: flaky, quietWarnings: true },
    );

    const errored = result.clusters.find((c) => c.skipReason === 'llm-error');
    expect(errored).toBeDefined();
    expect(errored?.errorMessage).toBe('boom');
    expect(result.subsystems.length).toBeGreaterThan(0);
    expect(result.passRun.status).toBe('SUCCESS');
  });

  it('marks pass FAILED when every cluster errors and nothing is emitted', async () => {
    const dead: LLMClient = async () => {
      throw new Error('nope');
    };
    const result = await runSubsystemPass(
      'r',
      [node('src/only/x.ts')],
      [],
      [{ modulePath: 'src/only' }],
      { llm: dead, quietWarnings: true },
    );
    expect(result.subsystems).toHaveLength(0);
    expect(result.passRun.status).toBe('FAILED');
    expect(result.passRun.errorMessage).toContain('failed naming');
  });

  it('falls back to deterministic naming once runTokenCap is exhausted', async () => {
    const nodes: StructureNode[] = [
      node('src/a/x.ts'),
      node('src/b/y.ts'),
      node('src/c/z.ts'),
    ];
    const moduleNodes: ModuleNode[] = [
      { modulePath: 'src/a' },
      { modulePath: 'src/b' },
      { modulePath: 'src/c' },
    ];

    const result = await runSubsystemPass('r', nodes, [], moduleNodes, {
      llm: stableLLM,
      runTokenCap: 50, // first call returns 100 tokens, exhausts budget
      quietWarnings: true,
    });

    // First cluster names via LLM; remaining clusters fall back.
    const fallbacks = result.clusters.filter((c) => c.nameFallback);
    expect(fallbacks.length).toBeGreaterThan(0);
    expect(result.subsystems.length).toBe(result.clusters.length);
  });

  it('warns and proceeds when no intent embeddings are available', async () => {
    const warnings: Array<{ message: string; context?: Record<string, unknown> }> = [];
    await runSubsystemPass(
      'r',
      [node('src/a/x.ts')],
      [],
      [{ modulePath: 'src/a' }], // no embeddings
      {
        llm: stableLLM,
        onWarning: (message, context) => warnings.push({ message, context }),
      },
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].message).toContain('intent-similarity');
    expect(warnings[0].context?.reason).toBe('fewer-than-two-embeddings');
  });

  it('passes intent + top files into the LLM prompt', async () => {
    let capturedPrompt = '';
    const llm: LLMClient = async (req) => {
      capturedPrompt = req.prompt;
      return stableLLM(req);
    };
    await runSubsystemPass(
      'r',
      [node('src/auth/login.ts')],
      [],
      [
        {
          modulePath: 'src/auth',
          intent: 'Owns user login.',
          topFiles: ['src/auth/login.ts'],
        },
      ],
      { llm, quietWarnings: true },
    );
    expect(capturedPrompt).toContain('Owns user login');
    expect(capturedPrompt).toContain('src/auth/login.ts');
  });
});

describe('resolveRunTokenCap', () => {
  const originalEnv = process.env[EC_DAILY_TOKEN_CAP_ENV];

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[EC_DAILY_TOKEN_CAP_ENV];
    else process.env[EC_DAILY_TOKEN_CAP_ENV] = originalEnv;
  });

  it('returns the default when the env var is unset', () => {
    delete process.env[EC_DAILY_TOKEN_CAP_ENV];
    expect(resolveRunTokenCap()).toBe(SUBSYSTEM_DEFAULT_RUN_TOKEN_CAP);
  });

  it('honours a valid env override', () => {
    process.env[EC_DAILY_TOKEN_CAP_ENV] = '12345';
    expect(resolveRunTokenCap()).toBe(12345);
  });

  it('falls back to the default for a non-numeric env value', () => {
    process.env[EC_DAILY_TOKEN_CAP_ENV] = 'oops';
    expect(resolveRunTokenCap()).toBe(SUBSYSTEM_DEFAULT_RUN_TOKEN_CAP);
  });
});

describe('renderSubsystemMarkdown', () => {
  it('includes name, slug, member count, and per-member intent summary', () => {
    const md = renderSubsystemMarkdown(
      {
        repoId: 'r',
        name: 'Auth',
        slug: 'auth',
        description: 'Handles login.',
        memberModulePaths: ['src/auth', 'src/session'],
      },
      [
        { modulePath: 'src/auth', intent: 'Login + tokens.' },
        { modulePath: 'src/session', intent: 'Session state.' },
      ],
    );
    expect(md).toContain('## Subsystem: Auth');
    expect(md).toContain('slug: `auth`');
    expect(md).toContain('modules: 2');
    expect(md).toContain('Handles login.');
    expect(md).toContain('`src/auth`');
    expect(md).toContain('Login + tokens.');
  });

  it('emits a no-intent placeholder when a member has none', () => {
    const md = renderSubsystemMarkdown(
      {
        repoId: 'r',
        name: 'Foo',
        slug: 'foo',
        memberModulePaths: ['src/x'],
      },
      [{ modulePath: 'src/x' }],
    );
    expect(md).toContain('(no intent recorded)');
  });
});

// ---------------------------------------------------------------------------
// persistSubsystemPass
// ---------------------------------------------------------------------------

interface Call {
  op: string;
  args: unknown;
}

function makeMockClient(): { client: SubsystemPersistClient; calls: Call[] } {
  const calls: Call[] = [];

  const subsystem = {
    upsert: jest.fn(async (args: unknown) => {
      calls.push({ op: 'subsystem.upsert', args });
      return {};
    }),
  };

  const card = {
    upsert: jest.fn(async (args: unknown) => {
      calls.push({ op: 'card.upsert', args });
      return {};
    }),
  };

  const tx = { subsystem, card } as unknown as SubsystemPersistClient;
  const $transaction = jest.fn(
    async (fn: (tx: SubsystemPersistClient) => Promise<unknown>) => fn(tx),
  );

  const client = {
    subsystem,
    card,
    $transaction,
  } as unknown as SubsystemPersistClient;

  return { client, calls };
}

describe('persistSubsystemPass', () => {
  it('upserts each subsystem and card inside a single transaction', async () => {
    const { client, calls } = makeMockClient();
    await persistSubsystemPass(
      client,
      [
        {
          repoId: 'r',
          name: 'Auth',
          slug: 'auth',
          memberModulePaths: ['src/auth'],
        },
      ],
      [
        {
          repoId: 'r',
          conceptPath: 'r/subsystems/auth',
          lod: 'STANDARD',
          level: 'SUBSYSTEM',
          content: '# Auth',
          sourcePass: 'subsystem',
        },
      ],
    );

    expect((client.$transaction as jest.Mock).mock.calls).toHaveLength(1);
    const ops = calls.map((c) => c.op);
    expect(ops).toContain('subsystem.upsert');
    expect(ops).toContain('card.upsert');

    const subUpsert = calls.find((c) => c.op === 'subsystem.upsert')!;
    expect(subUpsert.args).toMatchObject({
      where: { repoId_slug: { repoId: 'r', slug: 'auth' } },
      create: { repoId: 'r', name: 'Auth', slug: 'auth' },
    });

    const cardUpsert = calls.find((c) => c.op === 'card.upsert')!;
    expect(cardUpsert.args).toMatchObject({
      where: {
        repoId_conceptPath_lod: {
          repoId: 'r',
          conceptPath: 'r/subsystems/auth',
          lod: 'STANDARD',
        },
      },
    });
  });

  it('returns counts of upserted rows', async () => {
    const { client } = makeMockClient();
    const stats = await persistSubsystemPass(
      client,
      [
        { repoId: 'r', name: 'A', slug: 'aaa', memberModulePaths: [] },
        { repoId: 'r', name: 'B', slug: 'bbb', memberModulePaths: [] },
      ],
      [
        {
          repoId: 'r',
          conceptPath: 'r/subsystems/aaa',
          lod: 'STANDARD',
          level: 'SUBSYSTEM',
          content: 'x',
          sourcePass: 'subsystem',
        },
      ],
    );
    expect(stats.subsystemsUpserted).toBe(2);
    expect(stats.cardsUpserted).toBe(1);
  });

  it('throws when a subsystem has an invalid slug', async () => {
    const { client } = makeMockClient();
    await expect(
      persistSubsystemPass(
        client,
        [{ repoId: 'r', name: 'X', slug: '', memberModulePaths: [] }],
        [],
      ),
    ).rejects.toThrow(/invalid slug/);
  });
});
