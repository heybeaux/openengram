/**
 * Repository index writer (EC-14).
 *
 * Emits `<rootDir>/INDEX.md`: a single markdown table that links to every
 * card under `<rootDir>/cards/`. Agents (and humans) hit this file first to
 * discover what concepts exist for a given repo without round-tripping
 * through the database.
 *
 * The index is rebuildable from the cards on disk; it is never the source
 * of truth. Re-run after any card add/remove/rename.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { Card } from './types';
import { cardFilePath } from './writer';

/**
 * A repository's identity + its set of cards. Kept structurally minimal so
 * upstream callers (the synthesis pass) don't need to import anything
 * heavier than `Card` to invoke the writer.
 */
export interface RepoIndexInput {
  name: string;
  cards: Card[];
}

/**
 * Write `<rootDir>/INDEX.md` linking to every card.
 *
 * Cards are sorted by `kind` (repository → subsystem → module → capability)
 * and then `conceptPath` ascending so the rendered table is stable across
 * runs — important for diff hygiene when this file is committed.
 *
 * Returns the absolute path of the written INDEX.md.
 */
export async function writeRepoIndex(
  rootDir: string,
  repo: RepoIndexInput,
): Promise<string> {
  const indexPath = join(rootDir, 'INDEX.md');
  await mkdir(dirname(indexPath), { recursive: true });
  const body = renderIndex(rootDir, repo);
  await writeFile(indexPath, body, 'utf8');
  return isAbsolute(indexPath) ? indexPath : resolve(indexPath);
}

const KIND_ORDER: Record<Card['kind'], number> = {
  repository: 0,
  subsystem: 1,
  module: 2,
  capability: 3,
};

function renderIndex(rootDir: string, repo: RepoIndexInput): string {
  const sorted = [...repo.cards].sort((a, b) => {
    const k = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (k !== 0) return k;
    return a.conceptPath.localeCompare(b.conceptPath);
  });

  const header = `# ${repo.name}\n\nGenerated index of ${sorted.length} card${sorted.length === 1 ? '' : 's'}.\n\n`;

  if (sorted.length === 0) {
    return header + '_No cards yet._\n';
  }

  const rows = sorted.map((card) => {
    const link = toIndexRelativeLink(rootDir, card.conceptPath);
    return `| \`${card.conceptPath}\` | ${card.kind} | [card](${link}) |`;
  });

  return (
    header +
    '| Concept | Kind | Link |\n' +
    '| --- | --- | --- |\n' +
    rows.join('\n') +
    '\n'
  );
}

/**
 * Compute the on-disk relative link from `INDEX.md` to the card file.
 *
 * Always emitted with forward slashes, regardless of host OS, so the
 * committed index renders correctly on every platform.
 */
function toIndexRelativeLink(rootDir: string, conceptPath: string): string {
  const cardAbs = cardFilePath(rootDir, conceptPath);
  const rel = relative(rootDir, cardAbs);
  return rel.split(sep).join('/');
}
