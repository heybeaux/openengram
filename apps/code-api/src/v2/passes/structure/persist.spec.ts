/**
 * Unit tests for the structure-pass persistence layer.
 *
 * We don't stand up a real Prisma client; instead, a hand-rolled mock
 * captures every call so we can assert ordering, payload shape, and
 * idempotency semantics without a database.
 */

import type { StructurePassResult } from './orchestrator';
import {
  conceptPathFor,
  persistStructurePass,
  type StructurePersistClient,
} from './persist';

/**
 * Records every interaction with the mock client so tests can assert the
 * sequence (deleteMany then createMany then upserts) and the payloads.
 */
interface Call {
  op: string;
  args: unknown;
}

function makeMockClient(): {
  client: StructurePersistClient;
  calls: Call[];
} {
  const calls: Call[] = [];

  const graphEdge = {
    deleteMany: jest.fn(async (args: unknown) => {
      calls.push({ op: 'graphEdge.deleteMany', args });
      return { count: 0 };
    }),
    createMany: jest.fn(async (args: unknown) => {
      calls.push({ op: 'graphEdge.createMany', args });
      const data = (args as { data: unknown[] }).data;
      return { count: data.length };
    }),
  };

  const card = {
    upsert: jest.fn(async (args: unknown) => {
      calls.push({ op: 'card.upsert', args });
      return {};
    }),
  };

  const tx = { card, graphEdge } as unknown as StructurePersistClient;

  const $transaction = jest.fn(async (fn: (tx: StructurePersistClient) => Promise<unknown>) => {
    return fn(tx);
  });

  const client = {
    card,
    graphEdge,
    $transaction,
  } as unknown as StructurePersistClient;

  return { client, calls };
}

function fixtureResult(overrides: Partial<StructurePassResult> = {}): StructurePassResult {
  return {
    repoId: 'repo-xyz',
    repoPath: '/tmp/repo-xyz',
    nodes: [
      {
        kind: 'function',
        name: 'svc',
        filePath: 'src/service.py',
        startLine: 1,
        endLine: 2,
      },
      {
        kind: 'method',
        name: 'run',
        filePath: 'src/service.py',
        startLine: 5,
        endLine: 10,
        parent: 'Worker',
      },
    ],
    edges: [
      { from: 'src/service.py', to: 'svc', type: 'contains' },
      { from: 'src/service.py', to: 'os', type: 'imports' },
      { from: 'svc', to: 'os.environ.get', type: 'calls' },
    ],
    filesWalked: 1,
    filesParsed: 1,
    fileErrors: [],
    ...overrides,
  };
}

describe('persistStructurePass', () => {
  it('replaces all graph edges for the repo before inserting new ones', async () => {
    const { client, calls } = makeMockClient();
    await persistStructurePass(client, fixtureResult());

    const delIdx = calls.findIndex((c) => c.op === 'graphEdge.deleteMany');
    const createIdx = calls.findIndex((c) => c.op === 'graphEdge.createMany');

    expect(delIdx).toBeGreaterThanOrEqual(0);
    expect(createIdx).toBeGreaterThan(delIdx);

    expect(calls[delIdx].args).toEqual({ where: { repoId: 'repo-xyz' } });
  });

  it('inserts one graph_edges row per structure edge with mapped enum values', async () => {
    const { client, calls } = makeMockClient();
    const stats = await persistStructurePass(client, fixtureResult());

    const createCall = calls.find((c) => c.op === 'graphEdge.createMany');
    expect(createCall).toBeDefined();
    const rows = (createCall!.args as { data: Array<{ edgeType: string }> }).data;

    expect(stats.edgesReplaced).toBe(3);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.edgeType).sort()).toEqual(['CALLS', 'CONTAINS', 'IMPORTS']);
    for (const row of rows) {
      expect(row).toMatchObject({ repoId: 'repo-xyz' });
    }
  });

  it('skips createMany entirely when there are no edges', async () => {
    const { client, calls } = makeMockClient();
    await persistStructurePass(
      client,
      fixtureResult({ edges: [] }),
    );

    expect(calls.find((c) => c.op === 'graphEdge.createMany')).toBeUndefined();
    expect(calls.find((c) => c.op === 'graphEdge.deleteMany')).toBeDefined();
  });

  it('upserts one INDEX card per node using the conceptPath/lod unique key', async () => {
    const { client, calls } = makeMockClient();
    const stats = await persistStructurePass(client, fixtureResult());

    const upserts = calls.filter((c) => c.op === 'card.upsert');
    expect(upserts).toHaveLength(2);
    expect(stats.cardsUpserted).toBe(2);

    for (const u of upserts) {
      const args = u.args as {
        where: { repoId_conceptPath_lod: { repoId: string; lod: string } };
        create: { lod: string };
        update: { content: string };
      };
      expect(args.where.repoId_conceptPath_lod.repoId).toBe('repo-xyz');
      expect(args.where.repoId_conceptPath_lod.lod).toBe('INDEX');
      expect(args.create.lod).toBe('INDEX');
      expect(typeof args.update.content).toBe('string');
    }
  });

  it('builds stable conceptPaths that include kind and parent', () => {
    const fn = conceptPathFor({
      kind: 'function',
      name: 'svc',
      filePath: 'src/service.py',
      startLine: 1,
      endLine: 2,
    });
    expect(fn).toBe('src/service.py#svc:function');

    const method = conceptPathFor({
      kind: 'method',
      name: 'run',
      filePath: 'src/service.py',
      startLine: 5,
      endLine: 10,
      parent: 'Worker',
    });
    expect(method).toBe('src/service.py#Worker::run:method');

    // Different kinds for the same name must yield different paths so they
    // don't collide on the cards unique key.
    const ifaceFoo = conceptPathFor({
      kind: 'interface',
      name: 'Foo',
      filePath: 'src/foo.ts',
      startLine: 1,
      endLine: 1,
    });
    const classFoo = conceptPathFor({
      kind: 'class',
      name: 'Foo',
      filePath: 'src/foo.ts',
      startLine: 1,
      endLine: 1,
    });
    expect(ifaceFoo).not.toBe(classFoo);
  });

  it('runs all writes inside a single $transaction', async () => {
    const { client } = makeMockClient();
    await persistStructurePass(client, fixtureResult());
    expect((client.$transaction as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('is idempotent: a second run produces the same write shape', async () => {
    const first = makeMockClient();
    await persistStructurePass(first.client, fixtureResult());

    const second = makeMockClient();
    await persistStructurePass(second.client, fixtureResult());

    // Same number of operations, same op ordering.
    expect(second.calls.map((c) => c.op)).toEqual(first.calls.map((c) => c.op));
  });
});
