/**
 * Zod schema for `.engram/config.yaml` (EC-27).
 *
 * Each repo can ship a config file under `<repo>/.engram/config.yaml`
 * that overrides model selection, token budgets, and module scope for
 * the indexer. Everything is optional — passing `{}` is valid and
 * resolves to the built-in defaults declared in `./defaults`.
 *
 * Spec: docs/specs/engram-code-v2.md §4.4 (model routing), §4.5
 * (per-tier model), and EC-27.
 */

import { z } from 'zod';

/** Shared shape for LLM-backed passes that allow a primary+fallback pair. */
const PassModelOverrides = z
  .object({
    model: z.string().min(1).optional(),
    fallback: z.string().min(1).optional(),
    maxInputTokens: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
  })
  .strict();

/** Gotchas pass adds a hard ceiling on LLM call count per run. */
const GotchasPassOverrides = PassModelOverrides.extend({
  maxLLMCalls: z.number().int().positive().optional(),
}).strict();

/** Synthesis tiers only override the model (everything else is structural). */
const SynthesisTierOverrides = z
  .object({
    model: z.string().min(1).optional(),
    fallback: z.string().min(1).optional(),
  })
  .strict();

export const EngramConfigSchema = z
  .object({
    passes: z
      .object({
        intent: PassModelOverrides.optional(),
        contracts: PassModelOverrides.optional(),
        gotchas: GotchasPassOverrides.optional(),
        synthesis: z
          .object({
            module: SynthesisTierOverrides.optional(),
            subsystem: SynthesisTierOverrides.optional(),
            repository: SynthesisTierOverrides.optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    budget: z
      .object({
        dailyTokenCap: z.number().int().positive().optional(),
        perPassTokenCap: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    observations: z
      .object({
        enabled: z.boolean().optional(),
        endpoint: z.string().min(1).optional(),
        apiKey: z.string().min(1).optional(),
        batchSize: z.number().int().positive().optional(),
        batchIntervalMs: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    scheduler: z
      .object({
        /** Master on/off for the cron loop. Webhook + hook routes are
         * always live when the server is up; this only gates cron. */
        enabled: z.boolean().optional(),
        /**
         * Periodic ingest triggers. Each job re-ingests one GitHub URL on
         * an interval. `intervalMs` keeps the dependency surface small —
         * we don't ship a full cron parser for v1.
         */
        cron: z
          .array(
            z
              .object({
                url: z.string().min(1),
                ref: z.string().min(1).optional(),
                intervalMs: z.number().int().positive(),
              })
              .strict(),
          )
          .optional(),
        webhook: z
          .object({
            /** HMAC-SHA256 secret shared with GitHub. Empty disables HMAC
             * verification — only do this in trusted environments. */
            secret: z.string().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    modules: z
      .object({
        include: z.array(z.string().min(1)).optional(),
        exclude: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type EngramConfigInput = z.input<typeof EngramConfigSchema>;
export type EngramConfig = z.infer<typeof EngramConfigSchema>;

/** Fully-resolved config (every field present), produced by `loadConfig`. */
export interface ResolvedEngramConfig {
  passes: {
    intent: {
      model: string;
      fallback: string;
      maxInputTokens: number;
      maxOutputTokens: number;
    };
    contracts: {
      model: string;
      fallback: string;
      maxInputTokens: number;
      maxOutputTokens: number;
    };
    gotchas: {
      model: string;
      fallback: string;
      maxInputTokens: number;
      maxOutputTokens: number;
      maxLLMCalls: number;
    };
    synthesis: {
      module: { model: string; fallback: string };
      subsystem: { model: string; fallback: string };
      repository: { model: string; fallback: string };
    };
  };
  budget: {
    dailyTokenCap: number;
    perPassTokenCap: number;
  };
  observations: {
    enabled: boolean;
    endpoint: string;
    apiKey: string;
    batchSize: number;
    batchIntervalMs: number;
  };
  scheduler: {
    enabled: boolean;
    cron: Array<{
      url: string;
      ref?: string;
      intervalMs: number;
    }>;
    webhook: {
      secret: string;
    };
  };
  modules: {
    include: string[];
    exclude: string[];
  };
}
