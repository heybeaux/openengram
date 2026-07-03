/**
 * Convert a {@link ResolvedEngramConfig} into the option shape each
 * pass orchestrator already accepts (EC-22 / EC-23 / EC-24 / EC-25 /
 * EC-26).
 *
 * The orchestrators predate EC-27 and take their per-pass overrides
 * as a small bag of optional fields. Rather than threading the resolved
 * config object through every callsite, the CLI calls these helpers to
 * derive a single options object per pass.
 */

import type { ContractsPassOptions } from '../passes/contracts/orchestrator';
import type { GotchasPassOptions } from '../passes/gotchas/orchestrator';
import type { IntentPassOptions } from '../passes/intent/orchestrator';
import type { RepositoryPassOptions } from '../passes/repository/orchestrator';
import type { SubsystemPassOptions } from '../passes/subsystem/orchestrator';

import type { ResolvedEngramConfig } from './schema';

export function intentOptionsFromConfig(
  config: ResolvedEngramConfig,
): IntentPassOptions {
  return {
    model: config.passes.intent.model,
    fallbackModel: config.passes.intent.fallback,
    maxInputTokens: config.passes.intent.maxInputTokens,
    maxOutputTokens: config.passes.intent.maxOutputTokens,
    runTokenCap: config.budget.perPassTokenCap,
  };
}

export function contractsOptionsFromConfig(
  config: ResolvedEngramConfig,
): ContractsPassOptions {
  return {
    model: config.passes.contracts.model,
    fallbackModel: config.passes.contracts.fallback,
    maxInputTokens: config.passes.contracts.maxInputTokens,
    maxOutputTokens: config.passes.contracts.maxOutputTokens,
    runTokenCap: config.budget.perPassTokenCap,
  };
}

export function gotchasOptionsFromConfig(
  config: ResolvedEngramConfig,
): GotchasPassOptions {
  return {
    model: config.passes.gotchas.model,
    fallbackModel: config.passes.gotchas.fallback,
    maxInputTokens: config.passes.gotchas.maxInputTokens,
    maxOutputTokens: config.passes.gotchas.maxOutputTokens,
    maxLLMCalls: config.passes.gotchas.maxLLMCalls,
    runTokenCap: config.budget.perPassTokenCap,
  };
}

export function subsystemOptionsFromConfig(
  config: ResolvedEngramConfig,
): SubsystemPassOptions {
  return {
    model: config.passes.synthesis.subsystem.model,
    fallbackModel: config.passes.synthesis.subsystem.fallback,
    runTokenCap: config.budget.perPassTokenCap,
  };
}

export function repositoryOptionsFromConfig(
  config: ResolvedEngramConfig,
): RepositoryPassOptions {
  return {
    model: config.passes.synthesis.repository.model,
    fallbackModel: config.passes.synthesis.repository.fallback,
    runTokenCap: config.budget.perPassTokenCap,
  };
}
