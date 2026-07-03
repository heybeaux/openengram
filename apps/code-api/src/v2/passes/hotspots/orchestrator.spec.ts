/**
 * Tests for the hotspots pass orchestrator (EC-45).
 *
 * The orchestrator composes four signal collectors via their injectable
 * seams — we never spawn git or touch the real filesystem from these
 * tests. The injected `gitExec` returns a canned `git log` payload in the
 * format documented on {@link collectGitChurn}; injected `readFile`
 * returns synthetic source bodies so in-degree + complexity have stable
 * inputs.
 */

import {
  DEFAULT_HOTSPOT_WEIGHTS,
  hotspotConceptPath,
  hotspotsRollupConceptPath,
  runHotspotsPass,
} from './orchestrator';
import type { GitExec } from './signals';

/** Build a synthetic file map keyed by absolute path. */
function fileMap(entries: Record<string, string>): Record<string, string> {
  return entries;
}

/** Wrap a file map into the `readFile` seam expected by collectors. */
function readFileFrom(
  files: Record<string, string>,
): (absPath: string) => Promise<string> {
  return async (absPath) => {
    if (!(absPath in files)) {
      throw new Error(`unexpected read: ${absPath}`);
    }
    return files[absPath];
  };
}

/**
 * Build a git log chunk in the format the churn collector parses.
 * Format: `<sha>\t<email>\t<iso>\n<path>\n<path>\n\n`
 */
function commit(
  sha: string,
  email: string,
  iso: string,
  paths: string[],
): string {
  return [`${sha}\t${email}\t${iso}`, ...paths, ''].join('\n');
}

function makeGitExec(payload: string): GitExec {
  return async () => payload;
}

