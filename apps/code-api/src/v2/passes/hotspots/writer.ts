/**
 * Hotspots card writer (engram-code v2, Pass 4 — EC-45).
 *
 * Persists the cards produced by {@link runHotspotsPass} to the on-disk
 * markdown store via {@link writeCard}, so `/v1/cards/<conceptPath>` can
 * serve them through the existing controller.
 *
 * Why a dedicated writer module (rather than inlining into `runSynth` like
 * the older passes do): hotspots emits up to `maxCards + 1` cards in one
 * pass, and the per-card metadata + LoD layout differs from the
 * contracts/gotchas convention (we fill `index`/`summary` deterministically
 * from the score, not from `firstParagraph`). Keeping the rendering rules
 * here means the spec assertions can target this module directly.
 *
 * Spec: Linear EC-45.
 */

import type { Card } from '../../writers/markdown/types';
import { writeCard } from '../../writers/markdown/writer';
import type { CardInput } from '../../types/cards';

import { hotspotsRollupConceptPath } from './orchestrator';

/** Result returned to the caller for logging / summary purposes. */
export interface WriteHotspotCardsResult {
  /** Total cards written (module + roll-up). */
  cardsWritten: number;
  /** Subset that are MODULE-level (one per hotspot file). */
  moduleCards: number;
  /** Always 0 or 1 — the REPOSITORY-level roll-up. */
  rollupCards: number;
}

export interface WriteHotspotCardsOptions {
  /** Artifacts root (e.g. `<repo>/.engram/artifacts`). */
  outDir: string;
  /** Repo id used to strip the `${repoId}/` prefix from concept paths. */
  repoId: string;
  /** Cards as emitted by the orchestrator. */
  cards: CardInput[];
  /**
   * Test seam: replace the underlying write. Defaults to the markdown
   * writer used by the rest of the synth pipeline. The signature matches
   * the real `writeCard` exactly so the seam stays trivial.
   */
  write?: (rootDir: string, card: Card) => Promise<string>;
}

/**
 * Persist the hotspots-pass cards to disk.
 *
 * Each card is rendered into the canonical markdown shape with the four
 * LoDs filled in:
 *   - index   — `<conceptPath> — hotspot score X.XXX`
 *   - summary — first paragraph of the orchestrator body
 *   - standard — full orchestrator body
 *   - deep    — same as standard for v1 (richer body is a follow-up)
 *
 * `last_pass` metadata is stamped to `hotspots` so the dashboard can
 * differentiate from contracts/gotchas cards at the same module path.
 */
export async function writeHotspotCards(
  opts: WriteHotspotCardsOptions,
): Promise<WriteHotspotCardsResult> {
  const write = opts.write ?? writeCard;
  let moduleCards = 0;
  let rollupCards = 0;

  for (const cardInput of opts.cards) {
    const conceptPath = stripRepoPrefix(cardInput.conceptPath, opts.repoId);
    const isRollup =
      cardInput.conceptPath === hotspotsRollupConceptPath(opts.repoId);

    const card: Card = {
      conceptPath,
      kind: isRollup ? 'repository' : 'module',
      lod: {
        index: buildIndex(conceptPath, cardInput.content, isRollup),
        summary: firstParagraph(cardInput.content),
        standard: cardInput.content,
        // Until an LLM-backed enrichment lands (deferred follow-up), the
        // standard body *is* the deepest representation we have.
        deep: cardInput.content,
      },
      metadata: {
        generated_at: new Date().toISOString(),
        repo_id: opts.repoId,
        last_pass: 'hotspots',
        ...(isRollup ? { kind: 'hotspots-rollup' } : {}),
      },
    };
    await write(opts.outDir, card);
    if (isRollup) rollupCards += 1;
    else moduleCards += 1;
  }

  return { cardsWritten: moduleCards + rollupCards, moduleCards, rollupCards };
}

/**
 * Strip the leading `${repoId}/` from a card's `conceptPath` so the on-disk
 * path is repo-relative. Mirrors the helper inlined into the older writers
 * in `synth.ts` — kept local so this module has no dependency on private
 * helpers there.
 */
function stripRepoPrefix(conceptPath: string, repoId: string): string {
  return conceptPath.startsWith(`${repoId}/`)
    ? conceptPath.slice(repoId.length + 1)
    : conceptPath;
}

/**
 * Build the one-liner shown in card listings. For the roll-up we surface
 * "repository hotspots" verbatim; for module cards we pull the score out
 * of the body so the index reads naturally even before the user opens it.
 */
function buildIndex(conceptPath: string, body: string, isRollup: boolean): string {
  if (isRollup) return `${conceptPath} — repository hotspots`;
  const scoreLine = body
    .split('\n')
    .find((l) => l.startsWith('**Score:**'));
  if (!scoreLine) return `${conceptPath} — hotspot`;
  // Format from orchestrator: "**Score:** 0.812 (0..1, …)"
  const m = scoreLine.match(/\*\*Score:\*\*\s+([0-9.]+)/);
  const score = m ? m[1] : '?';
  return `${conceptPath} — hotspot score ${score}`;
}

/**
 * First paragraph of the body, capped at 400 chars. Same heuristic used
 * by `writeModuleCards` in `synth.ts`. Duplicating it here keeps this
 * module self-contained — the helper there is private to that file.
 */
function firstParagraph(body: string): string {
  const idx = body.indexOf('\n\n');
  const para = idx === -1 ? body : body.slice(0, idx);
  return para.trim().slice(0, 400);
}
