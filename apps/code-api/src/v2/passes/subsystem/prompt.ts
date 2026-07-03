/**
 * Prompt assembly for the subsystem-naming step (EC-25).
 *
 * Given a cluster of modules — their intent summaries from Pass 2 + their
 * top file paths — ask the LLM for a short human-friendly subsystem name +
 * a one-line description.
 *
 * Output is a SINGLE compact JSON object. We deliberately avoid asking the
 * model to produce the slug — slugs are derived deterministically from the
 * name in {@link slugifyName}, so the LLM only has to think about the
 * human-readable label.
 *
 * Spec: docs/specs/engram-code-v2.md §4.2 Pass 4.
 */

import { approxTokenCount, clampToTokenBudget } from '../synthesis.pass';

/** Hard ceiling on the prompt input. */
export const DEFAULT_MAX_INPUT_TOKENS = 4_000;
/** Output budget — name + ~120-char description is tiny. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 200;

/**
 * Per-cluster snippet passed to the LLM. Each module contributes its
 * intent summary (truncated) and a sample of its file paths.
 */
export interface SubsystemPromptInput {
  /** Stable cluster id from the detector — surfaced in the prompt for trace. */
  clusterId: number;
  /** Members with optional intent + top file paths. */
  members: Array<{
    modulePath: string;
    intent?: string;
    topFiles?: string[];
  }>;
  /** Override prompt token budget. */
  maxInputTokens?: number;
}

export interface BuiltSubsystemPrompt {
  system: string;
  prompt: string;
  estimatedTokens: number;
  /** Whether the member list was truncated to fit the budget. */
  truncated: boolean;
}

export const SUBSYSTEM_SYSTEM_PROMPT = `You are a senior engineer naming a newly-discovered subsystem of a codebase.
You will receive a cluster of modules — their paths, intent summaries, and a few representative files.

Reply with a SINGLE JSON object, no prose, no code fences:

  { "name": "<2–4 word human name>", "description": "<one sentence, ≤120 chars>" }

Rules for "name":
  - 2–4 words, Title Case (e.g. "Auth", "Ingestion Pipeline", "Payment Gateway").
  - 3–40 characters total. Use only letters, digits, spaces, hyphens.
  - Describe what the cluster IS, not where it lives. Do NOT use file/dir names verbatim.
  - Prefer the noun for the *capability* (e.g. "Search", "Telemetry") over verbs.
  - If the cluster is heterogeneous, pick the dominant theme. Do not invent.

Rules for "description":
  - One sentence, ≤120 chars. Start with a noun phrase ("Handles…", "Provides…", "Owns…").
  - No marketing. No hedging ("seems to", "looks like").`;

/**
 * Build the naming prompt for one cluster. Members are listed in path order,
 * truncated by intent-length when they don't all fit.
 */
export function buildSubsystemPrompt(input: SubsystemPromptInput): BuiltSubsystemPrompt {
  const maxIn = input.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS;
  const framing =
    `Cluster #${input.clusterId} — ${input.members.length} module(s).\n\n` +
    `Members:\n\n`;
  const footer = `\n\nReturn the JSON object now.`;
  const framingTokens =
    approxTokenCount(framing) +
    approxTokenCount(footer) +
    approxTokenCount(SUBSYSTEM_SYSTEM_PROMPT);
  const memberBudget = Math.max(0, maxIn - framingTokens - 200);

  // Members ordered by path so the same cluster always produces the same prompt.
  const ordered = [...input.members].sort((a, b) =>
    a.modulePath.localeCompare(b.modulePath),
  );

  // Per-member token slice — split the budget evenly so one verbose intent
  // can't crowd everyone else out.
  const perMember = ordered.length > 0 ? Math.max(120, Math.floor(memberBudget / ordered.length)) : 0;

  const lines: string[] = [];
  let consumed = 0;
  let truncated = false;

  for (const m of ordered) {
    const intentBlock = m.intent
      ? clampToTokenBudget(m.intent.trim(), Math.max(60, perMember - 40))
      : '_(no intent recorded)_';
    const fileBlock =
      m.topFiles && m.topFiles.length > 0
        ? `\n  files: ${m.topFiles.slice(0, 5).join(', ')}`
        : '';
    const block = `- \`${m.modulePath}\`${fileBlock}\n  intent: ${intentBlock}`;
    const cost = approxTokenCount(block);
    if (consumed + cost > memberBudget && lines.length > 0) {
      truncated = true;
      break;
    }
    lines.push(block);
    consumed += cost;
  }

  const prompt = framing + lines.join('\n\n') + footer;
  return {
    system: SUBSYSTEM_SYSTEM_PROMPT,
    prompt,
    estimatedTokens: approxTokenCount(prompt) + approxTokenCount(SUBSYSTEM_SYSTEM_PROMPT),
    truncated,
  };
}

export interface SubsystemNamingResponse {
  name: string;
  description: string;
}

/**
 * Parse the LLM response. Tolerates stray prose / code fences by extracting
 * the first balanced `{...}` block. Returns `null` when no usable JSON
 * object is present — the orchestrator falls back to a deterministic name.
 */
export function parseSubsystemResponse(raw: string): SubsystemNamingResponse | null {
  const jsonStr = extractJsonObject(raw);
  if (!jsonStr) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const v = parsed as { name?: unknown; description?: unknown };
  const name = typeof v.name === 'string' ? v.name.trim() : '';
  const description = typeof v.description === 'string' ? v.description.trim() : '';
  if (!name) return null;
  return { name, description };
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
