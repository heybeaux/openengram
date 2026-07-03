/**
 * Prompt assembly for repository-level synthesis (EC-26).
 *
 * One prompt is built per LoD body (summary / standard / deep) — the
 * `index` line is deterministic. We share the same framing across all three
 * but vary the target budget + the instructions the model gets.
 *
 * Input budget: hard-capped at {@link REPOSITORY_MAX_INPUT_TOKENS} (4k per
 * the EC-26 ticket). Subsystem standard cards are listed in slug order and
 * truncated when the budget runs out — the truncation flag is surfaced on
 * the build result so callers can warn.
 *
 * Spec: docs/specs/engram-code-v2.md §4.2 Pass 6 (synthesis), §4.4 (model
 * routing — repository tier uses Opus).
 */

import { approxTokenCount, clampToTokenBudget } from '../synthesis.pass';

import {
  REPOSITORY_LOD_TOKEN_BUDGETS,
  REPOSITORY_MAX_INPUT_TOKENS,
  type RepositoryInput,
} from './gatherer';

/** LoDs that come from the LLM. `index` is deterministic and never prompted. */
export type LlmLod = 'summary' | 'standard' | 'deep';

export interface BuiltRepositoryPrompt {
  system: string;
  prompt: string;
  /** Target LoD; mirrors the caller's request so logs match up. */
  lod: LlmLod;
  /** Hard ceiling we asked the model to stay under. */
  maxOutputTokens: number;
  /** Approximate input tokens (system + user). */
  estimatedInputTokens: number;
  /** True when the subsystem list had to be trimmed to fit the budget. */
  truncated: boolean;
}

export const REPOSITORY_SYSTEM_PROMPT = `You are a senior staff engineer writing the top-level summary of an entire codebase.
You will receive: the repo name, languages, top-level directories, a README excerpt, and STANDARD-level cards for every discovered subsystem.

Write for an engineer who has never seen this codebase. Lead with what the system DOES, not how it is organised.

Style rules:
  - Prose. No bullet lists at the summary/standard tiers; the deep tier may use short bullets sparingly.
  - No marketing language ("revolutionary", "robust", "seamless").
  - No hedging ("seems to", "appears to be").
  - Refer to concrete subsystems by name when relevant ("the Ingestion subsystem owns…").
  - Do not invent capabilities not represented in the inputs.

Stay under the requested token budget — exceeding it will get truncated.`;

/**
 * Build the repository-synthesis prompt for one LoD.
 */
export function buildRepositoryPrompt(
  input: RepositoryInput,
  lod: LlmLod,
  options: { maxInputTokens?: number } = {},
): BuiltRepositoryPrompt {
  const maxIn = options.maxInputTokens ?? REPOSITORY_MAX_INPUT_TOKENS;
  const maxOutputTokens = REPOSITORY_LOD_TOKEN_BUDGETS[lod];

  const instructions = lodInstructions(lod, maxOutputTokens);
  const header = buildHeader(input);
  const readmeBlock = input.metadata.readme
    ? `\n--- README excerpt ---\n${input.metadata.readme}\n--- end README ---\n`
    : '';
  const footer = `\n\nWrite the ${lod.toUpperCase()} (~${maxOutputTokens} token) repository card now. Stay under ${maxOutputTokens} tokens.`;

  // Token bookkeeping: everything except the subsystem list is fixed cost.
  const fixedCost =
    approxTokenCount(REPOSITORY_SYSTEM_PROMPT) +
    approxTokenCount(instructions) +
    approxTokenCount(header) +
    approxTokenCount(readmeBlock) +
    approxTokenCount(footer);

  // Reserve 200 tokens of slack so we don't squeeze the model.
  const subsystemBudget = Math.max(0, maxIn - fixedCost - 200);

  // Subsystems in slug order — same input ⇒ same prompt.
  const ordered = [...input.subsystems].sort((a, b) =>
    a.slug.localeCompare(b.slug),
  );

  const blocks: string[] = [];
  let consumed = 0;
  let truncated = false;

  // Per-subsystem token slice so one huge card can't crowd out the others.
  const perSubsystem =
    ordered.length > 0
      ? Math.max(120, Math.floor(subsystemBudget / ordered.length))
      : 0;

  for (const s of ordered) {
    const description = s.description ? ` — ${s.description}` : '';
    const cardBody = s.standardCard
      ? clampToTokenBudget(s.standardCard.trim(), Math.max(80, perSubsystem - 30))
      : '_(no standard card)_';
    const block =
      `### Subsystem: ${s.name} (\`${s.slug}\`)${description}\n` +
      `modules: ${s.memberModulePaths.length}\n\n` +
      cardBody;

    const cost = approxTokenCount(block);
    if (consumed + cost > subsystemBudget && blocks.length > 0) {
      truncated = true;
      break;
    }
    blocks.push(block);
    consumed += cost;
  }

  const subsystemSection = blocks.length
    ? `\n--- subsystems (${blocks.length}/${ordered.length}) ---\n\n${blocks.join('\n\n')}\n`
    : `\n--- subsystems ---\n_(no subsystems discovered)_\n`;

  const prompt = instructions + header + readmeBlock + subsystemSection + footer;

  return {
    system: REPOSITORY_SYSTEM_PROMPT,
    prompt,
    lod,
    maxOutputTokens,
    estimatedInputTokens:
      approxTokenCount(prompt) + approxTokenCount(REPOSITORY_SYSTEM_PROMPT),
    truncated,
  };
}

function lodInstructions(lod: LlmLod, budget: number): string {
  switch (lod) {
    case 'summary':
      return (
        `Write the SUMMARY (~${budget} token) repository card.\n` +
        `One short paragraph. State what the codebase does and the 2–3 most ` +
        `important subsystems. No headings.\n\n`
      );
    case 'standard':
      return (
        `Write the STANDARD (~${budget} token) repository card.\n` +
        `2–4 paragraphs. Cover: what the codebase does, the major subsystems ` +
        `and how they relate, and any cross-cutting concerns visible in the ` +
        `subsystem cards. No headings.\n\n`
      );
    case 'deep':
      return (
        `Write the DEEP (~${budget} token) repository card.\n` +
        `Use level-2 markdown headings for: Overview, Subsystems, ` +
        `Cross-cutting concerns, Notable patterns. Be specific — name ` +
        `subsystems, reference their responsibilities. Short bullets OK ` +
        `under the Subsystems heading.\n\n`
      );
  }
}

function buildHeader(input: RepositoryInput): string {
  const langs = input.metadata.languages.length
    ? input.metadata.languages.join(', ')
    : '(none detected)';
  const dirs = input.metadata.topLevelDirs.length
    ? input.metadata.topLevelDirs.join(', ')
    : '(none detected)';
  return (
    `Repository: ${input.metadata.name}\n` +
    `Languages: ${langs}\n` +
    `Top-level directories: ${dirs}\n` +
    `Discovered subsystems: ${input.subsystems.length}\n`
  );
}
