/**
 * Repository-level synthesis pass orchestrator (engram-code v2, Pass 6 extension).
 *
 * Inputs:
 *   - All discovered subsystems (`SubsystemInput[]`) with their STANDARD
 *     cards (the EC-25 output).
 *   - Repository metadata: name, languages, top-level directories, README.
 *
 * Output: four {@link CardInput} rows at `level=REPOSITORY`, one per LoD
 * (`INDEX`, `SUMMARY`, `STANDARD`, `DEEP`) plus a {@link PassRunInput} for
 * the conductor's ledger.
 *
 *   - `index`    — deterministic one-liner (no LLM call)
 *   - `summary`  — Opus, ~100 tokens
 *   - `standard` — Opus, ~500 tokens
 *   - `deep`     — Opus, ~2000 tokens
 *
 * Model routing (spec §4.4): default = Opus. Default fallback = Gemini Pro,
 * matching the subsystem-tier routing. Caller can override either.
 *
 * Pure-ish: LLM and Prisma clients are injected. fs lives in the sibling
 * `writer.ts`. Persistence is idempotent — composite key is
 * `(repoId, conceptPath, lod)` where `conceptPath` is always
 * `${repoId}/repository`.
 *
 * Spec: docs/specs/engram-code-v2.md §4.2 Pass 6, §4.4 (model routing),
 *       §4.5 (storage model).
 */

import type { PrismaClient } from '@prisma/client';

import {
  callOpenRouter,
  type LLMClient,
} from '../../llm/openrouter';
import type {
  CardInput,
  LodLiteral,
  PassRunInput,
} from '../../types/cards';
import {
  approxTokenCount,
  clampToTokenBudget,
} from '../synthesis.pass';

import {
  estimateInputTokens,
  REPOSITORY_LOD_TOKEN_BUDGETS,
  REPOSITORY_MAX_INPUT_TOKENS,
  type RepositoryInput,
  type SubsystemSummary,
} from './gatherer';
import { buildRepositoryPrompt, type LlmLod } from './prompt';

/** Per spec §4.4 — Opus primary, Gemini Pro fallback for repository tier. */
export const REPOSITORY_DEFAULT_MODEL = 'anthropic/claude-opus-4-7';
export const REPOSITORY_FALLBACK_MODEL = 'google/gemini-2.5-pro';

/** Per-run token cap. Repository synthesis is three small LLM calls. */
export const REPOSITORY_DEFAULT_RUN_TOKEN_CAP = 50_000;

/** Concept path used for all repository cards. Single row per LoD. */
export function repositoryConceptPath(repoId: string): string {
  return `${repoId}/repository`;
}

export interface RepositoryPassOptions {
  llm?: LLMClient;
  model?: string;
  fallbackModel?: string;
  maxInputTokens?: number;
  runTokenCap?: number;
  /**
   * Hook for the conductor to log structured warnings. Falls back to
   * `console.warn` unless `quietWarnings: true`.
   */
  onWarning?: (message: string, context?: Record<string, unknown>) => void;
  quietWarnings?: boolean;
}

export interface RepositoryPassLodResult {
  lod: LodLiteral;
  /** Tokens charged for this LoD. Zero for the deterministic index. */
  tokenCost: number;
  /** True when this LoD body fell back to a deterministic stub. */
  fallback: boolean;
  /** Set when the LLM threw or budget was exhausted. */
  errorMessage?: string;
  /** True when the input prompt was trimmed for this LoD. */
  truncated: boolean;
}

export interface RepositoryPassResult {
  repoId: string;
  /** The four cards ready for persistence — one per LoD. */
  cards: CardInput[];
  /** Per-LoD bookkeeping. */
  lods: RepositoryPassLodResult[];
  /** Sum of LLM tokens across summary + standard + deep. */
  totalTokens: number;
  passRun: PassRunInput;
}

/**
 * Synthesize the four repository-level cards.
 *
 * Skips the LLM and returns a deterministic stub body for any LoD when the
 * per-run token cap is already exhausted or the LLM call throws. Each LoD
 * is independent, so a failure in one doesn't take the others out.
 */
