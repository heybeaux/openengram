/**
 * Tests for incremental git-diff rescans (EC-46).
 *
 * Covers the acceptance matrix from the Linear ticket:
 *   1. hash is deterministic
 *   2. first-ever run → rerun (no prior SUCCESS row)
 *   3. no-changes → skip
 *   4. config change → rerun
 *   5. --full flag override → rerun
 *   6. partial-overlap → rerun
 *   7. hash stability under path-order permutation
 *   8. invalid sinceSha → throws
 *   9. shell-quote refuses non-ref input
 *  10. AffectedPathsCache shells git once per unique sinceSha
 */

import type { PassRun, Prisma } from '@prisma/client';

import {
  AffectedPathsCache,
  buildSkippedPassRun,
  computeAffectedPaths,
  computeConfigHash,
  computePassInputHash,
  InvalidSinceShaError,
  resolveHeadSha,
  resolveSinceSha,
  shouldRerunPass,
  SKIPPED_NO_CHANGES,
  type ExecFn,
  type IncrementalPrismaClient,
} from './incremental';
import type { PassRunPrismaClient } from '../passes/pass-run.repository';

interface FakeRow {
  repoId: string;
  passName: string;
  status: 'SUCCESS' | 'FAILED';
  inputHash: string | null;
  outputHash: string | null;
  startedAt: Date;
}

