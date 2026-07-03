/**
 * Prompt assembly for the gotchas pass (EC-24).
 *
 * Given a module's structural candidates (tag comments, long docstrings,
 * sibling docs, convention outliers), ask the LLM to produce a tight
 * bullet list of "watch out" notes. Output is markdown — not JSON —
 * because the orchestrator persists it verbatim into the gotchas card.
 *
 * Spec: docs/specs/engram-code-v2.md §4.2 Pass 5.
 */

import { approxTokenCount, clampToTokenBudget } from '../synthesis.pass';
import type { GotchaCandidate } from './detector';

export const DEFAULT_MAX_INPUT_TOKENS = 6_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 800;

export interface GotchasPromptInput {
  /** Repo-relative module path. */
  modulePath: string;
  /** Candidates uncovered by the structural detector. */
  candidates: GotchaCandidate[];
  /** Optional intent.md for context. */
  intent?: string;
  /** Override token budget. */
  maxInputTokens?: number;
}

export interface BuiltGotchasPrompt {
  system: string;
  prompt: string;
  estimatedTokens: number;
  truncated: boolean;
  /** Candidate count actually included in the prompt. */
  includedCount: number;
}

export const GOTCHAS_SYSTEM_PROMPT = `You are a senior engineer onboarding a new teammate.
You receive a list of *candidate* gotchas for a single module — comments tagged TODO/FIXME/HACK/etc., long docstrings, sibling README/ADR text, and convention outliers. Your job is to filter and rewrite them as a tight bullet list of true "watch out" notes a new teammate needs to know.

Rules:
- Markdown bullet list ONLY. No headings, no preamble, no closing summary.
- Skip noise: editorial fluff, marketing language, generic explanations, anything not actionable.
- Combine duplicates ("3 files all mention X" → one bullet).
- Each bullet ≤ 25 words. Direct, technical, no hedging.
- Reference the file when concrete: \`path/to/file.ts:L42 — ...\`
- If a candidate is a docstring that just explains what the code does, drop it.
- If the whole list is noise after filtering, return the single line: \`_(no real gotchas)_\``;

/**
 * Build the prompt. Candidates are packed in priority order (tag comments
 * first — usually the most actionable — then outliers, then docstrings,
 * then sibling docs) and trimmed to fit the input budget.
 */
export function buildGotchasPrompt(input: GotchasPromptInput): BuiltGotchasPrompt {
  const maxIn = input.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS;
  const intentBlock = input.intent
    ? `\n\nModule intent (for context):\n${clampToTokenBudget(input.intent, 800)}`
    : '';

  const framing =
    `Module: \`${input.modulePath}\`${intentBlock}\n\n` +
    `Candidate gotchas (filter and rewrite):\n\n`;
  const footer = `\n\nReturn the bullet list now.`;
  const framingTokens =
    approxTokenCount(framing) +
    approxTokenCount(footer) +
    approxTokenCount(GOTCHAS_SYSTEM_PROMPT);
  const candidateBudget = Math.max(0, maxIn - framingTokens - 200);

  const prioritised = prioritise(input.candidates);
  const blocks: string[] = [];
  let consumed = 0;
  let truncated = false;
  let included = 0;

  for (const c of prioritised) {
    const block = formatCandidate(c);
    const cost = approxTokenCount(block);
    if (consumed + cost > candidateBudget && included > 0) {
      truncated = true;
      break;
    }
    blocks.push(block);
    consumed += cost;
    included += 1;
  }

  const prompt = framing + blocks.join('\n') + footer;
  return {
    system: GOTCHAS_SYSTEM_PROMPT,
    prompt,
    estimatedTokens: approxTokenCount(prompt) + approxTokenCount(GOTCHAS_SYSTEM_PROMPT),
    truncated,
    includedCount: included,
  };
}

function prioritise(candidates: GotchaCandidate[]): GotchaCandidate[] {
  const rank: Record<GotchaCandidate['kind'], number> = {
    'tag-comment': 0,
    'convention-outlier': 1,
    'long-docstring': 2,
    'sibling-doc': 3,
  };
  return [...candidates].sort((a, b) => {
    const diff = rank[a.kind] - rank[b.kind];
    if (diff !== 0) return diff;
    if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
    return a.line - b.line;
  });
}

function formatCandidate(c: GotchaCandidate): string {
  const meta = c.metadata ? formatMeta(c.metadata) : '';
  return `- [${c.kind}${meta}] \`${c.filePath}:L${c.line}\`\n  ${c.excerpt}`;
}

function formatMeta(meta: Record<string, unknown>): string {
  const pairs = Object.entries(meta).map(([k, v]) => `${k}=${stringify(v)}`);
  return pairs.length > 0 ? ` (${pairs.join(', ')})` : '';
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}
