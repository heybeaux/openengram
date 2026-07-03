/**
 * Contracts pass orchestrator (engram-code v2, Pass 3).
 *
 * Walks the per-module symbol lists produced by `extractor.ts`, asks an LLM
 * for a one-line description + stability tag per symbol, and emits:
 *   - a markdown `contracts.md` table per module (via `writer.ts`)
 *   - a `CardInput` per module ready for persistence
 *
 * Modules with zero exported symbols are skipped quietly.
 *
 * Spec: docs/specs/engram-code-v2.md §4.2 Pass 3, §4.4 (model routing).
 */

import type { CardInput, PassRunInput } from '../../types/cards';
import {
  callOpenRouter,
  type LLMClient,
} from '../../llm/openrouter';
import type { ContractModuleSymbols } from './extractor';
import {
  buildContractsPrompt,
  DEFAULT_MAX_INPUT_TOKENS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  parseContractsResponse,
  type ContractAnnotation,
  type ContractStability,
} from './prompt';

/**
 * Per spec §4.4 — Sonnet is the contracts model. It's better at terse,
 * precise one-liners than Flash. Gemini Flash is the fallback.
 */
export const CONTRACTS_DEFAULT_MODEL = 'anthropic/claude-sonnet-4-6';
export const CONTRACTS_FALLBACK_MODEL = 'google/gemini-2.5-flash';

/** Total-tokens cap for one contracts run across all modules. */
export const CONTRACTS_DEFAULT_RUN_TOKEN_CAP = 200_000;

export interface ContractsModuleResult {
  modulePath: string;
  /** Annotated symbols. Empty array when the module had no exports. */
  symbols: AnnotatedSymbol[];
  /** Card payload for persistence. Null when nothing to emit. */
  card: CardInput | null;
  /** Reason for an empty result; populated only when `card` is null. */
  skipReason?: 'no-symbols' | 'budget-exceeded' | 'llm-error';
  /** Error message when `skipReason === 'llm-error'`. */
  errorMessage?: string;
  /** Token cost reported by the LLM. Zero on skip. */
  tokenCost: number;
  /** Whether the prompt was truncated (some symbols not annotated). */
  truncated: boolean;
}

export interface AnnotatedSymbol {
  name: string;
  kind: string;
  signature: string;
  filePath: string;
  startLine: number;
  description: string;
  stability: ContractStability;
}

export interface ContractsPassOptions {
  llm?: LLMClient;
  model?: string;
  fallbackModel?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  runTokenCap?: number;
  /** Resolve per-module intent.md content (Pass 2 output) for prompt context. */
  resolveIntent?: (modulePath: string) => string | undefined;
}

export interface ContractsPassResult {
  repoId: string;
  modules: ContractsModuleResult[];
  totalTokens: number;
  passRun: PassRunInput;
}

/**
 * Run the contracts pass over a list of module symbol bundles.
 *
 * Like the intent pass, this function is pure-ish: no disk, no network
 * unless you pass the real `callOpenRouter`. The writer (`writer.ts`)
 * handles markdown emission.
 */
export async function runContractsPass(
  repoId: string,
  modules: ContractModuleSymbols[],
  opts: ContractsPassOptions = {},
): Promise<ContractsPassResult> {
  const llm = opts.llm ?? callOpenRouter;
  const model = opts.model ?? CONTRACTS_DEFAULT_MODEL;
  const fallbackModel = opts.fallbackModel ?? CONTRACTS_FALLBACK_MODEL;
  const maxInputTokens = opts.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS;
  const maxOutputTokens = opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const runCap = opts.runTokenCap ?? CONTRACTS_DEFAULT_RUN_TOKEN_CAP;

  const startedAt = new Date();
  const results: ContractsModuleResult[] = [];
  let totalTokens = 0;

  for (const mod of modules) {
    if (mod.symbols.length === 0) {
      results.push({
        modulePath: mod.modulePath,
        symbols: [],
        card: null,
        skipReason: 'no-symbols',
        tokenCost: 0,
        truncated: false,
      });
      continue;
    }

    if (totalTokens >= runCap) {
      results.push({
        modulePath: mod.modulePath,
        symbols: [],
        card: null,
        skipReason: 'budget-exceeded',
        tokenCost: 0,
        truncated: false,
      });
      continue;
    }

    const built = buildContractsPrompt({
      modulePath: mod.modulePath,
      language: mod.language,
      symbols: mod.symbols,
      intent: opts.resolveIntent?.(mod.modulePath),
      maxInputTokens,
    });

    try {
      const response = await llm({
        model,
        fallbackModel,
        prompt: built.prompt,
        system: built.system,
        maxOutputTokens,
      });
      totalTokens += response.totalTokens;

      const { annotations } = parseContractsResponse(
        response.content,
        built.includedNames,
      );

      const annotated = mod.symbols.map((s) => mergeAnnotation(s, annotations.get(s.name)));
      const card: CardInput = {
        repoId,
        conceptPath: `${repoId}/${mod.modulePath}`,
        lod: 'STANDARD',
        level: 'MODULE',
        content: renderContractsMarkdown(mod.modulePath, annotated),
        sourcePass: 'contracts',
        tokenCount: response.completionTokens,
      };

      results.push({
        modulePath: mod.modulePath,
        symbols: annotated,
        card,
        tokenCost: response.totalTokens,
        truncated: built.truncated,
      });
    } catch (err) {
      results.push({
        modulePath: mod.modulePath,
        symbols: [],
        card: null,
        skipReason: 'llm-error',
        errorMessage: (err as Error).message,
        tokenCost: 0,
        truncated: built.truncated,
      });
    }
  }

  const finishedAt = new Date();
  const succeeded = results.filter((r) => r.card !== null).length;
  const failed = results.filter((r) => r.skipReason === 'llm-error').length;

  const passRun: PassRunInput = {
    repoId,
    passName: 'contracts',
    status: failed > 0 && succeeded === 0 ? 'FAILED' : 'SUCCESS',
    model,
    tokenCost: totalTokens,
    startedAt,
    finishedAt,
    errorMessage:
      failed > 0 ? `${failed}/${modules.length} module(s) failed` : undefined,
  };

  return { repoId, modules: results, totalTokens, passRun };
}

function mergeAnnotation(
  symbol: ContractModuleSymbols['symbols'][number],
  annotation: ContractAnnotation | undefined,
): AnnotatedSymbol {
  return {
    name: symbol.name,
    kind: symbol.kind,
    signature: symbol.signature,
    filePath: symbol.filePath,
    startLine: symbol.startLine,
    description: annotation?.description ?? '',
    stability: annotation?.stability ?? 'stable',
  };
}

/**
 * Render the per-module contract table. Exposed so the writer (and tests)
 * can call it without needing the full pass.
 */
export function renderContractsMarkdown(
  modulePath: string,
  symbols: AnnotatedSymbol[],
): string {
  const header = `## Contracts: ${modulePath}\n\n`;
  if (symbols.length === 0) return header + '_(no exports)_';
  const tableHeader =
    '| Symbol | Kind | Signature | Description | Stability |\n' +
    '|---|---|---|---|---|';
  const rows = symbols.map((s) => {
    const sig = escapeCell(s.signature || '_(none)_');
    const desc = escapeCell(s.description || '_(unannotated)_');
    return `| \`${s.name}\` | ${s.kind} | ${sig} | ${desc} | ${s.stability} |`;
  });
  return header + tableHeader + '\n' + rows.join('\n');
}

function escapeCell(s: string): string {
  // Markdown table cells: escape `|` and collapse whitespace.
  return s.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
}
