/**
 * Tests for the coverage signal collector (EC-44).
 *
 * The collector is exercised through the injectable `readFile` hook so
 * tests never touch a real `coverage-summary.json`. Inputs follow the
 * Istanbul shape: per-file objects with `lines`, `statements`,
 * `branches` (each `{ total, covered, ... }`) plus a `total` roll-up.
 */

import * as path from 'node:path';

import { collectCoverage, type ReadFile } from './coverage';

const ROOT = path.resolve('/repo');
const abs = (rel: string) => path.resolve(ROOT, rel);

function fakeRead(value: string | Error): { readFile: ReadFile } {
  const readFile: ReadFile = () =>
    value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  return { readFile };
}

describe('collectCoverage', () => {
  it('parses an Istanbul summary into one signal per file', async () => {
    const summary = JSON.stringify({
      total: {
        lines: { total: 10, covered: 7 },
        statements: { total: 10, covered: 7 },
        branches: { total: 4, covered: 2 },
      },
      [abs('src/a.ts')]: {
        lines: { total: 10, covered: 8 },
        statements: { total: 10, covered: 8 },
        branches: { total: 4, covered: 3 },
      },
      [abs('src/b.ts')]: {
        lines: { total: 5, covered: 1 },
        statements: { total: 5, covered: 1 },
        branches: { total: 2, covered: 0 },
      },
    });
    const { readFile } = fakeRead(summary);
    const out = await collectCoverage({
      repoRoot: ROOT,
      summaryPath: abs('coverage/coverage-summary.json'),
      readFile,
    });
    expect(out).toEqual([
      {
        filePath: 'src/a.ts',
        statementCoverage: 0.8,
        branchCoverage: 0.75,
        lineCoverage: 0.8,
      },
      {
        filePath: 'src/b.ts',
        statementCoverage: 0.2,
        branchCoverage: 0,
        lineCoverage: 0.2,
      },
    ]);
  });

  it('drops the "total" roll-up entry', async () => {
    const summary = JSON.stringify({
      total: { lines: { total: 1, covered: 1 } },
      [abs('src/a.ts')]: { lines: { total: 1, covered: 1 } },
    });
    const { readFile } = fakeRead(summary);
    const out = await collectCoverage({
      repoRoot: ROOT,
      summaryPath: abs('coverage/coverage-summary.json'),
      readFile,
    });
    expect(out.map((s) => s.filePath)).toEqual(['src/a.ts']);
  });

  it('clamps total=0 to 0 coverage (instead of trusting pct: 100)', async () => {
    const summary = JSON.stringify({
      [abs('src/empty.ts')]: {
        // Istanbul reports pct: 100 here, which is misleading.
        lines: { total: 0, covered: 0, pct: 100 },
        statements: { total: 0, covered: 0, pct: 100 },
        branches: { total: 0, covered: 0, pct: 100 },
      },
    });
    const { readFile } = fakeRead(summary);
    const out = await collectCoverage({
      repoRoot: ROOT,
      summaryPath: abs('coverage/coverage-summary.json'),
      readFile,
    });
    expect(out).toEqual([
      {
        filePath: 'src/empty.ts',
        statementCoverage: 0,
        branchCoverage: 0,
        lineCoverage: 0,
      },
    ]);
  });

  it('scopes output to the optional `files` set when provided', async () => {
    const summary = JSON.stringify({
      [abs('src/a.ts')]: { lines: { total: 2, covered: 1 } },
      [abs('src/b.ts')]: { lines: { total: 2, covered: 2 } },
      [abs('src/c.ts')]: { lines: { total: 2, covered: 0 } },
    });
    const { readFile } = fakeRead(summary);
    const out = await collectCoverage({
      repoRoot: ROOT,
      summaryPath: abs('coverage/coverage-summary.json'),
      files: [abs('src/a.ts'), abs('src/c.ts')],
      readFile,
    });
    expect(out.map((s) => s.filePath).sort()).toEqual(['src/a.ts', 'src/c.ts']);
  });

  it('returns [] when the summary file cannot be read', async () => {
    const { readFile } = fakeRead(new Error('ENOENT'));
    const out = await collectCoverage({
      repoRoot: ROOT,
      summaryPath: abs('coverage/coverage-summary.json'),
      readFile,
    });
    expect(out).toEqual([]);
  });

  it('returns [] when the summary file is not valid JSON', async () => {
    const { readFile } = fakeRead('this is not json{');
    const out = await collectCoverage({
      repoRoot: ROOT,
      summaryPath: abs('coverage/coverage-summary.json'),
      readFile,
    });
    expect(out).toEqual([]);
  });

  it('handles missing metric fields by reporting 0', async () => {
    const summary = JSON.stringify({
      [abs('src/sparse.ts')]: {
        // Only `lines` present — statements/branches absent entirely.
        lines: { total: 4, covered: 3 },
      },
    });
    const { readFile } = fakeRead(summary);
    const [sig] = await collectCoverage({
      repoRoot: ROOT,
      summaryPath: abs('coverage/coverage-summary.json'),
      readFile,
    });
    expect(sig.lineCoverage).toBe(0.75);
    expect(sig.statementCoverage).toBe(0);
    expect(sig.branchCoverage).toBe(0);
  });
});
