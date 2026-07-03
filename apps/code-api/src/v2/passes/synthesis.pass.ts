/**
 * Synthesis pass (engram-code v2, Pass 6) — module-level LoD card generation.
 *
 * Scope (Phase 1, per docs/specs/engram-code-v2.md §7):
 *   - Module-level cards only. Subsystem + repository roll-ups are Phase 2.
 *   - Emits a single {@link Card} per module/file with all four LoD bodies
 *     populated:
 *       index    ~  15 tokens — deterministic one-liner from structure
 *       summary  ~ 100 tokens — deterministic top-exports paragraph
 *       standard ~ 500 tokens — LLM-synthesized (stubbed in Phase 1)
 *       deep     ~2000 tokens — LLM-synthesized (stubbed in Phase 1)
 *
 * Determinism: the two smallest LoDs are pure functions of the structure
 * input. The two larger LoDs delegate to {@link synthesizeWithLLM}, which is
 * a placeholder in Phase 1. Wiring a real Anthropic client is tracked under
 * EC-13 follow-up; see the `TODO(ec-13)` marker on that function.
 *
 * Token budgeting: we don't pull in `tiktoken` here — the dependency is not
 * present in this repo and Phase 1 doesn't need exact counts. Budgets are
 * enforced via {@link approxTokenCount} (4 chars ≈ 1 token), which is the
 * same heuristic OpenAI documents for English text. This is good enough to
 * keep the synthesizer well under any model's input limit and to give the
 * spec something concrete to assert against.
 */

import { createHash } from 'node:crypto';

import type {
  ParseResult,
  StructureEdge,
  StructureNode,
} from '../parsers/types';
import type { Card } from '../writers/markdown/types';

/**
 * Per-LoD approximate token budgets. These mirror the spec's "ACR-inspired
 * starting points" (15 / 100 / 500 / 2000) — tunable once we have real cards
 * on real repos (spec §10).
 */
export const LOD_TOKEN_BUDGETS = {
  index: 15,
  summary: 100,
  standard: 500,
  deep: 2000,
} as const;

/**
 * Approximate token count using the ubiquitous 4-chars-per-token heuristic.
 *
 * We use this instead of `tiktoken` for two reasons:
 *   1. `tiktoken` is not currently a dependency, and EC-13 is explicitly
 *      scoped to avoid rabbit holes (no new deps).
 *   2. Phase 1 budgets are advisory, not contractual — actual model-side
 *      tokenization is the source of truth when the real LLM client lands.
 *
 * The approximation is intentionally biased to overcount for short strings
 * (we round up), which is the safer direction for budget enforcement.
 */
export function approxTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Trim `text` so its approximate token count fits within `maxTokens`.
 *
 * Truncates on a character boundary rather than a token boundary — fine for
 * the heuristic, and avoids pulling in a tokenizer. If truncation occurs the
 * result is suffixed with a `…` to flag it for any human reader.
 */
export function clampToTokenBudget(text: string, maxTokens: number): string {
  if (approxTokenCount(text) <= maxTokens) return text;
  // -1 to leave room for the ellipsis under the same budget.
  const maxChars = Math.max(0, maxTokens * 4 - 1);
  return text.slice(0, maxChars) + '\u2026';
}

/**
 * Input to the synthesis pass.
 *
 * `structure` is the per-module slice of Pass 1 output. `source` is the raw
 * file text — optional because the deterministic LoDs don't need it and the
 * LLM-backed ones will when the real client is wired.
 */
export interface SynthesisInput {
  /**
   * Repo-relative module path used as the card's `conceptPath` (minus any
   * file extension). E.g. `src/v2/parsers/typescript.extractor`.
   */
  modulePath: string;
  /** Structure data for this module, typically the Pass 1 `ParseResult`. */
  structure: Pick<ParseResult, 'nodes' | 'edges' | 'language'>;
  /** Raw source text. Optional in Phase 1 (LLM is stubbed). */
  source?: string;
  /** ISO-8601 timestamp; injectable so tests can lock the value. */
  now?: string;
  /** Override the LLM call. Tests use this to assert prompt shape + budget. */
  llm?: LLMSynthesizer;
}

/** Signature for the (currently stubbed) LLM call. */
export type LLMSynthesizer = (
  prompt: string,
  maxTokens: number,
) => Promise<string>;

