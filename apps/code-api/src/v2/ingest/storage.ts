/**
 * Per-repo storage paths + LRU eviction for the ingest flow (EC-39a).
 *
 * Layout (all under `~/.engram-code/`):
 *   ingests/<repoId>/      ← shallow clone scratch dir
 *   artifacts/<repoId>/    ← markdown cards (the v1 API reads this)
 *
 * The EC-39 spec resolved Q3 as: 500MB per-repo cap (enforced at clone
 * time by the adapter) + LRU eviction when the artifacts root exceeds
 * 5GB. Eviction drops the oldest scratch+artifacts pair as a unit so a
 * repo is either fully present or fully gone — partial state would
 * confuse downstream readers.
 */

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const TOTAL_CAP_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

/**
 * Resolve the engram-code home. Honors `EC_HOME` so tests can pin storage
 * to a tmpdir without depending on Node's cached `homedir()` (which does
 * not pick up runtime changes to `$HOME`).
 */
function ecHome(): string {
  const override = process.env.EC_HOME;
  if (override && override.trim() !== '') return override;
  return join(homedir(), '.engram-code');
}

export function ingestsRoot(): string {
  return join(ecHome(), 'ingests');
}

export function artifactsRoot(): string {
  return join(ecHome(), 'artifacts');
}

export function scratchDirFor(repoId: string): string {
  return join(ingestsRoot(), repoId);
}

export function artifactsDirFor(repoId: string): string {
  return join(artifactsRoot(), repoId);
}

/**
 * Remove any prior scratch/artifacts so a re-ingest starts clean. Done
 * before clone so a previously-failed run doesn't leave a half-populated
 * tree that the synth pipeline would mistake for fresh sources.
 */
export async function resetRepoStorage(repoId: string): Promise<void> {
  await Promise.all([
    fs.rm(scratchDirFor(repoId), { recursive: true, force: true }),
    fs.rm(artifactsDirFor(repoId), { recursive: true, force: true }),
  ]);
}

/**
 * If `~/.engram-code/artifacts` exceeds the total cap, drop the oldest
 * repos (by mtime) until we're back under. The scratch dir is dropped
 * alongside the artifacts so the two stay in sync.
 *
 * Returns the list of evicted repoIds for logging/observability.
 */
export async function evictIfOverCap(): Promise<string[]> {
  const root = artifactsRoot();
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const dirs = entries.filter((e) => e.isDirectory());
  const stats = await Promise.all(
    dirs.map(async (d) => {
      const abs = join(root, d.name);
      const [stat, size] = await Promise.all([fs.stat(abs), dirSize(abs)]);
      return { repoId: d.name, mtimeMs: stat.mtimeMs, size };
    }),
  );

  let total = stats.reduce((s, e) => s + e.size, 0);
  if (total <= TOTAL_CAP_BYTES) return [];

  // Sort oldest-first.
  stats.sort((a, b) => a.mtimeMs - b.mtimeMs);
  const evicted: string[] = [];
  for (const entry of stats) {
    if (total <= TOTAL_CAP_BYTES) break;
    await resetRepoStorage(entry.repoId);
    evicted.push(entry.repoId);
    total -= entry.size;
  }
  return evicted;
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(abs);
    } else if (entry.isFile()) {
      try {
        const stat = await fs.stat(abs);
        total += stat.size;
      } catch {
        // Race against eviction — ignore.
      }
    }
  }
  return total;
}