export async function runRepositoryPass(
  repoId: string,
  input: RepositoryInput,
  opts: RepositoryPassOptions = {},
): Promise<RepositoryPassResult> {
  const llm = opts.llm ?? callOpenRouter;
  const model = opts.model ?? REPOSITORY_DEFAULT_MODEL;
  const fallbackModel = opts.fallbackModel ?? REPOSITORY_FALLBACK_MODEL;
  const maxInputTokens = opts.maxInputTokens ?? REPOSITORY_MAX_INPUT_TOKENS;
  const runCap = opts.runTokenCap ?? REPOSITORY_DEFAULT_RUN_TOKEN_CAP;
  const warn = opts.onWarning ?? (opts.quietWarnings ? noopWarn : defaultWarn);

  const startedAt = new Date();

  // Pre-flight: warn if the raw input already exceeds the budget — the
  // prompt builder will trim, but the operator should know.
  const inputCost = estimateInputTokens(input);
  if (inputCost > maxInputTokens) {
    warn('repository-pass: input exceeds budget; subsystem list will be trimmed', {
      inputCost,
      maxInputTokens,
    });
  }

  // --- index (deterministic, no LLM) ----------------------------------------
  const indexBody = clampToTokenBudget(
    buildIndexLine(repoId, input),
    REPOSITORY_LOD_TOKEN_BUDGETS.index,
  );

  // --- LLM-backed LoDs ------------------------------------------------------
  const lodOrder: LlmLod[] = ['summary', 'standard', 'deep'];
  let totalTokens = 0;
  let llmErrors = 0;

  const bodies: Record<LlmLod, string> = {
    summary: '',
    standard: '',
    deep: '',
  };
  const trackers: Record<LlmLod, RepositoryPassLodResult> = {
    summary: { lod: 'SUMMARY', tokenCost: 0, fallback: false, truncated: false },
    standard: { lod: 'STANDARD', tokenCost: 0, fallback: false, truncated: false },
    deep: { lod: 'DEEP', tokenCost: 0, fallback: false, truncated: false },
  };

  for (const lod of lodOrder) {
    const built = buildRepositoryPrompt(input, lod, { maxInputTokens });
    trackers[lod].truncated = built.truncated;

    if (totalTokens >= runCap) {
      bodies[lod] = fallbackBody(lod, input, repoId);
      trackers[lod].fallback = true;
      trackers[lod].errorMessage = 'run-token-cap-exceeded';
      continue;
    }

    try {
      const response = await llm({
        model,
        fallbackModel,
        prompt: built.prompt,
        system: built.system,
        maxOutputTokens: built.maxOutputTokens,
      });
      totalTokens += response.totalTokens;
      trackers[lod].tokenCost = response.totalTokens;

      const trimmed = clampToTokenBudget(
        response.content.trim(),
        REPOSITORY_LOD_TOKEN_BUDGETS[lod],
      );
      if (!trimmed) {
        bodies[lod] = fallbackBody(lod, input, repoId);
        trackers[lod].fallback = true;
        trackers[lod].errorMessage = 'empty-response';
      } else {
        bodies[lod] = trimmed;
      }
    } catch (err) {
      llmErrors += 1;
      bodies[lod] = fallbackBody(lod, input, repoId);
      trackers[lod].fallback = true;
      trackers[lod].errorMessage = (err as Error).message;
    }
  }

  // --- assemble cards -------------------------------------------------------
  const conceptPath = repositoryConceptPath(repoId);
  const cards: CardInput[] = [
    cardFor(repoId, conceptPath, 'INDEX', indexBody, 0),
    cardFor(repoId, conceptPath, 'SUMMARY', bodies.summary, trackers.summary.tokenCost),
    cardFor(repoId, conceptPath, 'STANDARD', bodies.standard, trackers.standard.tokenCost),
    cardFor(repoId, conceptPath, 'DEEP', bodies.deep, trackers.deep.tokenCost),
  ];

  const finishedAt = new Date();
  const passRun: PassRunInput = {
    repoId,
    passName: 'synthesis-repository',
    status: llmErrors === lodOrder.length ? 'FAILED' : 'SUCCESS',
    model,
    tokenCost: totalTokens,
    startedAt,
    finishedAt,
    errorMessage:
      llmErrors > 0
        ? `${llmErrors}/${lodOrder.length} LoD(s) fell back deterministically`
        : undefined,
  };

  return {
    repoId,
    cards,
    lods: [
      { lod: 'INDEX', tokenCost: 0, fallback: false, truncated: false },
      trackers.summary,
      trackers.standard,
      trackers.deep,
    ],
    totalTokens,
    passRun,
  };
}

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic one-line repository index. Format mirrors the module-level
 * index for visual consistency.
 *
 * `<repoName> — <N> subsystems, languages: <langs>`
 */
export function buildIndexLine(
  repoId: string,
  input: RepositoryInput,
): string {
  const langs = input.metadata.languages.length
    ? input.metadata.languages.join('+')
    : 'unknown';
  const name = input.metadata.name || repoId;
  const subs = input.subsystems.length;
  return `${name} — repository: ${subs} subsystem${subs === 1 ? '' : 's'}, ${langs}`;
}