/**
 * Default LLM stub.
 *
 * Returns a deterministic placeholder string so tests don't need a model and
 * the writer downstream still gets non-empty content. The placeholder embeds
 * the requested budget so it's obvious in artifacts which body came from
 * the stub vs the real client (once wired).
 *
 * TODO(ec-13): wire real LLM client (Anthropic SDK). See EC-13 follow-up
 * ticket — needs config plumbing for API key + model selection per the
 * routing map in spec §4.4. Until then, callers that want real synthesis
 * must pass their own `llm` override via {@link SynthesisInput.llm}.
 */
export const synthesizeWithLLM: LLMSynthesizer = (prompt, maxTokens) => {
  void prompt; // intentionally unused in the stub
  return Promise.resolve(
    `[stub synthesis @ ${maxTokens} tokens] LLM client not yet wired (EC-13 follow-up).`,
  );
};

/**
 * Top-level entry point: synthesize a single module-level {@link Card}.
 */
export async function synthesizeModuleCard(
  input: SynthesisInput,
): Promise<Card> {
  const llm = input.llm ?? synthesizeWithLLM;
  const now = input.now ?? new Date().toISOString();

  const index = buildIndex(input);
  const summary = buildSummary(input);
  const standardPrompt = buildStandardPrompt(input);
  const deepPrompt = buildDeepPrompt(input);

  // Run the two LLM-backed levels concurrently — they don't depend on each
  // other and the stub returns instantly anyway.
  const [standardRaw, deepRaw] = await Promise.all([
    llm(standardPrompt, LOD_TOKEN_BUDGETS.standard),
    llm(deepPrompt, LOD_TOKEN_BUDGETS.deep),
  ]);

  const standard = clampToTokenBudget(standardRaw, LOD_TOKEN_BUDGETS.standard);
  const deep = clampToTokenBudget(deepRaw, LOD_TOKEN_BUDGETS.deep);

  return {
    conceptPath: input.modulePath,
    kind: 'module',
    lod: { index, summary, standard, deep },
    metadata: {
      generated_at: now,
      model: 'stub:ec-13',
      hash: contentHash(input),
      sources: sourcesFromStructure(input.structure),
      language: input.structure.language,
      lod_budgets: LOD_TOKEN_BUDGETS,
    },
  };
}

/**
 * Deterministic index line (~15 tokens).
 *
 * Format: `<modulePath> — <language> module: N exports, M functions, K classes`.
 * Designed to be greppable and to fit comfortably under budget for even
 * very long module paths (we clamp at the end).
 */
function buildIndex(input: SynthesisInput): string {
  const counts = countByKind(input.structure.nodes);
  const parts: string[] = [];
  if (counts.export) parts.push(`${counts.export} exports`);
  if (counts.function) parts.push(`${counts.function} functions`);
  if (counts.class) parts.push(`${counts.class} classes`);
  if (counts.interface) parts.push(`${counts.interface} interfaces`);
  const tail = parts.length > 0 ? parts.join(', ') : 'no top-level symbols';

  const line = `${input.modulePath} — ${input.structure.language} module: ${tail}`;
  return clampToTokenBudget(line, LOD_TOKEN_BUDGETS.index);
}

/**
 * Deterministic summary (~100 tokens).
 *
 * Lists the module path, language, and the top-N exported / public symbol
 * names. Phase 1 prefers `kind === 'export'` nodes, falling back to classes
 * and functions if the language extractor doesn't emit explicit exports.
 */
function buildSummary(input: SynthesisInput): string {
  const top = topPublicSymbols(input.structure.nodes, 8);
  const symbolList =
    top.length > 0
      ? top.map((s) => `\`${s}\``).join(', ')
      : '(no public symbols detected)';

  const text =
    `Module \`${input.modulePath}\` (${input.structure.language}). ` +
    `Public surface: ${symbolList}. ` +
    `Source: ${countByKind(input.structure.nodes).export ?? 0} exports across ` +
    `${input.structure.nodes.length} structure nodes, ${input.structure.edges.length} edges.`;

  return clampToTokenBudget(text, LOD_TOKEN_BUDGETS.summary);
}

/**
 * Build the prompt fed to the LLM for the `standard` (~500 token) body.
 *
 * Even though Phase 1's LLM call is stubbed, we still construct the prompt
 * — it lets the spec assert prompt shape and keeps the wiring obvious for
 * whoever lands the real client.
 */
export function buildStandardPrompt(input: SynthesisInput): string {
  const symbols = topPublicSymbols(input.structure.nodes, 20);
  return [
    `You are writing the STANDARD (~${LOD_TOKEN_BUDGETS.standard} token) LoD card for a code module.`,
    `Module: ${input.modulePath}`,
    `Language: ${input.structure.language}`,
    `Public symbols: ${symbols.join(', ') || '(none detected)'}`,
    `Node count: ${input.structure.nodes.length}; edge count: ${input.structure.edges.length}.`,
    `Write a focused description of what this module does, its public contracts,`,
    `and any non-obvious behavior. Stay under ${LOD_TOKEN_BUDGETS.standard} tokens.`,
  ].join('\n');
}

