/**
 * Disk writer for intent-pass artifacts.
 *
 * Writes one `intent.md` per module under
 * `<artifactsRoot>/modules/<modulePath>/intent.md`.
 *
 * Kept separate from the orchestrator so the orchestrator can stay pure and
 * tests don't need a tmp dir.
 */

import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

import type { IntentModuleResult } from './orchestrator';

export interface WriteIntentArtifactsOptions {
  /** Root directory for v2 artifacts, typically `<repo>/.engram/artifacts`. */
  artifactsRoot: string;
  /** Override fs writer — used by tests. Defaults to `node:fs/promises`. */
  writeFile?: (path: string, contents: string) => Promise<void>;
  /** Override mkdir — used by tests. */
  mkdir?: (path: string, opts?: { recursive?: boolean }) => Promise<unknown>;
}

export interface IntentArtifactWriteResult {
  modulePath: string;
  filePath: string;
}

/**
 * Materialise every successful module's intent note to disk. Skipped modules
 * are silently omitted — they're reported in `IntentPassResult.modules`.
 */
export async function writeIntentArtifacts(
  results: IntentModuleResult[],
  opts: WriteIntentArtifactsOptions,
): Promise<IntentArtifactWriteResult[]> {
  const writeFile = opts.writeFile ?? fs.writeFile;
  const mkdir = opts.mkdir ?? fs.mkdir;
  const written: IntentArtifactWriteResult[] = [];

  for (const r of results) {
    if (!r.intent) continue;
    const filePath = join(opts.artifactsRoot, 'modules', r.modulePath, 'intent.md');
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, withFrontmatter(r));
    written.push({ modulePath: r.modulePath, filePath });
  }

  return written;
}

function withFrontmatter(r: IntentModuleResult): string {
  const fm = [
    '---',
    `module: ${r.modulePath}`,
    'pass: intent',
    `truncated: ${r.truncated}`,
    `tokenCost: ${r.tokenCost}`,
    '---',
    '',
  ].join('\n');
  return fm + (r.intent ?? '');
}
