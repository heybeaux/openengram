/**
 * Types for the engram-code v2 markdown artifact writer (EC-14).
 *
 * Cards are the primary substrate for v2: each one is a level-of-detail
 * (LoD) summary of a concept in a repository, written to disk as markdown
 * with YAML frontmatter. Postgres `cards` rows are a derived index.
 *
 * Spec: docs/specs/engram-code-v2.md (sections 4.5 Storage, Pass 6 Synthesis).
 */

/**
 * The four LoD tiers exposed by a card.
 *
 * Approximate token budgets (tunable, see spec open question 4):
 *   - index   ~  15 tokens — one-liner, used for navigation/menus.
 *   - summary ~ 100 tokens — short paragraph, used for overview tables.
 *   - standard ~ 500 tokens — full description with key facts.
 *   - deep    ~2000 tokens — exhaustive treatment for detailed reasoning.
 */
export interface LoDContent {
  index: string;
  summary: string;
  standard: string;
  deep: string;
}

/**
 * The conceptual scope a card describes.
 *
 * Mirrors the synthesis rollup hierarchy in the spec:
 *   repository → subsystem → module → capability.
 */
export type CardKind = 'repository' | 'subsystem' | 'module' | 'capability';

/**
 * A single LoD card.
 *
 * `conceptPath` is the canonical identity (e.g. `engram/ingestion/parsers/typescript`).
 * It doubles as the on-disk relative path under `<rootDir>/cards/`, with a
 * `.md` suffix appended by the writer. Renames are tracked separately via
 * `graph_edges` (out of scope here).
 */
export interface Card {
  /** Slash-delimited concept identifier; becomes the on-disk path. */
  conceptPath: string;
  /** Rollup scope this card describes. */
  kind: CardKind;
  /** All four LoD bodies. Any of them MAY be empty strings. */
  lod: LoDContent;
  /**
   * Free-form metadata serialized as YAML frontmatter. Conventional keys:
   *   - generated_at: ISO-8601 timestamp
   *   - model: synthesizer model id
   *   - hash: content hash of inputs (used for staleness detection)
   *   - sources: string[] of source file paths
   * Unknown keys round-trip verbatim.
   */
  metadata: Record<string, unknown>;
}
