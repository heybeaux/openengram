/**
 * Gotchas pass orchestrator (engram-code v2, Pass 5).
 *
 * Pipeline per module:
 *   1. Structural detection (NO LLM) — produces a candidate list.
 *   2. Skip modules with zero candidates (per spec — absent file, not empty).
 *   3. One LLM call per surviving module to filter + rewrite as a bullet list.
 *   4. Hard guardrail: at most `maxLLMCalls` calls per run (default 200);
 *      modules past that limit are reported with `skipReason='call-cap'`.
 *   5. Emit a `CardInput` per module ready for persistence.
 *
 * Spec: docs/specs/engram-code-v2.md §4.2 Pass 5, §4.4 (model routing).
 */

import type { CardInput, PassRunInput } from '../../types/cards';
import {
  callOpenRouter,
  type LLMClient,
} from '../../llm/openrouter';
import {
  detectModuleGotchas,
  type DetectGotchasInput,
  type GotchaCandidate,
  type GotchaModuleCandidates,
} from './detector';
import {
  buildGotchasPrompt,
  DEFAULT_MAX_INPUT_TOKENS,
  DEFAULT_MAX_OUTPUT_TOKENS,
} from './prompt';

/** Per spec §4.4 — Sonnet for gotchas (judgment-heavy work). */
export const GOTCHAS_DEFAULT_MODEL = 'anthropic/claude-sonnet-4-6';
export const GOTCHAS_FALLBACK_MODEL = 'google/gemini-2.5-flash';

/** Hard cap on LLM calls in one run. */
export const GOTCHAS_DEFAULT_CALL_CAP = 200;
/** Total-tokens guardrail for one run. */
export const GOTCHAS_DEFAULT_RUN_TOKEN_CAP = 200_000;

export interface GotchasModuleResult {
  modulePath: string;
  /** Candidate count from the structural detector. */
  candidateCount: number;
  /** Final bullet-list markdown (LLM output). Null when skipped. */
  gotchas: string | null;
  /** Card payload for persistence. Null when skipped. */
  card: CardInput | null;
  skipReason?: 'no-candidates' | 'call-cap' | 'budget-exceeded' | 'llm-error';
  errorMessage?: string;
  tokenCost: number;
  truncated: boolean;
}

export interface GotchasPassOptions {
  llm?: LLMClient;
  model?: string;
  fallbackModel?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  runTokenCap?: number;
  /** Hard cap on LLM calls per run (per spec). */
  maxLLMCalls?: number;
  /** Optional per-module intent.md (Pass 2 output) for prompt context. */
  resolveIntent?: (modulePath: string) => string | undefined;
}

export interface GotchasPassResult {
  repoId: string;
  modules: GotchasModuleResult[];
  totalTokens: number;
  llmCalls: number;
  passRun: PassRunInput;
}

/**
 * Run the gotchas pass. Accepts pre-bundled module inputs so the
 * orchestrator stays I/O-free; the caller is responsible for reading
 * sources + sibling docs off disk.
 */
export async function runGotchasPass(
  repoId: string,
  modules: DetectGotchasInput[],
  opts: GotchasPassOptions = {},
): Promise<GotchasPassResult> {
  const llm = opts.llm ?? callOpenRouter;
  const model = opts.model ?? GOTCHAS_DEFAULT_MODEL;
  const fallbackModel = opts.fallbackModel ?? GOTCHAS_FALLBACK_MODEL;
  const maxInputTokens = opts.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS;
  const maxOutputTokens = opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const runCap = opts.runTokenCap ?? GOTCHAS_DEFAULT_RUN_TOKEN_CAP;
  const callCap = opts.maxLLMCalls ?? GOTCHAS_DEFAULT_CALL_CAP;

  const startedAt = new Date();
  const results: GotchasModuleResult[] = [];
  let totalTokens = 0;
  let llmCalls = 0;

  for (const input of modules) {
    const detected = detectModuleGotchas(input);
    const candidateCount = detected.candidates.length;

    if (candidateCount === 0) {
      results.push({
        modulePath: detected.modulePath,
        candidateCount: 0,
        gotchas: null,
        card: null,
        skipReason: 'no-candidates',
        tokenCost: 0,
        truncated: false,
      });
      continue;
    }

    if (llmCalls >= callCap) {
      results.push({
        modulePath: detected.modulePath,
        candidateCount,
        gotchas: null,
        card: null,
        skipReason: 'call-cap',
        tokenCost: 0,
        truncated: false,
      });
      continue;
    }

    if (totalTokens >= runCap) {
      results.push({
        modulePath: detected.modulePath,
        candidateCount,
        gotchas: null,
        card: null,
        skipReason: 'budget-exceeded',
        tokenCost: 0,
        truncated: false,
      });
      continue;
    }

    const built = buildGotchasPrompt({
      modulePath: detected.modulePath,
      candidates: detected.candidates,
      intent: opts.resolveIntent?.(detected.modulePath),
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
      llmCalls += 1;
      totalTokens += response.totalTokens;

      const content = renderGotchasMarkdown(detected.modulePath, response.content);
      const card: CardInput = {
        repoId,
        conceptPath: `${repoId}/${detected.modulePath}`,
        lod: 'STANDARD',
        level: 'MODULE',
        content,
        sourcePass: 'gotchas',
        tokenCount: response.completionTokens,
      };

      results.push({
        modulePath: detected.modulePath,
        candidateCount,
        gotchas: response.content,
        card,
        tokenCost: response.totalTokens,
        truncated: built.truncated,
      });
    } catch (err) {
      llmCalls += 1; // count the attempt against the cap
      results.push({
        modulePath: detected.modulePath,
        candidateCount,
        gotchas: null,
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
    passName: 'gotchas',
    status: failed > 0 && succeeded === 0 ? 'FAILED' : 'SUCCESS',
    model,
    tokenCost: totalTokens,
    startedAt,
    finishedAt,
    errorMessage: failed > 0 ? `${failed}/${modules.length} module(s) failed` : undefined,
  };

  return { repoId, modules: results, totalTokens, llmCalls, passRun };
}

/**
 * Wrap the LLM output in a header so the markdown card is self-identifying.
 * Exposed for tests + the writer.
 */
export function renderGotchasMarkdown(modulePath: string, llmBody: string): string {
  const trimmed = llmBody.trim();
  return `## Gotchas: ${modulePath}\n\n${trimmed || '_(no real gotchas)_'}`;
}

/** Re-export for callers that want both halves of the pass in one import. */
export type { GotchaCandidate, GotchaModuleCandidates };