/**
 * Deterministic body used when the LLM is unavailable, the per-run budget
 * is exhausted, or the response is empty. Picks up the largest signals
 * (top subsystems by member count) so the artifact isn't empty.
 */
export function fallbackBody(
  lod: LlmLod,
  input: RepositoryInput,
  repoId: string,
): string {
  const top = topSubsystems(input.subsystems, lod === 'summary' ? 3 : 8);
  const list = top.length
    ? top.map((s) => `- ${s.name}: ${s.memberModulePaths.length} modules`).join('\n')
    : '_(no subsystems discovered)_';

  const langs = input.metadata.languages.join(', ') || 'unknown';
  const name = input.metadata.name || repoId;

  let body: string;
  if (lod === 'summary') {
    body =
      `Repository ${name} (${langs}) contains ${input.subsystems.length} ` +
      `discovered subsystem${input.subsystems.length === 1 ? '' : 's'}. ` +
      `[deterministic fallback — LLM unavailable]`;
  } else if (lod === 'standard') {
    body =
      `Repository ${name} (${langs}). ${input.subsystems.length} subsystems ` +
      `discovered.\n\n${list}\n\n[deterministic fallback — LLM unavailable]`;
  } else {
    body =
      `## Overview\n\nRepository ${name} (${langs}).\n\n` +
      `## Subsystems\n\n${list}\n\n` +
      `[deterministic fallback — LLM unavailable]`;
  }

  return clampToTokenBudget(body, REPOSITORY_LOD_TOKEN_BUDGETS[lod]);
}

function topSubsystems(
  subs: SubsystemSummary[],
  limit: number,
): SubsystemSummary[] {
  return [...subs]
    .sort((a, b) => b.memberModulePaths.length - a.memberModulePaths.length)
    .slice(0, limit);
}

function cardFor(
  repoId: string,
  conceptPath: string,
  lod: LodLiteral,
  content: string,
  tokenCost: number,
): CardInput {
  return {
    repoId,
    conceptPath,
    lod,
    level: 'REPOSITORY',
    content,
    sourcePass: 'synthesis-repository',
    tokenCount: approxTokenCount(content) || tokenCost || undefined,
  };
}

function defaultWarn(message: string, context?: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.warn(message, context ?? {});
}

function noopWarn(): void {
  /* intentional — used when `quietWarnings: true`. */
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Minimal Prisma surface — keeps tests + mocks small. */
export type RepositoryPersistClient = Pick<PrismaClient, 'card' | '$transaction'>;

export interface PersistRepositoryStats {
  cardsUpserted: number;
}

/**
 * Persist the four repository cards inside a single transaction. Upsert key
 * matches the existing `Card` unique index `(repoId, conceptPath, lod)`, so
 * re-running the pass never duplicates a row.
 *
 * Throws if any input card is not `level=REPOSITORY` or has a mismatched
 * `conceptPath` — fail loud, not silent.
 */
export async function persistRepositoryPass(
  client: RepositoryPersistClient,
  cards: CardInput[],
): Promise<PersistRepositoryStats> {
  const expectedPath = cards[0]?.conceptPath;
  for (const card of cards) {
    if (card.level !== 'REPOSITORY') {
      throw new Error(
        `persistRepositoryPass: expected level=REPOSITORY, got ${card.level}`,
      );
    }
    if (card.conceptPath !== expectedPath) {
      throw new Error(
        `persistRepositoryPass: conceptPath mismatch (${card.conceptPath} vs ${expectedPath})`,
      );
    }
  }

  const runInTx = client.$transaction as unknown as (
    fn: (tx: RepositoryPersistClient) => Promise<unknown>,
  ) => Promise<unknown>;

  await runInTx(async (tx) => {
    for (const card of cards) {
      await tx.card.upsert({
        where: {
          repoId_conceptPath_lod: {
            repoId: card.repoId,
            conceptPath: card.conceptPath,
            lod: card.lod,
          },
        },
        create: {
          repoId: card.repoId,
          conceptPath: card.conceptPath,
          lod: card.lod,
          level: card.level,
          content: card.content,
          sourcePass: card.sourcePass,
          tokenCount: card.tokenCount,
        },
        update: {
          content: card.content,
          level: card.level,
          sourcePass: card.sourcePass,
          tokenCount: card.tokenCount,
        },
      });
    }
  });

  return { cardsUpserted: cards.length };
}