/**
 * Build the prompt for the `deep` (~2000 token) body.
 *
 * The deep prompt is allowed to include trimmed source text. We cap source
 * inclusion at roughly half the deep budget so the model has room to write.
 */
export function buildDeepPrompt(input: SynthesisInput): string {
  const sourceBudget = Math.floor(LOD_TOKEN_BUDGETS.deep / 2);
  const sourceExcerpt = input.source
    ? clampToTokenBudget(input.source, sourceBudget)
    : '(source not provided)';

  return [
    `You are writing the DEEP (~${LOD_TOKEN_BUDGETS.deep} token) LoD card for a code module.`,
    `Module: ${input.modulePath}`,
    `Language: ${input.structure.language}`,
    `Cover: intent, public contracts, key internals, gotchas, and one short example.`,
    `Stay under ${LOD_TOKEN_BUDGETS.deep} tokens.`,
    ``,
    `--- structure ---`,
    JSON.stringify(
      {
        nodes: input.structure.nodes.slice(0, 50),
        edges: input.structure.edges.slice(0, 50),
      },
      null,
      0,
    ),
    ``,
    `--- source (truncated) ---`,
    sourceExcerpt,
  ].join('\n');
}

/* ------------------------------------------------------------------ helpers */

/** Tally structure nodes by kind in one pass. */
function countByKind(
  nodes: StructureNode[],
): Partial<Record<StructureNode['kind'], number>> {
  const out: Partial<Record<StructureNode['kind'], number>> = {};
  for (const n of nodes) {
    out[n.kind] = (out[n.kind] ?? 0) + 1;
  }
  return out;
}

/**
 * Pick the top public-looking symbols from a structure. Preference order:
 *   1. `kind === 'export'` nodes (explicit exports)
 *   2. Top-level classes / interfaces / functions whose name does not start
 *      with `_` (a common convention for "package-private" across all three
 *      Phase 1 languages).
 *
 * Order within each tier is preserved from the input — extractors are
 * expected to emit nodes in source order, so this is stable.
 */
function topPublicSymbols(nodes: StructureNode[], limit: number): string[] {
  const exports = nodes.filter((n) => n.kind === 'export').map((n) => n.name);
  if (exports.length >= limit) return exports.slice(0, limit);

  const fallback = nodes
    .filter(
      (n) =>
        (n.kind === 'class' ||
          n.kind === 'interface' ||
          n.kind === 'function') &&
        !n.parent &&
        !n.name.startsWith('_'),
    )
    .map((n) => n.name);

  const seen = new Set<string>();
  const merged: string[] = [];
  for (const name of [...exports, ...fallback]) {
    if (seen.has(name)) continue;
    seen.add(name);
    merged.push(name);
    if (merged.length >= limit) break;
  }
  return merged;
}

/** Unique source file paths referenced by the structure. */
function sourcesFromStructure(
  structure: Pick<ParseResult, 'nodes' | 'edges'>,
): string[] {
  const set = new Set<string>();
  for (const n of structure.nodes) if (n.filePath) set.add(n.filePath);
  return Array.from(set).sort();
}

/**
 * Stable content hash of the synthesis input. Drives staleness detection in
 * the writer — see `Card.metadata.hash` in writers/markdown/types.ts.
 */
function contentHash(input: SynthesisInput): string {
  const h = createHash('sha256');
  h.update(input.modulePath);
  h.update('\u0000');
  h.update(input.structure.language);
  h.update('\u0000');
  // Sort to keep the hash insensitive to extractor ordering churn.
  const nodeKeys = input.structure.nodes
    .map(
      (n) =>
        `${n.kind}:${n.parent ?? ''}:${n.name}:${n.filePath}:${n.startLine}-${n.endLine}`,
    )
    .sort();
  for (const k of nodeKeys) {
    h.update(k);
    h.update('\u0000');
  }
  const edgeKeys: string[] = input.structure.edges
    .map((e: StructureEdge) => `${e.type}:${e.from}->${e.to}`)
    .sort();
  for (const k of edgeKeys) {
    h.update(k);
    h.update('\u0000');
  }
  if (input.source) h.update(input.source);
  return h.digest('hex').slice(0, 16);
}
