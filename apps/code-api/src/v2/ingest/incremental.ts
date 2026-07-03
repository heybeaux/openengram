/**
 * Incremental git-diff rescans (EC-46).
 *
 * Phase 3 conductor optimization: when a repo is re-ingested, skip any pass
 * whose inputs haven't changed since the last successful run. The schema
 * already carries `PassRun.inputHash` (since EC-47) — this module is the
 * single place that knows how to compute that hash deterministically and
 * decide rerun-vs-skip.
 *
 * Rerun is forced when ANY of these hold:
 *   (a) no prior SUCCESS row exists for this (repoId, passName)
 *   (b) the recomputed `inputHash` differs from the last SUCCESS row's
 *   (c) the caller passed `force=true` (CLI `--full` flag)
 *   (d) the diff'd `affectedPaths` intersect this pass's declared scope
 *
 * `affectedPaths` come from `git diff --name-only <sinceSha>..HEAD`, run
 * once per ingest and cached on the conductor — passes don't re-shell-out.
 *
 * The hash is salted with `configHash` so a model/budget config bump
 * invalidates the skip cache without forcing the user to remember `--full`.
 *
 * Skips persist a `pass_runs` row with `status=SUCCESS, tokenCost=0,
 * errorMessage='skipped-no-changes'` so the EC-47 ledger / dashboard see
 * the no-op explicitly (and `inputHash` matches the prior row, so the next
 * run will also short-circuit until inputs change).
 */

import { exec as execCb } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

import type { PassRun } from '@prisma/client';

import type { PassRunPrismaClient } from '../passes/pass-run.repository';
import type { PassName } from '../types/cards';

const execP = promisify(execCb);

/**
 * Shape of the child-process exec wrapper used by `computeAffectedPaths`.
 * Pulled out so tests can stub the git invocation without a real repo.
 */
export type ExecFn = (
  cmd: string,
  opts?: { cwd?: string; maxBuffer?: number },
) => Promise<{ stdout: string; stderr: string }>;

/** Marker written to `errorMessage` when we skip a pass via incremental cache. */
export const SKIPPED_NO_CHANGES = 'skipped-no-changes';

/**
 * One pass's input fingerprint. The fields combine into a stable sha256
 * via {@link computePassInputHash}.
 */
export interface PassInputDigest {
  passName: PassName;
  /** HEAD commit sha at ingest time. */
  sha: string;
  /** Repo-relative paths affected since the last successful run. */
  affectedPaths: string[];
}

/**
 * Per-pass scope predicates. Each pass advertises which file types it cares
 * about; if the diff intersects a pass's scope it MUST rerun even if the
 * digest hash matches (defense in depth — protects against stale row drift).
 *
 * Kept small and additive: `structure` runs unconditionally (it's the
 * graph everyone else feeds off, and mechanical so it's cheap), so its
 * scope is permissive.
 */
const PASS_SCOPE: Record<PassName, (path: string) => boolean> = {
  structure: () => true,
  intent: (p) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go)$/.test(p),
  contracts: (p) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go)$/.test(p),
  gotchas: (p) =>
    /\.(ts|tsx|js|jsx|mjs|cjs|py|go)$/.test(p) ||
    /(^|\/)README\.md$/i.test(p) ||
    /(^|\/)ADR-[\w-]+\.md$/i.test(p),
  subsystem: (p) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go)$/.test(p),
  'synthesis-module': (p) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go)$/.test(p),
  'synthesis-subsystem': (p) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go)$/.test(p),
  'synthesis-repository': (p) =>
    /\.(ts|tsx|js|jsx|mjs|cjs|py|go)$/.test(p) ||
    /(^|\/)README\.md$/i.test(p) ||
    /(^|\/)package\.json$/.test(p),
  hotspots: (p) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go)$/.test(p),
};

/**
 * Run `git diff --name-only <sinceSha>..HEAD` and return the affected
 * repo-relative paths. When `sinceSha` is null (first-ever run), returns
 * the empty array — the caller decides to force a rerun via the
 * "no prior SUCCESS row" path.
 *
 * Throws when git rejects the ref (invalid SHA, shallow clone missing
 * history, etc.) — by design: silently treating a bad sha as "no
 * changes" would skip every pass and corrupt the cache.
 */
