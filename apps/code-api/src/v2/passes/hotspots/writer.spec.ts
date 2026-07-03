/**
 * Tests for the hotspots card writer (EC-45).
 *
 * Uses the `write` injection seam so we never touch the real filesystem.
 * The substituted writer captures every call so we can assert on what
 * would have been persisted.
 */

import type { Card } from '../../writers/markdown/types';
import type { CardInput } from '../../types/cards';

import { hotspotsRollupConceptPath } from './orchestrator';
import { writeHotspotCards } from './writer';

function moduleCard(repoId: string, filePath: string, score = 0.812): CardInput {
  const body = [
    `# Hotspot: ${filePath}`,
    '',
    `**Score:** ${score.toFixed(3)} (0..1, higher = riskier)`,
    '',
    '## Axis breakdown',
    '',
    '- Churn: 50%',
  ].join('\n');
  return {
    repoId,
    conceptPath: `${repoId}/${filePath}`,
    lod: 'STANDARD',
    level: 'MODULE',
    content: body,
    sourcePass: 'hotspots',
  };
}

function rollupCard(repoId: string): CardInput {
  return {
    repoId,
    conceptPath: hotspotsRollupConceptPath(repoId),
    lod: 'STANDARD',
    level: 'REPOSITORY',
    content: [
      '# Repository hotspots',
      '',
      'Scored 5 files across four signals.',
      '',
      '## Top hotspots',
      '',
      '- `src/hot.ts` — score 0.812',
    ].join('\n'),
    sourcePass: 'hotspots',
  };
}

describe('writeHotspotCards', () => {
  const repoId = 'demo-repo';
  const outDir = '/tmp/out';

  /** Capture every write so tests can introspect. */
  function makeCapturingWriter() {
    const writes: Array<{ rootDir: string; card: Card }> = [];
    const write = async (rootDir: string, card: Card): Promise<string> => {
      writes.push({ rootDir, card });
      return `${rootDir}/${card.conceptPath}.md`;
    };
    return { writes, write };
  }

  it('writes one card per input and returns module/rollup counts', async () => {
    const { writes, write } = makeCapturingWriter();
    const cards: CardInput[] = [
      moduleCard(repoId, 'src/hot.ts'),
      moduleCard(repoId, 'src/mid.ts', 0.41),
      rollupCard(repoId),
    ];
    const result = await writeHotspotCards({ outDir, repoId, cards, write });

    expect(result.cardsWritten).toBe(3);
    expect(result.moduleCards).toBe(2);
    expect(result.rollupCards).toBe(1);
    expect(writes).toHaveLength(3);
    for (const w of writes) {
      expect(w.rootDir).toBe(outDir);
    }
  });

  it('strips the leading repoId/ prefix from module concept paths', async () => {
    const { writes, write } = makeCapturingWriter();
    await writeHotspotCards({
      outDir,
      repoId,
      cards: [moduleCard(repoId, 'src/hot.ts')],
      write,
    });
    expect(writes[0].card.conceptPath).toBe('src/hot.ts');
    expect(writes[0].card.kind).toBe('module');
  });

  it('tags the rollup card with kind=repository and a hotspots-rollup metadata flag', async () => {
    const { writes, write } = makeCapturingWriter();
    await writeHotspotCards({
      outDir,
      repoId,
      cards: [rollupCard(repoId)],
      write,
    });
    expect(writes).toHaveLength(1);
    expect(writes[0].card.kind).toBe('repository');
    expect(writes[0].card.conceptPath).toBe('hotspots');
    expect(writes[0].card.metadata).toMatchObject({
      repo_id: repoId,
      last_pass: 'hotspots',
      kind: 'hotspots-rollup',
    });
  });

  it('fills every LoD slot on the persisted card', async () => {
    const { writes, write } = makeCapturingWriter();
    await writeHotspotCards({
      outDir,
      repoId,
      cards: [moduleCard(repoId, 'src/hot.ts', 0.812)],
      write,
    });
    const card = writes[0].card;
    expect(card.lod.standard).toContain('# Hotspot: src/hot.ts');
    expect(card.lod.deep).toBe(card.lod.standard);
    expect(card.lod.summary).toContain('Hotspot: src/hot.ts');
    // Index pulls the numeric score out of the body — the format is
    // documented in the orchestrator and pinned here so a future change
    // can't silently drop it.
    expect(card.lod.index).toBe('src/hot.ts — hotspot score 0.812');
  });

  it('falls back to a generic index when the body lacks a Score: line', async () => {
    const { writes, write } = makeCapturingWriter();
    const c: CardInput = {
      repoId,
      conceptPath: `${repoId}/src/weird.ts`,
      lod: 'STANDARD',
      level: 'MODULE',
      content: '# Hotspot: src/weird.ts\n\nno score line here',
      sourcePass: 'hotspots',
    };
    await writeHotspotCards({ outDir, repoId, cards: [c], write });
    expect(writes[0].card.lod.index).toBe('src/weird.ts — hotspot');
  });

  it('stamps generated_at as a parseable ISO string', async () => {
    const { writes, write } = makeCapturingWriter();
    await writeHotspotCards({
      outDir,
      repoId,
      cards: [rollupCard(repoId)],
      write,
    });
    const generatedAt = writes[0].card.metadata.generated_at as string;
    expect(typeof generatedAt).toBe('string');
    expect(Number.isNaN(Date.parse(generatedAt))).toBe(false);
  });

  it('handles an empty card list without throwing', async () => {
    const { writes, write } = makeCapturingWriter();
    const result = await writeHotspotCards({
      outDir,
      repoId,
      cards: [],
      write,
    });
    expect(result.cardsWritten).toBe(0);
    expect(result.moduleCards).toBe(0);
    expect(result.rollupCards).toBe(0);
    expect(writes).toHaveLength(0);
  });
});
