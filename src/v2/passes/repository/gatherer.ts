/**
 * Input assembly for the repository-level synthesis pass (EC-26).
 *
 * Pass 6 extension: where the module synthesizer (synthesis.pass.ts) writes
 * per-module cards and the subsystem synthesizer (EC-25) writes per-subsystem
 * cards, this layer rolls those subsystem cards up into a single repository
 * card.
 *
 * Inputs gathered:
 *   - All subsystem cards (STANDARD-level — keeps the input prompt under the
 *     4k budget; the spec uses standard, not deep, intentionally).
 *   - Repository metadata: name, language list, top-level directories,
 *     trimmed README.md excerpt.
 *
 * This module is pure: no fs, no DB. The orchestrator hands it a
 * pre-resolved set of subsystem rows + a pre-read README string. Tests can
 * exercise it without any I/O at all.
 *
 * Spec: docs/specs/engram-code-v2.md §4.2 Pass 6, §4.3 Conceptual hierarchy.
 */

import type { SubsystemInput } from '../../types/cards';
import { approxTokenCount, clampToTokenBudget } from '../synthesis.pass';

/**
 * One subsystem entry as consumed by the repository prompt. The orchestrator
 * derives these from `Subsystem` rows + the cluster results, so we can carry
 * the synthesized standard-card markdown directly.
 */
export interface SubsystemSummary {
  /** Human-facing subsystem name (e.g. "Auth"). */
  name: string;
  /** URL/path-safe slug (matches `Subsystem.slug` in the DB). */
  slug: string;
  /** One-line description from the subsystem namer. May be empty. */
  description?: string;
  /** Member module paths — count is shown in the prompt for sizing. */
  memberModulePaths: string[];
  /**
   * The STANDARD-level subsystem card body produced by EC-25. Used as the
   * primary signal for repository synthesis — richer than just the
   * description but bounded to ~500 tokens each.
   */
  standardCard?: string;
}

/** Repository-level metadata fed to the prompt. */
export interface RepositoryMetadata {
  /** Display name of the repo (e.g. "engram-code"). */
  name: string;
  /** Languages detected by Pass 1 (e.g. ["typescript", "go"]). */
  languages: string[];
  /** Top-level directories under the repo root (sorted, deduped). */
  topLevelDirs: string[];
  /** Trimmed README.md content. Optional — many repos lack one. */
  readme?: string;
}

/** Per-LoD approximate token budgets — mirror the module synthesizer. */
export const REPOSITORY_LOD_TOKEN_BUDGETS = {
  index: 15,
  summary: 100,
  standard: 500,
  deep: 2000,
} as const;

/** Hard cap on input fed to the LLM. EC-26 ticket constraint. */
export const REPOSITORY_MAX_INPUT_TOKENS = 4_000;

/**
 * Bundle handed to the prompt builder + orchestrator. Pure data — same
 * input ⇒ same prompt ⇒ deterministic-up-to-the-LLM output.
 */
export interface RepositoryInput {
  metadata: RepositoryMetadata;
  subsystems: SubsystemSummary[];
}

/**
 * Convert `Subsystem` rows + matching standard cards into the lighter
 * {@link SubsystemSummary} shape. Callers typically pull subsystems from the
 * DB and the cards from a parallel query keyed on `(repoId, conceptPath, lod=STANDARD)`.
 *
 * The `cardLookup` callback returns the standard card body for a given slug.
 * Missing cards are tolerated — the description still feeds the prompt.
 */
export function summarizeSubsystems(
  subsystems: SubsystemInput[],
  cardLookup?: (slug: string) => string | undefined,
): SubsystemSummary[] {
  return [...subsystems]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((s) => ({
      name: s.name,
      slug: s.slug,
      description: s.description,
      memberModulePaths: [...s.memberModulePaths],
      standardCard: cardLookup?.(s.slug),
    }));
}

/**
 * Trim a README to fit roughly half the repository-prompt budget. The other
 * half is reserved for subsystem cards + framing.
 *
 * Empty/whitespace input returns `undefined` so the prompt can omit the
 * README section entirely instead of printing a blank header.
 */
export function trimReadme(
  readme: string | undefined,
  maxTokens = Math.floor(REPOSITORY_MAX_INPUT_TOKENS / 4),
): string | undefined {
  if (!readme) return undefined;
  const trimmed = readme.trim();
  if (!trimmed) return undefined;
  return clampToTokenBudget(trimmed, maxTokens);
}

/**
 * Estimate the input-token cost of the gathered material before any prompt
 * framing — useful for budget pre-flight checks in the orchestrator.
 */
export function estimateInputTokens(input: RepositoryInput): number {
  let total = 0;
  total += approxTokenCount(input.metadata.name);
  total += approxTokenCount(input.metadata.languages.join(','));
  total += approxTokenCount(input.metadata.topLevelDirs.join(','));
  if (input.metadata.readme) total += approxTokenCount(input.metadata.readme);
  for (const s of input.subsystems) {
    total += approxTokenCount(s.name);
    total += approxTokenCount(s.description ?? '');
    total += approxTokenCount(s.standardCard ?? '');
  }
  return total;
}
