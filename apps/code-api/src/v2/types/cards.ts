/**
 * Phase 2 card + subsystem + pass-run types.
 *
 * These are the in-memory shapes used by orchestrators (intent, contracts,
 * gotchas, synthesis, subsystem detection). Prisma generates the persistence
 * shapes; this file is the *domain* contract so passes don't import Prisma
 * directly.
 *
 * Spec: docs/specs/engram-code-v2.md §4.5 (storage model), §4.2 (passes).
 */

import type { CardLevel, Lod, PassRunStatus } from '@prisma/client';

export { CardLevel, Lod, PassRunStatus };

/** Hierarchy levels — mirrors Prisma `CardLevel` enum. */
export const CARD_LEVELS = ['REPOSITORY', 'SUBSYSTEM', 'MODULE', 'CAPABILITY'] as const;
export type CardLevelLiteral = (typeof CARD_LEVELS)[number];

/** LoD values — mirrors Prisma `Lod` enum. */
export const LODS = ['INDEX', 'SUMMARY', 'STANDARD', 'DEEP'] as const;
export type LodLiteral = (typeof LODS)[number];

/** Pass identifiers used in `PassRun.passName` + `Card.sourcePass`. */
export const PASS_NAMES = [
  'structure',
  'intent',
  'contracts',
  'gotchas',
  'subsystem',
  'synthesis-module',
  'synthesis-subsystem',
  'synthesis-repository',
  'hotspots',
] as const;
export type PassName = (typeof PASS_NAMES)[number];

/**
 * In-memory representation of a card row. Used by writers + orchestrators
 * before persistence. The DB row may have additional fields (id, embedding,
 * timestamps) that are filled at upsert time.
 */
export interface CardInput {
  repoId: string;
  conceptPath: string;
  lod: LodLiteral;
  level: CardLevelLiteral;
  content: string;
  sourcePass: PassName;
  tokenCount?: number;
}

/**
 * In-memory representation of a discovered subsystem. The detector (EC-25)
 * emits these; the persister upserts them into the `subsystems` table and
 * generates a corresponding subsystem card.
 */
export interface SubsystemInput {
  repoId: string;
  name: string;
  slug: string;
  description?: string;
  memberModulePaths: string[];
}

/** Pass-run ledger entry. Conductor creates one per pass invocation. */
export interface PassRunInput {
  repoId: string;
  passName: PassName;
  status?: PassRunStatus;
  inputHash?: string;
  outputHash?: string;
  model?: string;
  tokenCost?: number;
  errorMessage?: string;
  startedAt?: Date;
  finishedAt?: Date;
  /**
   * Free-form per-pass extras persisted into `pass_runs.metadata`. EC-49
   * uses this to stamp the trigger source (`cron` / `webhook` / `hook` /
   * `manual`) onto every row so observability can attribute spend.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Token-budget shape used by orchestrators. The conductor enforces these
 * against the running `pass_runs` ledger before dispatching a new pass.
 */
export interface PassBudget {
  /** Per-repo daily ceiling (sums all passes). */
  dailyTokenCap: number;
  /** Per-pass ceiling for this run (e.g. intent caps at 200k). */
  perPassTokenCap: number;
}

/** Default budgets — overridable via `.engram/config.yaml` (EC-27). */
export const DEFAULT_BUDGET: PassBudget = {
  dailyTokenCap: 500_000,
  perPassTokenCap: 200_000,
};
