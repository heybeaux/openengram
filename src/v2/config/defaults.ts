/**
 * Built-in defaults for `.engram/config.yaml` (EC-27).
 *
 * Source of truth for model selection lives in the individual pass
 * orchestrators (`INTENT_DEFAULT_MODEL`, `CONTRACTS_DEFAULT_MODEL`, …) so
 * a config with no overrides matches historic behaviour exactly. We
 * re-export them here for the resolver and `config show`.
 *
 * Spec: docs/specs/engram-code-v2.md §4.4–§4.5.
 */

import type { ResolvedEngramConfig } from './schema';

import {
  CONTRACTS_DEFAULT_MODEL,
  CONTRACTS_FALLBACK_MODEL,
  CONTRACTS_DEFAULT_RUN_TOKEN_CAP,
} from '../passes/contracts/orchestrator';
import {
  GOTCHAS_DEFAULT_MODEL,
  GOTCHAS_FALLBACK_MODEL,
  GOTCHAS_DEFAULT_RUN_TOKEN_CAP,
  GOTCHAS_DEFAULT_CALL_CAP,
} from '../passes/gotchas/orchestrator';
import {
  INTENT_DEFAULT_MODEL,
  INTENT_FALLBACK_MODEL,
  INTENT_DEFAULT_RUN_TOKEN_CAP,
} from '../passes/intent/orchestrator';
import {
  REPOSITORY_DEFAULT_MODEL,
  REPOSITORY_FALLBACK_MODEL,
} from '../passes/repository/orchestrator';
import {
  SUBSYSTEM_DEFAULT_MODEL,
  SUBSYSTEM_FALLBACK_MODEL,
} from '../passes/subsystem/orchestrator';

/** Mirrors `DEFAULT_MAX_INPUT_TOKENS` / `DEFAULT_MAX_OUTPUT_TOKENS` used in pass prompts. */
const DEFAULT_PASS_INPUT_TOKENS = 8000;
const DEFAULT_PASS_OUTPUT_TOKENS = 800;
const DEFAULT_GOTCHAS_OUTPUT_TOKENS = 1200;

const DEFAULT_EXCLUDES: readonly string[] = [
  'node_modules/**',
  'dist/**',
  '**/__tests__/**',
];

const DEFAULT_INCLUDES: readonly string[] = ['**/*'];

/**
 * Default budgets borrow the largest of the per-pass run caps for
 * `perPassTokenCap` and a generous daily cap. These are advisory until
 * the conductor enforces them across pass runs.
 */
const DEFAULT_DAILY_TOKEN_CAP = 1_000_000;
const DEFAULT_PER_PASS_TOKEN_CAP = Math.max(
  INTENT_DEFAULT_RUN_TOKEN_CAP,
  CONTRACTS_DEFAULT_RUN_TOKEN_CAP,
  GOTCHAS_DEFAULT_RUN_TOKEN_CAP,
);

export const DEFAULT_CONFIG: ResolvedEngramConfig = Object.freeze({
  passes: {
    intent: {
      model: INTENT_DEFAULT_MODEL,
      fallback: INTENT_FALLBACK_MODEL,
      maxInputTokens: DEFAULT_PASS_INPUT_TOKENS,
      maxOutputTokens: DEFAULT_PASS_OUTPUT_TOKENS,
    },
    contracts: {
      model: CONTRACTS_DEFAULT_MODEL,
      fallback: CONTRACTS_FALLBACK_MODEL,
      maxInputTokens: DEFAULT_PASS_INPUT_TOKENS,
      maxOutputTokens: DEFAULT_PASS_OUTPUT_TOKENS,
    },
    gotchas: {
      model: GOTCHAS_DEFAULT_MODEL,
      fallback: GOTCHAS_FALLBACK_MODEL,
      maxInputTokens: DEFAULT_PASS_INPUT_TOKENS,
      maxOutputTokens: DEFAULT_GOTCHAS_OUTPUT_TOKENS,
      maxLLMCalls: GOTCHAS_DEFAULT_CALL_CAP,
    },
    synthesis: {
      module: {
        model: INTENT_DEFAULT_MODEL,
        fallback: INTENT_FALLBACK_MODEL,
      },
      subsystem: {
        model: SUBSYSTEM_DEFAULT_MODEL,
        fallback: SUBSYSTEM_FALLBACK_MODEL,
      },
      repository: {
        model: REPOSITORY_DEFAULT_MODEL,
        fallback: REPOSITORY_FALLBACK_MODEL,
      },
    },
  },
  budget: {
    dailyTokenCap: DEFAULT_DAILY_TOKEN_CAP,
    perPassTokenCap: DEFAULT_PER_PASS_TOKEN_CAP,
  },
  observations: {
    // EC-50: disabled by default. `ingest.module.ts` flips this on when
    // both `enabled` is true AND a non-empty `apiKey` is present (the
    // wire-up reads `ENGRAM_API_KEY` from env when the config omits it).
    enabled: false,
    endpoint: 'https://api.openengram.ai',
    apiKey: '',
    batchSize: 25,
    batchIntervalMs: 5_000,
  },
  scheduler: {
    // EC-49: cron defaults off — operators opt in by listing repos. The
    // webhook route is mounted unconditionally; without a configured
    // secret it accepts all callers, which is fine for trusted/local
    // networks but should be set in production.
    enabled: false,
    cron: [],
    webhook: {
      secret: '',
    },
  },
  modules: {
    include: [...DEFAULT_INCLUDES],
    exclude: [...DEFAULT_EXCLUDES],
  },
});
