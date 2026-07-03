/**
 * Prompt assembly for the intent pass (EC-22).
 *
 * Given a module's Pass 1 structure slice + a sample of its source, produce
 * a prompt that asks the LLM "what is this module *for*?" — purpose,
 * responsibilities, what it owns.
 *
 * Token budgeting is intentionally cheap: we use the 4-chars-per-token
 * heuristic shared with the synthesis pass (Pass 6) and size-rank-truncate
 * the source sample. We avoid pulling in `tiktoken` for the same reasons
 * called out in `synthesis.pass.ts`.
 *
 * Spec: docs/specs/engram-code-v2.md §4.2 Pass 2.
 */

import { approxTokenCount, clampToTokenBudget } from '../synthesis.pass';
import type { ParseResult, StructureNode } from '../../parsers/types';

/** Hard ceiling on prompt input. Modules over this get truncated. */
export const DEFAULT_MAX_INPUT_TOKENS = 8_000;
/** Desired output range — passed to the model via `max_tokens`. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 600;

/** Inputs the orchestrator hands to `buildIntentPrompt`. */
export interface IntentPromptInput {
  /** Repo-relative module path. Used in the prompt header. */
  modulePath: string;
  /** Pass 1 structure slice for the module. */
  structure: Pick<ParseResult, 'nodes' | 'edges' | 'language'>;
  /** Files belonging to this module, with optional source bodies. */
  files: Array<{ path: string; source?: string }>;
  /** Optional README/docstring sibling, surfaced verbatim. */
  readme?: string;
  /** Optional token budget override. */
  maxInputTokens?: number;
}

export interface BuiltPrompt {
  system: string;
  prompt: string;
  /** Approximate prompt tokens (heuristic). Useful for ledger accounting. */
  estimatedTokens: number;
  /** Whether the source sample was truncated to fit. */
  truncated: boolean;
}

export const INTENT_SYSTEM_PROMPT = `You are a senior engineer onboarding a new teammate to a codebase.
For each module you receive, produce a concise "intent" note — 200–500 words — that answers:

  1. **Purpose.** What is this module *for*? Why does it exist?
  2. **Responsibilities.** What does it own? What does it deliberately not own?
  3. **Key concepts.** The 2–5 names a reader needs to know (classes/types/functions/protocols).
  4. **Where it sits.** How it relates to its imports + exports (do not list them exhaustively — describe the shape).

Tone: direct, technical, no marketing. Markdown. No heading above H2.
Do NOT restate the file/dir paths verbatim — assume the reader can see the file tree.
Do NOT speculate. If the purpose isn't clear from the source, say so.`;

/**
 * Assemble the intent prompt. Source is appended file-by-file, ordered by
 * size *descending* so the most-substantial files survive truncation.
 */
export function buildIntentPrompt(input: IntentPromptInput): BuiltPrompt {
  const maxIn = input.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS;
  const header = buildHeader(input.modulePath, input.structure);
  const symbolList = buildSymbolList(input.structure.nodes);
  const readmeBlock = input.readme
    ? `\n\n### README\n\n${clampToTokenBudget(input.readme, 1_500)}`
    : '';

  // Build the framing once so we can compute how many tokens remain for source.
  const framing =
    `## Module: ${input.modulePath}\n\n${header}\n\n` +
    `### Exported symbols\n\n${symbolList}${readmeBlock}\n\n### Source sample\n\n`;
  const framingTokens = approxTokenCount(framing) + approxTokenCount(INTENT_SYSTEM_PROMPT);

  // Reserve ~400 tokens of overhead for the user instruction footer.
  const sourceBudget = Math.max(0, maxIn - framingTokens - 400);

  const sortedFiles = [...input.files].sort(
    (a, b) => (b.source?.length ?? 0) - (a.source?.length ?? 0),
  );
  const { sourceBlock, truncated } = packSourceBlock(sortedFiles, sourceBudget);

  const footer = `\n\n### Task\n\nWrite the intent note for this module. Follow the system rules.`;
  const prompt = framing + sourceBlock + footer;

  return {
    system: INTENT_SYSTEM_PROMPT,
    prompt,
    estimatedTokens: approxTokenCount(prompt) + approxTokenCount(INTENT_SYSTEM_PROMPT),
    truncated,
  };
}

function buildHeader(modulePath: string, structure: IntentPromptInput['structure']): string {
  const language = structure.language ?? 'unknown';
  const nodeCount = structure.nodes.length;
  const edgeCount = structure.edges.length;
  return `Language: \`${language}\` · Nodes: ${nodeCount} · Edges: ${edgeCount}`;
}

function buildSymbolList(nodes: StructureNode[]): string {
  const exported = nodes.filter((n) => (n as { exported?: boolean }).exported !== false);
  if (exported.length === 0) return '_(none extracted)_';
  const items = exported
    .slice(0, 30)
    .map((n) => `- \`${n.name}\` (${n.kind})`)
    .join('\n');
  const overflow = exported.length > 30 ? `\n- _…and ${exported.length - 30} more_` : '';
  return items + overflow;
}

interface PackedSource {
  sourceBlock: string;
  truncated: boolean;
}

function packSourceBlock(
  files: Array<{ path: string; source?: string }>,
  budgetTokens: number,
): PackedSource {
  if (budgetTokens <= 0 || files.length === 0) {
    return { sourceBlock: '_(no source bundled)_', truncated: files.length > 0 };
  }

  const parts: string[] = [];
  let consumed = 0;
  let truncated = false;

  for (const file of files) {
    if (!file.source) continue;
    const fileHeader = `\n#### \`${file.path}\`\n\n\`\`\`\n`;
    const fileFooter = '\n```\n';
    const overhead = approxTokenCount(fileHeader) + approxTokenCount(fileFooter);
    const remaining = budgetTokens - consumed - overhead;
    if (remaining <= 50) {
      truncated = true;
      break;
    }
    const body = clampToTokenBudget(file.source, remaining);
    if (body.length < file.source.length) truncated = true;
    parts.push(fileHeader + body + fileFooter);
    consumed += approxTokenCount(body) + overhead;
    if (consumed >= budgetTokens) {
      truncated = true;
      break;
    }
  }

  if (parts.length === 0) {
    return { sourceBlock: '_(no source bundled)_', truncated: false };
  }
  return { sourceBlock: parts.join(''), truncated };
}
