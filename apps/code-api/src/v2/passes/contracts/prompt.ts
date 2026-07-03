/**
 * Prompt assembly for the contracts pass (EC-23).
 *
 * The contracts pass is mostly mechanical (see `extractor.ts`). The LLM
 * step is small: given a batch of exported symbols + their signatures,
 * return a one-line semantic description + stability tag per symbol.
 *
 * Output is structured JSON keyed by symbol name so the orchestrator can
 * merge annotations back onto the mechanical extraction without parsing
 * markdown.
 *
 * Spec: docs/specs/engram-code-v2.md §4.2 Pass 3.
 */

import { approxTokenCount, clampToTokenBudget } from '../synthesis.pass';
import type { ContractSymbol } from './extractor';

/** Stability tags the LLM is asked to pick from. */
export const CONTRACT_STABILITIES = ['stable', 'experimental', 'internal'] as const;
export type ContractStability = (typeof CONTRACT_STABILITIES)[number];

/** Hard ceiling on the prompt input. */
export const DEFAULT_MAX_INPUT_TOKENS = 6_000;
/** Output budget for the annotation JSON. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 1_200;

export interface ContractPromptInput {
  /** Repo-relative module path. */
  modulePath: string;
  /** Language tag — folded into the prompt for tone. */
  language: string;
  /** Symbols to annotate. */
  symbols: ContractSymbol[];
  /** Optional intent.md content for the module (Pass 2 output) for context. */
  intent?: string;
  /** Override prompt token budget. */
  maxInputTokens?: number;
}

export interface BuiltContractPrompt {
  system: string;
  prompt: string;
  estimatedTokens: number;
  /** Whether the symbol list was truncated to fit. */
  truncated: boolean;
  /** Symbol names actually included in the prompt (after truncation). */
  includedNames: string[];
}

export const CONTRACTS_SYSTEM_PROMPT = `You are a senior engineer documenting a module's public API.
For each exported symbol you receive, return:

  - "description": ONE sentence (≤ 25 words) describing what the symbol does. No marketing. No "this function". Start with a verb when possible.
  - "stability": one of "stable" | "experimental" | "internal".
    * "stable" — typical public API; safe to use.
    * "experimental" — signature/behaviour may change; obvious "Beta", "draft", "experimental" naming, or symbols clearly under active design.
    * "internal" — exported but conventionally private (leading underscore, "Internal", "_internal", or explicit comment).

Reply with a SINGLE JSON object: { "<symbolName>": { "description": "...", "stability": "..." }, ... }.
No prose, no markdown, no code fences. If you cannot describe a symbol, set description to "" and stability to "stable".`;

/**
 * Build the prompt. Symbols are listed in alphabetical order (already
 * sorted by the extractor). If they don't all fit in the input budget,
 * the lowest-priority tail is dropped and `truncated=true` is set.
 *
 * Priority order: typed kinds (function/class/interface/method) ahead of
 * bare `export` nodes, then by signature length descending so symbols
 * with the most type information survive.
 */
export function buildContractsPrompt(input: ContractPromptInput): BuiltContractPrompt {
  const maxIn = input.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS;
  const intentBlock = input.intent
    ? `\n\nModule intent (for context):\n${clampToTokenBudget(input.intent, 1_000)}`
    : '';

  const framing =
    `Module: \`${input.modulePath}\`  ·  Language: \`${input.language}\`${intentBlock}\n\n` +
    `Symbols (annotate each by name):\n\n`;
  const footer = `\n\nReturn the JSON object now.`;
  const framingTokens =
    approxTokenCount(framing) +
    approxTokenCount(footer) +
    approxTokenCount(CONTRACTS_SYSTEM_PROMPT);
  const symbolBudget = Math.max(0, maxIn - framingTokens - 200);

  const prioritised = prioritise(input.symbols);
  const lines: string[] = [];
  const included: string[] = [];
  let consumed = 0;
  let truncated = false;

  for (const sym of prioritised) {
    const sig = sym.signature ? sym.signature : '(no signature)';
    const line = `- \`${sym.name}\` (${sym.kind})  ::  ${sig}`;
    const cost = approxTokenCount(line);
    if (consumed + cost > symbolBudget && included.length > 0) {
      truncated = true;
      break;
    }
    lines.push(line);
    included.push(sym.name);
    consumed += cost;
  }

  const prompt = framing + lines.join('\n') + footer;
  return {
    system: CONTRACTS_SYSTEM_PROMPT,
    prompt,
    estimatedTokens: approxTokenCount(prompt) + approxTokenCount(CONTRACTS_SYSTEM_PROMPT),
    truncated,
    includedNames: included,
  };
}

function prioritise(symbols: ContractSymbol[]): ContractSymbol[] {
  const score = (s: ContractSymbol): number => {
    const kindScore = s.kind === 'export' ? 0 : 10;
    const sigScore = Math.min(20, s.signature.length / 20);
    return kindScore + sigScore;
  };
  return [...symbols].sort((a, b) => {
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Parse the LLM's JSON response into a map keyed by symbol name. Tolerates
 * stray prose / code fences by extracting the first {...} block.
 *
 * Symbols missing from the response are reported in `missing`.
 */
export function parseContractsResponse(
  raw: string,
  expectedNames: string[],
): { annotations: Map<string, ContractAnnotation>; missing: string[] } {
  const annotations = new Map<string, ContractAnnotation>();
  const jsonStr = extractJsonObject(raw);
  if (!jsonStr) return { annotations, missing: [...expectedNames] };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return { annotations, missing: [...expectedNames] };
  }

  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== 'object' || value === null) continue;
    const v = value as { description?: unknown; stability?: unknown };
    const description = typeof v.description === 'string' ? v.description.trim() : '';
    const stability = isStability(v.stability) ? v.stability : 'stable';
    annotations.set(name, { description, stability });
  }
  const missing = expectedNames.filter((n) => !annotations.has(n));
  return { annotations, missing };
}

export interface ContractAnnotation {
  description: string;
  stability: ContractStability;
}

function isStability(v: unknown): v is ContractStability {
  return typeof v === 'string' && (CONTRACT_STABILITIES as readonly string[]).includes(v);
}

function extractJsonObject(raw: string): string | null {
  // Strip ``` fences if present, then locate the first '{' and matching '}'.
  const stripped = raw.replace(/```(?:json)?\n?/gi, '').replace(/```/g, '');
  const start = stripped.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return stripped.slice(start, i + 1);
    }
  }
  return null;
}
