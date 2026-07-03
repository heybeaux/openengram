/**
 * Disk writer for gotchas-pass artifacts.
 *
 * One `gotchas.md` per module under
 * `<artifactsRoot>/modules/<modulePath>/gotchas.md`. Modules with zero
 * candidates produce no file at all — per spec, the absence of
 * `gotchas.md` is itself the "clean module" signal.
 */

import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

import type { GotchasModuleResult } from './orchestrator';

export interface WriteGotchasArtifactsOptions {
  artifactsRoot: string;
  writeFile?: (path: string, contents: string) => Promise<void>;
  mkdir?: (path: string, opts?: { recursive?: boolean }) => Promise<unknown>;
}

export interface GotchasArtifactWriteResult {
  modulePath: string;
  filePath: string;
}

export async function writeGotchasArtifacts(
  results: GotchasModuleResult[],
  opts: WriteGotchasArtifactsOptions,
): Promise<GotchasArtifactWriteResult[]> {
  const writeFile = opts.writeFile ?? fs.writeFile;
  const mkdir = opts.mkdir ?? fs.mkdir;
  const written: GotchasArtifactWriteResult[] = [];

  for (const r of results) {
    if (!r.card) continue;
    const filePath = join(opts.artifactsRoot, 'modules', r.modulePath, 'gotchas.md');
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, withFrontmatter(r));
    written.push({ modulePath: r.modulePath, filePath });
  }
  return written;
}

function withFrontmatter(r: GotchasModuleResult): string {
  const fm = [
    '---',
    `module: ${r.modulePath}`,
    'pass: gotchas',
    `candidates: ${r.candidateCount}`,
    `truncated: ${r.truncated}`,
    `tokenCost: ${r.tokenCost}`,
    '---',
    '',
  ].join('\n');
  return fm + (r.card?.content ?? '');
}
