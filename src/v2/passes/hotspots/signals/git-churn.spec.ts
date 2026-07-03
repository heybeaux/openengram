/**
 * Tests for the git churn signal collector (EC-43).
 *
 * The collector is exercised through the injectable `exec` hook so we
 * never spawn real git processes. Each test composes a synthetic git
 * log payload using the documented format:
 *
 *   <sha>\t<email>\t<iso-date>
 *   path/one
 *   path/two
 *   <blank>
 */

import {
  collectGitChurn,
  DEFAULT_WINDOW_DAYS,
  type GitExec,
} from './git-churn';

/** Build one commit chunk in the format produced by our `git log` invocation. */
function commit(
  sha: string,
  email: string,
  iso: string,
  files: string[],
): string {
  return [`${sha}\t${email}\t${iso}`, ...files, ''].join('\n');
}

/** Build a fake exec that returns the joined commit chunks and records its calls. */
function fakeExec(chunks: string[]): {
  exec: GitExec;
  calls: Array<{ cmd: string; args: string[]; cwd: string }>;
} {
  const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
  const exec: GitExec = (cmd, args, cwd) => {
    calls.push({ cmd, args, cwd });
    return Promise.resolve(chunks.join('\n'));
  };
  return { exec, calls };
}

describe('collectGitChurn', () => {
  it('returns [] for an empty repo (no commits in window)', async () => {
    const { exec, calls } = fakeExec([]);
    const out = await collectGitChurn({ repoRoot: '/tmp/empty', exec });
    expect(out).toEqual([]);
    // Sanity: still invoked git with the expected flags.
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('git');
    expect(calls[0].args).toContain('log');
    expect(calls[0].args).toContain(`--since=${DEFAULT_WINDOW_DAYS}.days.ago`);
    expect(calls[0].args).toContain('--name-only');
  });

  it('aggregates a single commit into one signal per file', async () => {
    const iso = new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString();
    const { exec } = fakeExec([
      commit('aaa111', 'alice@example.com', iso, ['src/a.ts', 'src/b.ts']),
    ]);
    const out = await collectGitChurn({ repoRoot: '/tmp/repo', exec });
    expect(out).toHaveLength(2);
    const a = out.find((s) => s.filePath === 'src/a.ts')!;
    expect(a).toMatchObject({
      commitCount: 1,
      uniqueAuthors: 1,
      lastTouchSha: 'aaa111',
    });
    // ~3 days ago — allow daysSinceLastTouch of 2 or 3 depending on rounding.
    expect(a.daysSinceLastTouch).toBeGreaterThanOrEqual(2);
    expect(a.daysSinceLastTouch).toBeLessThanOrEqual(3);
  });

  it('counts distinct authors and keeps the most recent SHA per file', async () => {
    const older = new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString();
    const newer = new Date(Date.now() - 1000 * 60 * 60 * 24 * 1).toISOString();
    // Note: order in log output is newest-first by default, but the collector
    // must not rely on order — provide them oldest-first to prove it.
    const { exec } = fakeExec([
      commit('old111', 'alice@example.com', older, ['src/shared.ts']),
      commit('mid222', 'bob@example.com', older, ['src/shared.ts']),
      commit('new333', 'carol@example.com', newer, ['src/shared.ts']),
    ]);
    const out = await collectGitChurn({ repoRoot: '/tmp/repo', exec });
    expect(out).toHaveLength(1);
    const sig = out[0];
    expect(sig.filePath).toBe('src/shared.ts');
    expect(sig.commitCount).toBe(3);
    expect(sig.uniqueAuthors).toBe(3);
    expect(sig.lastTouchSha).toBe('new333');
    expect(sig.daysSinceLastTouch).toBeLessThanOrEqual(1);
  });

  it('applies includeGlobs and excludeGlobs filters', async () => {
    const iso = new Date().toISOString();
    const { exec } = fakeExec([
      commit('sha1', 'alice@example.com', iso, [
        'src/keep.ts',
        'src/keep.spec.ts',
        'test/skip.ts',
        'docs/readme.md',
      ]),
    ]);
    const out = await collectGitChurn({
      repoRoot: '/tmp/repo',
      exec,
      includeGlobs: ['src/**/*.ts'],
      excludeGlobs: ['**/*.spec.ts'],
    });
    const paths = out.map((s) => s.filePath).sort();
    expect(paths).toEqual(['src/keep.ts']);
  });

  it('honors a custom windowDays in the git invocation', async () => {
    const { exec, calls } = fakeExec([]);
    await collectGitChurn({ repoRoot: '/tmp/repo', exec, windowDays: 14 });
    expect(calls[0].args).toContain('--since=14.days.ago');
    expect(calls[0].args).not.toContain(
      `--since=${DEFAULT_WINDOW_DAYS}.days.ago`,
    );
  });

  it('wraps exec failures with the offending repoRoot', async () => {
    const exec: GitExec = () =>
      Promise.reject(new Error('fatal: not a git repository'));
    await expect(
      collectGitChurn({ repoRoot: '/tmp/not-a-repo', exec }),
    ).rejects.toThrow(/git-churn: git log failed in \/tmp\/not-a-repo/);
  });

  it('clamps daysSinceLastTouch to 0 for commits in the future (clock skew)', async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    const { exec } = fakeExec([
      commit('zzz999', 'alice@example.com', future, ['src/skewed.ts']),
    ]);
    const [sig] = await collectGitChurn({ repoRoot: '/tmp/repo', exec });
    expect(sig.daysSinceLastTouch).toBe(0);
  });
});