describe('runHotspotsPass', () => {
  const repoRoot = '/repo';
  const repoId = 'demo-repo';

  // ── Three files: one hot (high churn + complex + uncovered),
  // ── one cold (no churn, low complexity), one in the middle.
  const hotPath = '/repo/src/hot.ts';
  const midPath = '/repo/src/mid.ts';
  const coldPath = '/repo/src/cold.ts';

  const files = fileMap({
    [hotPath]:
      // Complex body: many control-flow tokens + several imports.
      `import { mid } from './mid';
       import { cold } from './cold';
       export function run(x: number) {
         if (x > 10) {
           for (let i = 0; i < x; i++) {
             if (i % 2 === 0) { console.log(i); }
             else if (i > 5) { console.log('big'); }
           }
         } else if (x < 0) { throw new Error('neg'); }
         try { mid(); } catch (e) { cold(); }
         return x && x ? x : 0;
       }`,
    [midPath]:
      `import { cold } from './cold';
       export function mid() {
         if (Math.random() > 0.5) cold();
         return 1;
       }`,
    [coldPath]:
      `export function cold() {
         return 42;
       }`,
  });

  const gitPayload = [
    // hot.ts churns: 4 commits, 3 distinct authors.
    commit('aaa1', 'alice@x.com', '2026-05-24T10:00:00Z', ['src/hot.ts']),
    commit('aaa2', 'bob@x.com', '2026-05-23T10:00:00Z', ['src/hot.ts']),
    commit('aaa3', 'carol@x.com', '2026-05-22T10:00:00Z', ['src/hot.ts']),
    commit('aaa4', 'alice@x.com', '2026-05-21T10:00:00Z', [
      'src/hot.ts',
      'src/mid.ts',
    ]),
  ].join('\n');

  const baseOpts = {
    files: [hotPath, midPath, coldPath],
    repoRoot,
    readFile: readFileFrom(files),
    gitExec: makeGitExec(gitPayload),
  };

  it('emits a SUCCESS PassRunInput with zero token cost', async () => {
    const result = await runHotspotsPass(repoId, baseOpts);

    expect(result.passRun.passName).toBe('hotspots');
    expect(result.passRun.status).toBe('SUCCESS');
    expect(result.passRun.tokenCost).toBe(0);
    expect(result.passRun.repoId).toBe(repoId);
    expect(result.passRun.startedAt).toBeInstanceOf(Date);
    expect(result.passRun.finishedAt).toBeInstanceOf(Date);
  });

  it('ranks the hot file above the cold one', async () => {
    const result = await runHotspotsPass(repoId, baseOpts);

    expect(result.scores.length).toBeGreaterThan(0);
    expect(result.scores[0].filePath).toBe('src/hot.ts');
    // Cold file last (or near-last). Even with no coverage data its
    // coverage axis is 1 (untested), but every other axis is 0 — total
    // score should sit below the hot file's by a clear margin.
    const cold = result.scores.find((s) => s.filePath === 'src/cold.ts');
    expect(cold).toBeDefined();
    expect(result.scores[0].score).toBeGreaterThan(cold!.score);
  });

  it('reports per-axis breakdown including raw signal values', async () => {
    const result = await runHotspotsPass(repoId, baseOpts);
    const hot = result.scores.find((s) => s.filePath === 'src/hot.ts')!;

    expect(hot.axes.churn).toBeGreaterThan(0);
    expect(hot.axes.complexity).toBeGreaterThan(0);
    expect(hot.raw.churn?.commitCount).toBe(4);
    expect(hot.raw.churn?.uniqueAuthors).toBe(3);
    expect(hot.raw.complexity).not.toBeNull();
    expect(hot.raw.inDegree).not.toBeNull();
    // No coverage file supplied → coverage signal absent, coverage axis = 1.
    expect(hot.raw.coverage).toBeNull();
    expect(hot.axes.coverage).toBe(1);
  });

  it('respects a custom score threshold', async () => {
    // Force the threshold above any reasonable score so no file qualifies.
    const r = await runHotspotsPass(repoId, {
      ...baseOpts,
      scoreThreshold: 0.999,
    });
    expect(r.hotspots).toHaveLength(0);
    // Roll-up card is still emitted — it just notes no hotspots.
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0].level).toBe('REPOSITORY');
    expect(r.cards[0].content).toContain('No files scored above');
  });

  it('emits MODULE cards for each hotspot plus a single REPOSITORY roll-up', async () => {
    // Drop the threshold so all three files qualify; cap at 2 to test
    // the maxCards path independently.
    const r = await runHotspotsPass(repoId, {
      ...baseOpts,
      scoreThreshold: 0,
      maxCards: 2,
    });
    const moduleCards = r.cards.filter((c) => c.level === 'MODULE');
    const repoCards = r.cards.filter((c) => c.level === 'REPOSITORY');

    expect(moduleCards).toHaveLength(2);
    expect(repoCards).toHaveLength(1);
    for (const c of moduleCards) {
      expect(c.sourcePass).toBe('hotspots');
      expect(c.lod).toBe('STANDARD');
      expect(c.conceptPath.startsWith(`${repoId}/`)).toBe(true);
    }
    expect(repoCards[0].conceptPath).toBe(hotspotsRollupConceptPath(repoId));
    // Roll-up references the hottest file in its body.
    expect(repoCards[0].content).toContain('src/hot.ts');
  });

  it('clamps the blended score to 0..1 even with skewed weights', async () => {
    const r = await runHotspotsPass(repoId, {
      ...baseOpts,
      // Wildly skewed weights — exercise the normalization branch.
      weights: { churn: 10, complexity: 0, inDegree: 0, coverage: 0 },
    });
    for (const s of r.scores) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
    }
  });

  it('treats a missing coverage summary path as "no coverage data" (axis = 1)', async () => {
    const r = await runHotspotsPass(repoId, baseOpts);
    for (const s of r.scores) {
      expect(s.raw.coverage).toBeNull();
      expect(s.axes.coverage).toBe(1);
    }
  });

  it('parses an Istanbul coverage summary when provided', async () => {
    const summaryPath = '/repo/coverage/coverage-summary.json';
    const summary = JSON.stringify({
      [hotPath]: {
        lines: { total: 10, covered: 1, pct: 10 },
        statements: { total: 10, covered: 1, pct: 10 },
        branches: { total: 4, covered: 0, pct: 0 },
      },
      [coldPath]: {
        lines: { total: 1, covered: 1, pct: 100 },
        statements: { total: 1, covered: 1, pct: 100 },
        branches: { total: 0, covered: 0, pct: 100 },
      },
    });

    const r = await runHotspotsPass(repoId, {
      ...baseOpts,
      coverageSummaryPath: summaryPath,
      readCoverageFile: async (p) => (p === summaryPath ? summary : ''),
    });

    const hot = r.scores.find((s) => s.filePath === 'src/hot.ts')!;
    const cold = r.scores.find((s) => s.filePath === 'src/cold.ts')!;
    expect(hot.raw.coverage?.statementCoverage).toBeCloseTo(0.1, 2);
    expect(cold.raw.coverage?.statementCoverage).toBeCloseTo(1, 2);
    // Hot is poorly covered, cold is fully covered → hot's coverage axis
    // (1 - stmt) must be greater.
    expect(hot.axes.coverage).toBeGreaterThan(cold.axes.coverage);
  });

  it('uses the documented concept-path convention for per-file cards', async () => {
    const r = await runHotspotsPass(repoId, {
      ...baseOpts,
      scoreThreshold: 0,
    });
    const moduleCards = r.cards.filter((c) => c.level === 'MODULE');
    for (const c of moduleCards) {
      const matched = r.hotspots.find(
        (h) => hotspotConceptPath(repoId, h.filePath) === c.conceptPath,
      );
      expect(matched).toBeDefined();
    }
  });

  it('exposes well-formed default weights', () => {
    const sum =
      DEFAULT_HOTSPOT_WEIGHTS.churn +
      DEFAULT_HOTSPOT_WEIGHTS.complexity +
      DEFAULT_HOTSPOT_WEIGHTS.inDegree +
      DEFAULT_HOTSPOT_WEIGHTS.coverage;
    // Weights are normalized at blend-time, but the documented defaults
    // should still sum to 1.0 so they read cleanly.
    expect(sum).toBeCloseTo(1, 6);
  });

  it('treats a git-churn collector failure as "no churn signal" (best-effort)', async () => {
    // Real-world: a fresh tarball or shallow clone with no `.git` makes
    // `git log` exit non-zero. We swallow that and keep the pass SUCCESS
    // — the other three signals still produce a useful score.
    const failingGit: GitExec = async () => {
      throw new Error('fatal: not a git repository');
    };
    const r = await runHotspotsPass(repoId, {
      ...baseOpts,
      gitExec: failingGit,
      scoreThreshold: 0,
    });
    expect(r.passRun.status).toBe('SUCCESS');
    for (const s of r.scores) {
      expect(s.axes.churn).toBe(0);
      expect(s.raw.churn).toBeNull();
    }
  });

  it('returns FAILED-equivalent state only on collector throw (currently SUCCESS path)', async () => {
    // Sanity: an empty file list still produces a SUCCESS row with zero
    // scores. The conductor relies on this — no input is not an error.
    const r = await runHotspotsPass(repoId, {
      ...baseOpts,
      files: [],
      gitExec: makeGitExec(''),
    });
    expect(r.passRun.status).toBe('SUCCESS');
    expect(r.scores).toHaveLength(0);
    // Still emits the roll-up card.
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0].level).toBe('REPOSITORY');
  });
});