export async function computeAffectedPaths(
  repoRoot: string,
  sinceSha: string | null,
  exec: ExecFn = execP,
): Promise<string[]> {
  if (sinceSha === null) return [];
  // Verify the sha resolves first, so we surface a clean error instead of
  // letting `git diff` fall back to "everything since the empty tree".
  try {
    await exec(`git rev-parse --verify ${shellQuote(sinceSha)}^{commit}`, {
      cwd: repoRoot,
    });
  } catch (err) {
    throw new InvalidSinceShaError(
      `git rev-parse failed for "${sinceSha}": ${(err as Error).message}`,
    );
  }
  const { stdout } = await exec(
    `git diff --name-only ${shellQuote(sinceSha)}..HEAD`,
    { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Deterministic sha256 over the four ingredients that decide rerun. Order
 * matters — we sort `affectedPaths` so two diffs with the same set hash
 * identically regardless of input order.
 *
 * The digest is a hex sha256, prefixed with the pass name so log lines
 * stay readable when comparing two runs side-by-side.
 */
export function computePassInputHash(
  passName: string,
  headSha: string,
  configHash: string,
  affectedPaths: string[],
): string {
  const sortedPaths = [...affectedPaths].sort();
  const h = createHash('sha256');
  h.update('engram-code:pass-input:v1\n');
  h.update(`pass=${passName}\n`);
  h.update(`head=${headSha}\n`);
  h.update(`config=${configHash}\n`);
  h.update(`paths=${sortedPaths.join('\n')}`);
  return h.digest('hex');
}

/**
 * Test-overridable subset of `prisma.passRun` used by {@link shouldRerunPass}.
 * Keeps the test mock surface minimal — only `findFirst` is exercised.
 */
export type IncrementalPrismaClient = Pick<PassRunPrismaClient, 'passRun'>;

export interface ShouldRerunDecision {
  rerun: boolean;
  reason:
    | 'no-prior-run'
    | 'input-hash-differs'
    | 'forced-full'
    | 'paths-intersect-scope'
    | 'skipped-no-changes';
  /** The PassRun row we compared against (only present when one existed). */
  lastRun?: PassRun;
  /** Hash recomputed for the current inputs — caller persists this on the new row. */
  newInputHash: string;
}

export interface ShouldRerunOpts {
  /** Caller forces a rerun (CLI `--full` flag). */
  force?: boolean;
  /** Config hash so model/budget changes bust the cache. */
  configHash: string;
}

/**
 * Decide whether `passName` needs to rerun for `repoId`. Pulls the most
 * recent SUCCESS row for that (repoId, passName) and applies the four
 * rerun rules from the module docstring.
 *
 * Always returns the freshly-computed input hash so the caller can stamp
 * it onto the new `pass_runs` row — whether the pass actually ran or was
 * skipped.
 */
export async function shouldRerunPass(
  prisma: IncrementalPrismaClient,
  repoId: string,
  digest: PassInputDigest,
  opts: ShouldRerunOpts,
): Promise<ShouldRerunDecision> {
  const newInputHash = computePassInputHash(
    digest.passName,
    digest.sha,
    opts.configHash,
    digest.affectedPaths,
  );

  if (opts.force) {
    return { rerun: true, reason: 'forced-full', newInputHash };
  }

  const lastRun = await prisma.passRun.findFirst({
    where: { repoId, passName: digest.passName, status: 'SUCCESS' },
    orderBy: { startedAt: 'desc' },
  });

  if (!lastRun) {
    return { rerun: true, reason: 'no-prior-run', newInputHash };
  }

  if (lastRun.inputHash !== newInputHash) {
    // Even when hashes differ, only rerun if the diff intersects this
    // pass's declared scope. Otherwise the hash drift came from something
    // outside this pass's concern (e.g. config bump that doesn't touch
    // its model) — but config changes are baked into the hash anyway, so
    // the safe path here is to rerun.
    return { rerun: true, reason: 'input-hash-differs', lastRun, newInputHash };
  }

  // Same hash, but check scope intersection in case the prior hash was
  // computed before a recent shallow clone added paths we hadn't seen.
  const scope = PASS_SCOPE[digest.passName];
  if (scope && digest.affectedPaths.some((p) => scope(p))) {
    return {
      rerun: true,
      reason: 'paths-intersect-scope',
      lastRun,
      newInputHash,
    };
  }

  return {
    rerun: false,
    reason: 'skipped-no-changes',
    lastRun,
    newInputHash,
  };
}

/**
 * Compute a stable hash over the bits of resolved config that affect pass
 * outputs. Used as the `configHash` ingredient for {@link computePassInputHash}.
 *
 * We hash a JSON shape rather than the raw config object so additions to
 * the schema don't accidentally bust every cache — only the fields listed
 * here contribute. Callers can pass anything serializable; the canonical
 * caller (synth) passes `{ passes, budget }`.
 */
export function computeConfigHash(shape: unknown): string {
  const h = createHash('sha256');
  h.update(canonicalize(shape));
  return h.digest('hex');
}

/**
 * Stable JSON serialization: object keys sorted, no whitespace, undefined
 * dropped. Ensures `computeConfigHash({a:1,b:2}) === computeConfigHash({b:2,a:1})`.
 */
function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalize(v)).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return (
      '{' +
      keys
        .map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k]))
        .join(',') +
      '}'
    );
  }
  return 'null';
}