function makeFakePrisma(rows: FakeRow[] = []): IncrementalPrismaClient & {
  findFirstCalls: number;
  rows: FakeRow[];
} {
  let findFirstCalls = 0;
  const passRun = {
    findFirst: jest.fn(
      (args: { where?: Prisma.PassRunWhereInput; orderBy?: unknown }) => {
        findFirstCalls++;
        const where = args.where ?? {};
        let candidates = rows.slice();
        if (where.repoId !== undefined) {
          candidates = candidates.filter((r) => r.repoId === where.repoId);
        }
        if (where.passName !== undefined) {
          candidates = candidates.filter((r) => r.passName === where.passName);
        }
        if (where.status !== undefined) {
          candidates = candidates.filter((r) => r.status === where.status);
        }
        if (
          where.outputHash !== undefined &&
          typeof where.outputHash === 'object' &&
          where.outputHash !== null &&
          'not' in where.outputHash
        ) {
          candidates = candidates.filter((r) => r.outputHash !== null);
        }
        candidates.sort(
          (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
        );
        return Promise.resolve(
          (candidates[0] ?? null) as unknown as PassRun | null,
        );
      },
    ),
    create: jest.fn(),
    findMany: jest.fn(),
  };
  const client = { passRun } as unknown as IncrementalPrismaClient & {
    findFirstCalls: number;
    rows: FakeRow[];
  };
  Object.defineProperty(client, 'rows', { get: () => rows });
  Object.defineProperty(client, 'findFirstCalls', {
    get: () => findFirstCalls,
  });
  return client;
}

describe('computePassInputHash', () => {
  it('is deterministic for identical inputs', () => {
    const a = computePassInputHash('contracts', 'abc123', 'cfg1', [
      'a.ts',
      'b.ts',
    ]);
    const b = computePassInputHash('contracts', 'abc123', 'cfg1', [
      'a.ts',
      'b.ts',
    ]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable under path-order permutation', () => {
    const a = computePassInputHash('contracts', 'abc123', 'cfg1', [
      'a.ts',
      'b.ts',
      'c.ts',
    ]);
    const b = computePassInputHash('contracts', 'abc123', 'cfg1', [
      'c.ts',
      'a.ts',
      'b.ts',
    ]);
    expect(a).toBe(b);
  });

  it('differs when any ingredient changes', () => {
    const base = computePassInputHash('contracts', 'abc', 'cfg1', ['a.ts']);
    expect(computePassInputHash('gotchas', 'abc', 'cfg1', ['a.ts'])).not.toBe(
      base,
    );
    expect(computePassInputHash('contracts', 'def', 'cfg1', ['a.ts'])).not.toBe(
      base,
    );
    expect(computePassInputHash('contracts', 'abc', 'cfg2', ['a.ts'])).not.toBe(
      base,
    );
    expect(computePassInputHash('contracts', 'abc', 'cfg1', ['b.ts'])).not.toBe(
      base,
    );
  });

  it('contains no time-varying state', () => {
    // Two computations one millisecond apart must agree.
    const a = computePassInputHash('structure', 'abc', 'cfg', []);
    const b = computePassInputHash('structure', 'abc', 'cfg', []);
    expect(a).toBe(b);
  });
});

describe('computeConfigHash', () => {
  it('is order-insensitive over object keys', () => {
    const a = computeConfigHash({
      passes: { contracts: { model: 'x' } },
      budget: { dailyTokenCap: 1 },
    });
    const b = computeConfigHash({
      budget: { dailyTokenCap: 1 },
      passes: { contracts: { model: 'x' } },
    });
    expect(a).toBe(b);
  });

  it('differs when model changes', () => {
    const a = computeConfigHash({ passes: { contracts: { model: 'x' } } });
    const b = computeConfigHash({ passes: { contracts: { model: 'y' } } });
    expect(a).not.toBe(b);
  });
});

describe('computeAffectedPaths', () => {
  it('returns [] when sinceSha is null (no diff possible)', async () => {
    const exec = jest.fn() as unknown as ExecFn;
    const out = await computeAffectedPaths('/repo', null, exec);
    expect(out).toEqual([]);
    expect(exec).not.toHaveBeenCalled();
  });

  it('runs git diff --name-only and trims output', async () => {
    const exec: ExecFn = jest.fn((cmd: string) => {
      if (cmd.startsWith('git rev-parse'))
        return Promise.resolve({ stdout: 'abc123\n', stderr: '' });
      return Promise.resolve({
        stdout: 'src/a.ts\nsrc/b.ts\n\nREADME.md\n',
        stderr: '',
      });
    });
    const out = await computeAffectedPaths('/repo', 'abc123', exec);
    expect(out).toEqual(['src/a.ts', 'src/b.ts', 'README.md']);
  });

  it('throws InvalidSinceShaError when git rev-parse fails', async () => {
    const exec: ExecFn = jest.fn((cmd: string) => {
      if (cmd.startsWith('git rev-parse'))
        return Promise.reject(new Error('bad ref'));
      return Promise.resolve({ stdout: '', stderr: '' });
    });
    await expect(
      computeAffectedPaths('/repo', 'deadbeef', exec),
    ).rejects.toBeInstanceOf(InvalidSinceShaError);
  });

  it('refuses non-ref arguments (shell-quote guard)', async () => {
    const exec: ExecFn = jest.fn(() =>
      Promise.resolve({ stdout: '', stderr: '' }),
    );
    await expect(
      computeAffectedPaths('/repo', 'evil; rm -rf /', exec),
    ).rejects.toBeInstanceOf(InvalidSinceShaError);
  });
});

describe('shouldRerunPass', () => {
  it('reruns when no prior SUCCESS row exists (first-ever run)', async () => {
    const prisma = makeFakePrisma([]);
    const decision = await shouldRerunPass(
      prisma,
      'tiny',
      { passName: 'contracts', sha: 'abc', affectedPaths: [] },
      { configHash: 'cfg1' },
    );
    expect(decision.rerun).toBe(true);
    expect(decision.reason).toBe('no-prior-run');
    expect(decision.lastRun).toBeUndefined();
    expect(decision.newInputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('skips when prior SUCCESS row has matching hash and no affected paths', async () => {
    const inputHash = computePassInputHash('contracts', 'abc', 'cfg1', []);
    const prisma = makeFakePrisma([
      {
        repoId: 'tiny',
        passName: 'contracts',
        status: 'SUCCESS',
        inputHash,
        outputHash: 'abc',
        startedAt: new Date('2026-05-25T10:00:00Z'),
      },
    ]);
    const decision = await shouldRerunPass(
      prisma,
      'tiny',
      { passName: 'contracts', sha: 'abc', affectedPaths: [] },
      { configHash: 'cfg1' },
    );
    expect(decision.rerun).toBe(false);
    expect(decision.reason).toBe('skipped-no-changes');
    expect(decision.lastRun?.inputHash).toBe(inputHash);
  });

  it('reruns when config hash differs (config change)', async () => {
    const oldHash = computePassInputHash('contracts', 'abc', 'cfg-old', []);
    const prisma = makeFakePrisma([
      {
        repoId: 'tiny',
        passName: 'contracts',
        status: 'SUCCESS',
        inputHash: oldHash,
        outputHash: 'abc',
        startedAt: new Date('2026-05-25T10:00:00Z'),
      },
    ]);
    const decision = await shouldRerunPass(
      prisma,
      'tiny',
      { passName: 'contracts', sha: 'abc', affectedPaths: [] },
      { configHash: 'cfg-new' },
    );
    expect(decision.rerun).toBe(true);
    expect(decision.reason).toBe('input-hash-differs');
  });

  it('reruns when --full flag is set (forced)', async () => {
    const inputHash = computePassInputHash('contracts', 'abc', 'cfg1', []);
    const prisma = makeFakePrisma([
      {
        repoId: 'tiny',
        passName: 'contracts',
        status: 'SUCCESS',
        inputHash,
        outputHash: 'abc',
        startedAt: new Date('2026-05-25T10:00:00Z'),
      },
    ]);
    const decision = await shouldRerunPass(
      prisma,
      'tiny',
      { passName: 'contracts', sha: 'abc', affectedPaths: [] },
      { configHash: 'cfg1', force: true },
    );
    expect(decision.rerun).toBe(true);
    expect(decision.reason).toBe('forced-full');
    // findFirst is short-circuited under --full.
    expect(prisma.findFirstCalls).toBe(0);
  });

  it('reruns when affected paths intersect pass scope (partial overlap)', async () => {
    // Same hash for both runs but affectedPaths is non-empty AND touches
    // the contracts scope (.ts file). The pass MUST rerun even though
    // the hash would otherwise match.
    const affected = ['src/foo.ts'];
    const inputHash = computePassInputHash(
      'contracts',
      'abc',
      'cfg1',
      affected,
    );
    const prisma = makeFakePrisma([
      {
        repoId: 'tiny',
        passName: 'contracts',
        status: 'SUCCESS',
        inputHash,
        outputHash: 'abc',
        startedAt: new Date('2026-05-25T10:00:00Z'),
      },
    ]);
    const decision = await shouldRerunPass(
      prisma,
      'tiny',
      { passName: 'contracts', sha: 'abc', affectedPaths: affected },
      { configHash: 'cfg1' },
    );
    expect(decision.rerun).toBe(true);
    expect(decision.reason).toBe('paths-intersect-scope');
  });

  it('skips when affected paths are outside this pass scope', async () => {
    // contracts pass doesn't care about markdown changes (only README.md
    // ADRs do, via the gotchas/repository scope) — a CHANGELOG.md edit
    // should NOT force contracts to rerun.
    const affected = ['CHANGELOG.md'];
    const inputHash = computePassInputHash(
      'contracts',
      'abc',
      'cfg1',
      affected,
    );
    const prisma = makeFakePrisma([
      {
        repoId: 'tiny',
        passName: 'contracts',
        status: 'SUCCESS',
        inputHash,
        outputHash: 'abc',
        startedAt: new Date('2026-05-25T10:00:00Z'),
      },
    ]);
    const decision = await shouldRerunPass(
      prisma,
      'tiny',
      { passName: 'contracts', sha: 'abc', affectedPaths: affected },
      { configHash: 'cfg1' },
    );
    expect(decision.rerun).toBe(false);
    expect(decision.reason).toBe('skipped-no-changes');
  });

  it('ignores FAILED prior runs (only SUCCESS short-circuits)', async () => {
    const prisma = makeFakePrisma([
      {
        repoId: 'tiny',
        passName: 'contracts',
        status: 'FAILED',
        inputHash: 'whatever',
        outputHash: null,
        startedAt: new Date('2026-05-25T10:00:00Z'),
      },
    ]);
    const decision = await shouldRerunPass(
      prisma,
      'tiny',
      { passName: 'contracts', sha: 'abc', affectedPaths: [] },
      { configHash: 'cfg1' },
    );
    expect(decision.rerun).toBe(true);
    expect(decision.reason).toBe('no-prior-run');
  });
});

describe('buildSkippedPassRun', () => {
  it('produces a SUCCESS row with tokenCost=0 and the marker errorMessage', () => {
    const startedAt = new Date('2026-05-26T12:00:00Z');
    const row = buildSkippedPassRun({
      repoId: 'tiny',
      passName: 'contracts',
      newInputHash: 'h1',
      headSha: 'abc',
      startedAt,
    });
    expect(row.status).toBe('SUCCESS');
    expect(row.tokenCost).toBe(0);
    expect(row.errorMessage).toBe(SKIPPED_NO_CHANGES);
    expect(row.inputHash).toBe('h1');
    expect(row.outputHash).toBe('abc');
    expect(row.startedAt).toBe(startedAt);
    expect(row.finishedAt).toBe(startedAt);
  });
});

describe('resolveSinceSha', () => {
  it('prefers caller override when provided', async () => {
    const prisma = makeFakePrisma([]);
    const sha = await resolveSinceSha(prisma, 'tiny', 'override-sha');
    expect(sha).toBe('override-sha');
    expect(prisma.findFirstCalls).toBe(0);
  });

  it('falls back to last SUCCESS outputHash when no override', async () => {
    const prisma = makeFakePrisma([
      {
        repoId: 'tiny',
        passName: 'contracts',
        status: 'SUCCESS',
        inputHash: 'h1',
        outputHash: 'last-sha',
        startedAt: new Date('2026-05-25T10:00:00Z'),
      },
    ]);
    const sha = await resolveSinceSha(prisma, 'tiny', null);
    expect(sha).toBe('last-sha');
  });

  it('returns null on first-ever ingest', async () => {
    const prisma = makeFakePrisma([]);
    const sha = await resolveSinceSha(prisma, 'tiny', undefined);
    expect(sha).toBeNull();
  });
});

describe('resolveHeadSha', () => {
  it('returns trimmed sha when git succeeds', async () => {
    const exec: ExecFn = jest.fn(() =>
      Promise.resolve({
        stdout: 'abc123\n',
        stderr: '',
      }),
    );
    expect(await resolveHeadSha('/repo', exec)).toBe('abc123');
  });

  it('returns null when git fails (not a checkout)', async () => {
    const exec: ExecFn = jest.fn(() =>
      Promise.reject(new Error('not a git repo')),
    );
    expect(await resolveHeadSha('/repo', exec)).toBeNull();
  });
});

describe('AffectedPathsCache', () => {
  it('shells git once per unique sinceSha', async () => {
    let calls = 0;
    const exec: ExecFn = jest.fn((cmd: string) => {
      calls++;
      if (cmd.startsWith('git rev-parse'))
        return Promise.resolve({ stdout: 'abc\n', stderr: '' });
      return Promise.resolve({ stdout: 'src/a.ts\n', stderr: '' });
    });
    const cache = new AffectedPathsCache('/repo', exec);
    await cache.get('abc');
    await cache.get('abc');
    await cache.get('abc');
    // Two calls (rev-parse + diff) on first lookup, zero on subsequent.
    expect(calls).toBe(2);
  });

  it('re-shells when sinceSha changes', async () => {
    const exec: ExecFn = jest.fn((cmd: string) => {
      if (cmd.startsWith('git rev-parse'))
        return Promise.resolve({ stdout: 'x\n', stderr: '' });
      return Promise.resolve({ stdout: 'a.ts\n', stderr: '' });
    });
    const cache = new AffectedPathsCache('/repo', exec);
    await cache.get('abc');
    await cache.get('def');
    // 4 calls: rev-parse + diff for each of two distinct shas.
    expect((exec as jest.Mock).mock.calls).toHaveLength(4);
  });

  it('caches the empty-diff case (sinceSha=null) too', async () => {
    const exec: ExecFn = jest.fn();
    const cache = new AffectedPathsCache('/repo', exec);
    const a = await cache.get(null);
    const b = await cache.get(null);
    expect(a).toEqual([]);
    expect(b).toEqual([]);
    expect(exec).not.toHaveBeenCalled();
  });
});

// Tie the `PassRunPrismaClient` import into the file so eslint doesn't
// flag it — the type is referenced by IncrementalPrismaClient in the
// module under test.
void ({} as PassRunPrismaClient);
