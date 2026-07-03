/**
 * Disk writer for contracts-pass artifacts.
 *
 * One `contracts.md` per module under
 * `<artifactsRoot>/modules/<modulePath>/contracts.md`.
 *
 * Mirrors `intent/writer.ts` — fs ops are pluggable for tests.
 */

import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ContractsModuleResult } from './orchestrator';
import { renderContractsMarkdown } from './orchestrator';

export interface WriteContractsArtifactsOptions {
  artifactsRoot: string;
  writeFile?: (path: string, contents: string) => Promise<void>;
  mkdir?: (path: string, opts?: { recursive?: boolean }) => Promise<unknown>;
}

export interface ContractsArtifactWriteResult {
  modulePath: string;
  filePath: string;
}

/**
 * Materialise every successful module's contracts table to disk. Skipped
 * modules (no exports, budget-exceeded, llm-error) are omitted — they're
 * reported in `ContractsPassResult.modules`.
 */
export async function writeContractsArtifacts(
  results: ContractsModuleResult[],
  opts: WriteContractsArtifactsOptions,
): Promise<ContractsArtifactWriteResult[]> {
  const writeFile = opts.writeFile ?? fs.writeFile;
  const mkdir = opts.mkdir ?? fs.mkdir;
  const written: ContractsArtifactWriteResult[] = [];

  for (const r of results) {
    if (!r.card) continue;
    const filePath = join(opts.artifactsRoot, 'modules', r.modulePath, 'contracts.md');
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, withFrontmatter(r));
    written.push({ modulePath: r.modulePath, filePath });
  }
  return written;
}

function withFrontmatter(r: ContractsModuleResult): string {
  const fm = [
    '---',
    `module: ${r.modulePath}`,
    'pass: contracts',
    `symbols: ${r.symbols.length}`,
    `truncated: ${r.truncated}`,
    `tokenCost: ${r.tokenCost}`,
    '---',
    '',
  ].join('\n');
  const body = r.card?.content ?? renderContractsMarkdown(r.modulePath, r.symbols);
  return fm + body;
}