/**
 * Resolve the current HEAD sha for a repo. Used by the conductor to seed
 * the digest before any pass runs.
 *
 * Returns null when the repo isn't a git checkout — the caller treats
 * "no HEAD" as "force every pass" (no skipping possible without a sha
 * to compare against).
 */
export async function resolveHeadSha(
  repoRoot: string,
  exec: ExecFn = execP,
): Promise<string | null> {
  try {
    const { stdout } = await exec('git rev-parse HEAD', { cwd: repoRoot });
    const sha = stdout.trim();
    return sha.length > 0 ? sha : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the SHA that should anchor the diff. Precedence:
 *   1. caller-provided `since` (CLI `--since` flag)
 *   2. the most recent SUCCESS `pass_runs` row across all passes for this
 *      repo (cheapest: use the `outputHash` field — orchestrators stamp it
 *      with the HEAD sha at run time when {@link recordRunSha} is wired)
 *   3. null → first-ever run, no diff possible, all passes force rerun
 */
export async function resolveSinceSha(
  prisma: IncrementalPrismaClient,
  repoId: string,
  override: string | null | undefined,
): Promise<string | null> {
  if (override !== undefined && override !== null && override.length > 0) {
    return override;
  }
  const lastSuccess = await prisma.passRun.findFirst({
    where: { repoId, status: 'SUCCESS', outputHash: { not: null } },
    orderBy: { startedAt: 'desc' },
  });
  return lastSuccess?.outputHash ?? null;
}

/**
 * Build the {@link PassRunInput} we persist when a pass is skipped via
 * the incremental cache. Exposed so the conductor + tests share the
 * exact same payload shape.
 */
export function buildSkippedPassRun(opts: {
  repoId: string;
  passName: PassName;
  newInputHash: string;
  headSha: string;
  startedAt: Date;
  finishedAt?: Date;
}): {
  repoId: string;
  passName: PassName;
  status: 'SUCCESS';
  tokenCost: 0;
  inputHash: string;
  outputHash: string;
  errorMessage: string;
  startedAt: Date;
  finishedAt: Date;
} {
  const finishedAt = opts.finishedAt ?? opts.startedAt;
  return {
    repoId: opts.repoId,
    passName: opts.passName,
    status: 'SUCCESS',
    tokenCost: 0,
    inputHash: opts.newInputHash,
    outputHash: opts.headSha,
    errorMessage: SKIPPED_NO_CHANGES,
    startedAt: opts.startedAt,
    finishedAt,
  };
}

/**
 * Cache of `(sinceSha → affectedPaths)` shared across the passes in one
 * ingest run. Used by the conductor to invoke git once per run rather than
 * once per pass.
 */
export class AffectedPathsCache {
  private cached: string[] | null = null;
  private cachedKey: string | null = null;

  constructor(
    private readonly repoRoot: string,
    private readonly exec: ExecFn = execP,
  ) {}

  async get(sinceSha: string | null): Promise<string[]> {
    const key = sinceSha ?? '<none>';
    if (this.cached !== null && this.cachedKey === key) {
      return this.cached;
    }
    const paths = await computeAffectedPaths(
      this.repoRoot,
      sinceSha,
      this.exec,
    );
    this.cached = paths;
    this.cachedKey = key;
    return paths;
  }

  /** Test hook — drops the cache so the next `get` re-shells. */
  reset(): void {
    this.cached = null;
    this.cachedKey = null;
  }
}

export class InvalidSinceShaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSinceShaError';
  }
}

/**
 * Quote a CLI argument so `exec` can't be misled by an attacker-controlled
 * sha-looking string. We accept only `[A-Za-z0-9._/-]` — git refs and
 * short-shas only ever use those.
 */
function shellQuote(arg: string): string {
  if (!/^[A-Za-z0-9._/-]+$/.test(arg)) {
    throw new InvalidSinceShaError(
      `refusing to shell out with non-ref argument: ${JSON.stringify(arg)}`,
    );
  }
  return arg;
}
