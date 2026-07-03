/**
 * Disk writer for the repository-level synthesis artifact (EC-26).
 *
 * Emits `<artifactsRoot>/repository.md`. Mirrors the subsystem writer's
 * style — YAML frontmatter for provenance, then the standard-LoD body for
 * humans. The other LoDs (index/summary/deep) live in the DB; the on-disk
 * artifact is intentionally the human-facing default tier.
 *
 * fs ops are pluggable for tests.
 */

import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

import type { CardInput } from '../../types/cards';

import type { RepositoryInput } from './gatherer';
import type { RepositoryPassLodResult } from './orchestrator';

export interface RepositoryArtifactInput {
  /** Repo id, used in frontmatter for traceability. */
  repoId: string;
  /** The full input bundle — name/languages/subsystem count surface here. */
  input: RepositoryInput;
  /** All four LoD cards from the orchestrator. */
  cards: CardInput[];
  /** Per-LoD bookkeeping — fallback/truncation flags + token cost. */
  lods: RepositoryPassLodResult[];
  /** Sum of LLM tokens across the run. */
  totalTokens: number;
  /** Model identifier (e.g. "anthropic/claude-opus-4-7"). */
  model: string;
}

export interface WriteRepositoryArtifactOptions {
  /** Root for v2 artifacts, typically `<repo>/.engram/artifacts`. */
  artifactsRoot: string;
  writeFile?: (path: string, contents: string) => Promise<void>;
  mkdir?: (path: string, opts?: { recursive?: boolean }) => Promise<unknown>;
}

export interface RepositoryArtifactWriteResult {
  filePath: string;
  bytes: number;
}

/**
 * Materialise the repository.md artifact at `<artifactsRoot>/repository.md`.
 */
export async function writeRepositoryArtifact(
  art: RepositoryArtifactInput,
  opts: WriteRepositoryArtifactOptions,
): Promise<RepositoryArtifactWriteResult> {
  const writeFile = opts.writeFile ?? fs.writeFile;
  const mkdir = opts.mkdir ?? fs.mkdir;

  const filePath = join(opts.artifactsRoot, 'repository.md');
  const body = renderArtifact(art);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, body);

  return { filePath, bytes: Buffer.byteLength(body, 'utf8') };
}

/**
 * Build the artifact body. Exposed for tests + for the orchestrator if it
 * ever needs to log the rendered artifact without touching disk.
 */
export function renderArtifact(art: RepositoryArtifactInput): string {
  const standardCard = art.cards.find((c) => c.lod === 'STANDARD');
  const indexCard = art.cards.find((c) => c.lod === 'INDEX');
  const summaryCard = art.cards.find((c) => c.lod === 'SUMMARY');
  const deepCard = art.cards.find((c) => c.lod === 'DEEP');

  const lodSummary = art.lods
    .map((l) => `${l.lod.toLowerCase()}: { fallback: ${l.fallback}, tokens: ${l.tokenCost} }`)
    .join(', ');

  const fm = [
    '---',
    `repo: ${art.input.metadata.name}`,
    `repo_id: ${art.repoId}`,
    'pass: synthesis-repository',
    `model: ${art.model}`,
    `languages: ${art.input.metadata.languages.join(', ') || '(none)'}`,
    `subsystems: ${art.input.subsystems.length}`,
    `total_tokens: ${art.totalTokens}`,
    `lod_summary: ${lodSummary}`,
    '---',
    '',
  ].join('\n');

  // Body: short header → standard card → reference list of subsystems →
  // index/summary/deep linked at the bottom for greppability.
  const header = `# Repository: ${art.input.metadata.name}\n\n`;
  const oneLine = indexCard ? `> ${indexCard.content}\n\n` : '';
  const summaryBlock = summaryCard
    ? `## Summary\n\n${summaryCard.content}\n\n`
    : '';
  const standardBlock = standardCard
    ? `## Overview\n\n${standardCard.content}\n\n`
    : '';
  const deepBlock = deepCard ? `## Deep\n\n${deepCard.content}\n\n` : '';

  const subsystemList = art.input.subsystems.length
    ? art.input.subsystems
        .map((s) => {
          const desc = s.description ? ` — ${s.description}` : '';
          return `- \`${s.slug}\` (${s.name})${desc}`;
        })
        .join('\n')
    : '_(no subsystems discovered)_';
  const subsystemSection = `## Subsystems\n\n${subsystemList}\n`;

  return (
    fm +
    header +
    oneLine +
    summaryBlock +
    standardBlock +
    subsystemSection +
    '\n' +
    deepBlock
  );
}
