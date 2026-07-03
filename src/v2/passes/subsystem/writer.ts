/**
 * Disk writer for subsystem-pass artifacts.
 *
 * One `subsystems/<slug>.md` per discovered subsystem under
 * `<artifactsRoot>/subsystems/<slug>.md`.
 *
 * Mirrors the intent + contracts writers — fs ops are pluggable for tests.
 */

import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

import type { SubsystemInput } from '../../types/cards';

import { renderSubsystemMarkdown, type SubsystemPassClusterResult } from './orchestrator';

export interface WriteSubsystemArtifactsOptions {
  /** Root for v2 artifacts, typically `<repo>/.engram/artifacts`. */
  artifactsRoot: string;
  writeFile?: (path: string, contents: string) => Promise<void>;
  mkdir?: (path: string, opts?: { recursive?: boolean }) => Promise<unknown>;
}

export interface SubsystemArtifactWriteResult {
  slug: string;
  filePath: string;
}

/**
 * Input bundle: the persisted subsystem + the cluster result it came from
 * (used to extract members + intent for the markdown body).
 */
export interface SubsystemArtifactInput {
  subsystem: SubsystemInput;
  /** Cluster result for tracking (token cost, truncation flag, fallback). */
  cluster: Pick<SubsystemPassClusterResult, 'clusterId' | 'tokenCost' | 'truncated' | 'nameFallback'>;
  /** Per-member intent text — used to render the module list in the body. */
  memberIntents?: Record<string, string | undefined>;
}

/**
 * Materialise every successfully-named subsystem to disk. Skipped clusters
 * (no LLM, invalid name, too-many-clusters) are omitted.
 */
export async function writeSubsystemArtifacts(
  artifacts: SubsystemArtifactInput[],
  opts: WriteSubsystemArtifactsOptions,
): Promise<SubsystemArtifactWriteResult[]> {
  const writeFile = opts.writeFile ?? fs.writeFile;
  const mkdir = opts.mkdir ?? fs.mkdir;
  const written: SubsystemArtifactWriteResult[] = [];

  for (const art of artifacts) {
    const filePath = join(opts.artifactsRoot, 'subsystems', `${art.subsystem.slug}.md`);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, renderArtifact(art));
    written.push({ slug: art.subsystem.slug, filePath });
  }

  return written;
}

function renderArtifact(art: SubsystemArtifactInput): string {
  const fm = [
    '---',
    `subsystem: ${art.subsystem.name}`,
    `slug: ${art.subsystem.slug}`,
    'pass: subsystem',
    `cluster_id: ${art.cluster.clusterId}`,
    `members: ${art.subsystem.memberModulePaths.length}`,
    `name_fallback: ${art.cluster.nameFallback}`,
    `truncated: ${art.cluster.truncated}`,
    `tokenCost: ${art.cluster.tokenCost}`,
    '---',
    '',
  ].join('\n');

  const members = art.subsystem.memberModulePaths.map((modulePath) => ({
    modulePath,
    intent: art.memberIntents?.[modulePath],
  }));

  return fm + renderSubsystemMarkdown(art.subsystem, members);
}
