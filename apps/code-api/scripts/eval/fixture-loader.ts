/**
 * Fixture loader for the Phase 2 eval harness (EC-29).
 *
 * Round-trips fixture cards through the real {@link writeCard} /
 * {@link readCard} writer so the harness exercises the same on-disk
 * format the indexing pipeline produces. The alternative (using the
 * in-memory fixture objects directly) would hide format regressions
 * between the fixtures and the writer.
 */

import { join } from 'node:path';

import { writeCard, readCard, cardFilePath } from '../../src/v2/writers/markdown/writer';
import type { Card } from '../../src/v2/writers/markdown/types';

import type { EvalRepoFixture } from './fixtures';

/**
 * Materialize a fixture to `<workdir>/<repoId>/.engram/artifacts/cards/`
 * and return a `Map<conceptPath, Card>` of the round-tripped cards.
 */
export async function materializeFixture(
  fixture: EvalRepoFixture,
  workdir: string,
): Promise<Map<string, Card>> {
  const artifactsRoot = join(workdir, fixture.repoId, '.engram', 'artifacts');
  for (const card of fixture.cards) {
    await writeCard(artifactsRoot, card);
  }
  const out = new Map<string, Card>();
  for (const card of fixture.cards) {
    const path = cardFilePath(artifactsRoot, card.conceptPath);
    const read = await readCard(path);
    out.set(read.conceptPath, read);
  }
  return out;
}
