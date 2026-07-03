/**
 * `engram-code synth` — drives the higher passes through the CLI (EC-38).
 *
 * Phase 2 shipped four orchestrator modules (contracts/gotchas/subsystem/
 * repository) with their own tests, but the CLI only knew how to run Pass 1.
 * This module wires the four higher passes end-to-end and persists their
 * output to `.engram/artifacts/` so the v1 API and the dashboard can read
 * actual LLM-synthesized cards instead of stubs.
 *
 * Pipeline order (matches the spec):
 *   structure → contracts → gotchas → subsystem → repository
 *
 * The repository-level cards land at concept path `repository` so the
 * dashboard `HomeCard` can request them via `GET /v1/cards/repository`.
 *
 * LLM clients are pluggable so the integration test in cli.spec.ts can
 * mock them.
 */

import { promises as fs } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';

import type { ResolvedEngramConfig } from '../config';
import { loadConfig } from '../config';
import type { BudgetTracker } from '../ingest/budget-tracker';
import {
  AffectedPathsCache,
  buildSkippedPassRun,
  computeConfigHash,
  type IncrementalPrismaClient,
  resolveHeadSha,
  resolveSinceSha,
  shouldRerunPass,
} from '../ingest/incremental';
import {
  callOpenRouter,
  type LLMClient,
  type LLMRequest,
  type LLMResponse,
} from '../llm/openrouter';
import {
  buildContractsFromStructure,
  type ContractModuleSymbols,
} from '../passes/contracts/extractor';
import {
  CONTRACTS_DEFAULT_MODEL,
  CONTRACTS_FALLBACK_MODEL,
  runContractsPass,
  type ContractsPassResult,
} from '../passes/contracts/orchestrator';
import { writeContractsArtifacts } from '../passes/contracts/writer';
import type { DetectGotchasInput } from '../passes/gotchas/detector';
import {
  GOTCHAS_DEFAULT_MODEL,
  GOTCHAS_FALLBACK_MODEL,
  runGotchasPass,
  type GotchasPassResult,
} from '../passes/gotchas/orchestrator';
import { writeGotchasArtifacts } from '../passes/gotchas/writer';
import { registerElixirExtractor } from '../parsers/elixir.extractor';
import { registerGoExtractor } from '../parsers/go.extractor';
import { registerPythonExtractor } from '../parsers/python.extractor';
import { registerRustExtractor } from '../parsers/rust.extractor';
import { registerSwiftExtractor } from '../parsers/swift.extractor';
import { registerTypeScriptExtractor } from '../parsers/typescript.extractor';
import type { StructureEdge, StructureNode } from '../parsers/types';
import {
  runStructurePass,
  type StructurePassResult,
} from '../passes/structure/orchestrator';
import { walkRepo } from '../passes/structure/walker';
import type {
  RepositoryInput,
  SubsystemSummary,
} from '../passes/repository/gatherer';
import {
  REPOSITORY_DEFAULT_MODEL,
  REPOSITORY_FALLBACK_MODEL,
  repositoryConceptPath,
  runRepositoryPass,
  type RepositoryPassResult,
} from '../passes/repository/orchestrator';
import { writeRepositoryArtifact } from '../passes/repository/writer';
import {
  runHotspotsPass,
  type HotspotsPassResult,
} from '../passes/hotspots/orchestrator';
import { writeHotspotCards } from '../passes/hotspots/writer';
import {
  buildModuleNodes,
  SUBSYSTEM_DEFAULT_MODEL,
  SUBSYSTEM_FALLBACK_MODEL,
  runSubsystemPass,
  type SubsystemPassResult,
} from '../passes/subsystem/orchestrator';
import { writeSubsystemArtifacts } from '../passes/subsystem/writer';
import type { CardInput, PassName, PassRunInput } from '../types/cards';
import type { Card } from '../writers/markdown/types';
import { cardFilePath, readCard, writeCard } from '../writers/markdown/writer';

import { buildStubCards } from './cli';

/** Concept path the dashboard `HomeCard` requests for the repository card. */
export const REPOSITORY_CARD_CONCEPT_PATH = 'repository';

/** Subcommands `engram-code synth ...` accepts. */
export type SynthSubcommand =
  | 'all'
  | 'contracts'
  | 'gotchas'
  | 'subsystem'
  | 'repository'
  | 'hotspots';

const VALID_SUBCOMMANDS: readonly string[] = [
  'contracts',
  'gotchas',
  'subsystem',
  'repository',
  'hotspots',
];

/**
 * Shape produced by `runSynth`. Tests assert on it; the CLI renders a
 * human-readable summary from it.
 */
export interface SynthRunSummary {
  repoId: string;
  repoPath: string;
  outDir: string;
  configSource: string | null;
  dryRun: boolean;
  /** Per-pass record — present iff that pass ran (or was planned in dry-run). */
  structure?: { filesWalked: number; filesParsed: number };
  contracts?: { modulesAnnotated: number; tokensUsed: number; errors: number };
  gotchas?: { modulesAnnotated: number; tokensUsed: number; errors: number };
  subsystem?: {
    subsystemsDiscovered: number;
    tokensUsed: number;
    errors: number;
  };
  repository?: { tokensUsed: number; fallbacks: number };
  /**
   * Hotspots pass (deterministic, no LLM). `scoredFiles` is every file the
   * collectors scored; `hotspotsFound` is the subset above the score
   * threshold; `cardsWritten` is `hotspotsFound + 1` (the roll-up).
   */
  hotspots?: {
    scoredFiles: number;
    hotspotsFound: number;
    cardsWritten: number;
  };
  /** Sum of LLM tokens across passes. */
  totalTokens: number;
  /** Per-pass planned LLM call counts (dry-run only). */
  plannedCalls?: Record<string, number>;
}

/**
 * Optional injection surface — exposed so the integration test in
 * cli.spec.ts can mock the LLM clients without touching the network.
 */
export interface SynthOverrides {
  contractsLlm?: LLMClient;
  gotchasLlm?: LLMClient;
  subsystemLlm?: LLMClient;
  repositoryLlm?: LLMClient;
}

export interface RunSynthOptions {
  repoPath: string;
  /** `all` runs the full chain; the rest run a single pass. */
  subcommand: SynthSubcommand;
  /** Override the artifacts root (default `<repo>/.engram/artifacts`). */
  outDir?: string;
  /** Override the repo id (default = basename of `repoPath`). */
  repoId?: string;
  /** Skip every LLM call; report what *would* have been planned. */
  dryRun?: boolean;
  /** Stream progress lines through this callback. */
  log?: (line: string) => void;
  /** Test hook: inject mock LLM clients per pass. */
  overrides?: SynthOverrides;
  /** Test hook: pre-resolved config. When omitted, loaded from disk. */
  config?: ResolvedEngramConfig;
  /**
   * Optional hook fired once per pass with the orchestrator's
   * {@link PassRunInput}. Used by the ingest service (EC-47) to persist a
   * `pass_runs` row per invocation. Failures inside the hook are logged
   * but do not fail the pass — observability must never block synthesis.
   */
  onPassRun?: (run: PassRunInput) => Promise<void> | void;
  /**
   * EC-48: budget gate. When provided, each pass calls `canStartPass` first
   * and is skipped (with a FAILED `pass_runs` row via {@link onPassRun}) if
   * the daily or per-pass cap would be crossed. Spend is reported back via
   * `recordSpend` after each successful pass.
   */
  budget?: BudgetTracker;
  /**
   * EC-46: incremental git-diff rescans. When `incremental.prisma` is
   * provided, each pass consults the `pass_runs` ledger and skips
   * unchanged passes (emitting a SUCCESS row with `errorMessage =
   * 'skipped-no-changes'`). When omitted, every pass runs (legacy behavior).
   *
   * `force` short-circuits the cache and reruns every pass (CLI `--full`).
   * `sinceSha` overrides the auto-resolved anchor (CLI `--since <ref>`).
   */
  incremental?: {
    prisma: IncrementalPrismaClient;
    force?: boolean;
    sinceSha?: string | null;
  };
}

let extractorsRegistered = false;
function ensureExtractorsRegistered(): void {
  if (extractorsRegistered) return;
  registerTypeScriptExtractor();
  registerPythonExtractor();
  registerGoExtractor();
  registerElixirExtractor();
  registerRustExtractor();
  registerSwiftExtractor();
  extractorsRegistered = true;
}

/**
 * Resolve the per-run token cap. Precedence:
 *   1. `EC_DAILY_TOKEN_CAP` env (positive integer)
 *   2. `synthesis.dailyTokenCap` from `.engram/config.yaml`
 *   3. Built-in default from the resolved config.
 *
 * Exposed so tests can exercise the override path.
 */
export function resolveDailyTokenCap(config: ResolvedEngramConfig): number {
  const envRaw = process.env.EC_DAILY_TOKEN_CAP;
  if (envRaw) {
    const parsed = Number.parseInt(envRaw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return config.budget.dailyTokenCap;
}

/**
 * Default repo id helper. Mirrors the one in cli.ts so we don't import a
 * private symbol.
 */
function defaultRepoId(repoPath: string): string {
  const base = repoPath.replace(/\/+$/, '').split(/[\\/]/).pop();
  return base && base !== '' ? base : 'repo';
}

/**
 * Entry point used by `cli.ts` for the `synth` command. The split between
 * sub-flows is in this file so cli.ts stays a router.
 */
export async function runSynth(
  opts: RunSynthOptions,
): Promise<SynthRunSummary> {
  ensureExtractorsRegistered();

  const repoId = opts.repoId ?? defaultRepoId(opts.repoPath);
  const outDir = opts.outDir ?? join(opts.repoPath, '.engram', 'artifacts');
  const log = opts.log ?? (() => {});
  const fireHook = async (run: PassRunInput): Promise<void> => {
    if (!opts.onPassRun) return;
    try {
      await opts.onPassRun(run);
    } catch (err) {
      log(
        `synth: onPassRun hook failed for ${run.passName}: ${(err as Error).message}`,
      );
    }
  };

  const loaded = opts.config
    ? { config: opts.config, source: null as string | null }
    : await loadConfig({ startDir: opts.repoPath });

  const tokenCap = resolveDailyTokenCap(loaded.config);
  const perPassCap = loaded.config.budget.perPassTokenCap;

  // EC-46: incremental git-diff rescans. Resolved once per `runSynth` call;
  // each pass calls `gateIncremental` below to decide rerun-vs-skip. When
  // no incremental client is wired the gate always returns "run" so the
  // legacy code path is unaffected.
  const incrementalCache = opts.incremental
    ? new AffectedPathsCache(opts.repoPath)
    : null;
  const headSha = opts.incremental ? await resolveHeadSha(opts.repoPath) : null;
  const sinceSha = opts.incremental
    ? await resolveSinceSha(
        opts.incremental.prisma,
        repoId,
        opts.incremental.sinceSha,
      )
    : null;
  const configHash = computeConfigHash({
    passes: loaded.config.passes,
    budget: loaded.config.budget,
  });
  const gateIncremental = async (
    passName: PassName,
    startedAt: Date,
  ): Promise<{ skip: false } | { skip: true }> => {
    if (!opts.incremental || !incrementalCache || !headSha || opts.dryRun) {
      return { skip: false };
    }
    const affectedPaths = await incrementalCache.get(sinceSha);
    const decision = await shouldRerunPass(
      opts.incremental.prisma,
      repoId,
      { passName, sha: headSha, affectedPaths },
      { configHash, force: opts.incremental.force },
    );
    if (decision.rerun) return { skip: false };
    log(`synth: ${passName} skipped — no changes since ${sinceSha ?? 'init'}`);
    await fireHook(
      buildSkippedPassRun({
        repoId,
        passName,
        newInputHash: decision.newInputHash,
        headSha,
        startedAt,
      }),
    );
    return { skip: true };
  };
  const summary: SynthRunSummary = {
    repoId,
    repoPath: opts.repoPath,
    outDir,
    configSource: loaded.source,
    dryRun: !!opts.dryRun,
    totalTokens: 0,
  };

  if (opts.dryRun) {
    summary.plannedCalls = {};
  }

  // Structure pass is always required — contracts/gotchas/subsystem feed off
  // its nodes + edges, and repository feeds off subsystem output. Running a
  // higher pass in isolation is "rebuild from scratch" semantics; nothing
  // currently persists Pass-1 results we could cheaply reload.
  log('synth: running structure pass…');
  const structureStartedAt = new Date();
  const structure = await runStructurePass(opts.repoPath, repoId);
  const structureFinishedAt = new Date();
  summary.structure = {
    filesWalked: structure.filesWalked,
    filesParsed: structure.filesParsed,
  };
  log(
    `synth: structure → ${structure.filesParsed} files parsed, ${structure.nodes.length} nodes`,
  );
  // Structure pass is mechanical (no LLM), so we synthesize the PassRunInput
  // here rather than reach into the orchestrator's return.
  await fireHook({
    repoId,
    passName: 'structure',
    status: 'SUCCESS',
    startedAt: structureStartedAt,
    finishedAt: structureFinishedAt,
    tokenCost: 0,
  });

  // Pull source bodies once — both contracts and gotchas need them.
  const sources = await loadRepoSources(opts.repoPath, structure);

  // Token budget is shared across the higher passes via this counter.
  let tokensSpent = 0;
  const remaining = () => Math.max(0, tokenCap - tokensSpent);

  /**
   * EC-48: consult the budget tracker before running `passName`. Returns the
   * effective per-run cap (clamped by tracker's remainingDaily when present),
   * or null when the pass must be skipped. The skipped path logs a FAILED
   * `pass_runs` row via {@link fireHook} so the dashboard sees the abort.
   */
  const gateBudget = async (
    passName: PassName,
    model: string,
    startedAt: Date,
  ): Promise<{ cap: number } | { skip: true; reason: string }> => {
    if (!opts.budget) return { cap: remaining() };
    const decision = await opts.budget.canStartPass(passName);
    if (!decision.ok) {
      const reason = decision.reason ?? 'budget-exceeded:daily';
      log(`synth: ${passName} skipped — ${reason}`);
      await fireHook({
        repoId,
        passName,
        status: 'FAILED',
        model,
        tokenCost: 0,
        startedAt,
        finishedAt: new Date(),
        errorMessage: reason,
      });
      return { skip: true, reason };
    }
    const cap = Math.min(remaining(), decision.remainingDaily);
    return { cap };
  };

  // Track which passes to actually run.
  const runContracts =
    opts.subcommand === 'all' || opts.subcommand === 'contracts';
  const runGotchas = opts.subcommand === 'all' || opts.subcommand === 'gotchas';
  const runSubsystem =
    opts.subcommand === 'all' || opts.subcommand === 'subsystem';
  const runRepository =
    opts.subcommand === 'all' || opts.subcommand === 'repository';
  const runHotspots =
    opts.subcommand === 'all' || opts.subcommand === 'hotspots';

  // ─── Contracts ──────────────────────────────────────────────────────────
  let contractsResult: ContractsPassResult | undefined;
  if (runContracts) {
    const contractsByLang = buildContractsByLanguage(structure, sources);
    const allContractsModules = contractsByLang.flatMap((c) => c.modules);
    log(
      `synth: contracts → ${allContractsModules.length} module(s) with exports`,
    );
    if (opts.dryRun) {
      // One LLM call per module with at least one symbol.
      const planned = allContractsModules.filter(
        (m) => m.symbols.length > 0,
      ).length;
      summary.plannedCalls!.contracts = planned;
    } else if (remaining() <= 0) {
      log('synth: contracts skipped — token cap exhausted');
      summary.contracts = { modulesAnnotated: 0, tokensUsed: 0, errors: 0 };
    } else {
      const contractsStartedAt = new Date();
      const inc = await gateIncremental('contracts', contractsStartedAt);
      if (inc.skip) {
        summary.contracts = { modulesAnnotated: 0, tokensUsed: 0, errors: 0 };
      } else {
        const gate = await gateBudget(
          'contracts',
          loaded.config.passes.contracts.model,
          contractsStartedAt,
        );
        if ('skip' in gate) {
          summary.contracts = { modulesAnnotated: 0, tokensUsed: 0, errors: 0 };
        } else {
          try {
            const merged: ContractsPassResult = {
              repoId,
              modules: [],
              totalTokens: 0,
              passRun: {
                repoId,
                passName: 'contracts',
                status: 'SUCCESS',
                model: loaded.config.passes.contracts.model,
                tokenCost: 0,
                startedAt: contractsStartedAt,
                finishedAt: contractsStartedAt,
              },
            };
            for (const bundle of contractsByLang) {
              const perCallCap = Math.min(gate.cap, perPassCap);
              const result = await runContractsPass(repoId, bundle.modules, {
                llm: opts.overrides?.contractsLlm,
                model: loaded.config.passes.contracts.model,
                fallbackModel: loaded.config.passes.contracts.fallback,
                maxInputTokens: loaded.config.passes.contracts.maxInputTokens,
                maxOutputTokens: loaded.config.passes.contracts.maxOutputTokens,
                runTokenCap: perCallCap,
              });
              merged.modules.push(...result.modules);
              merged.totalTokens += result.totalTokens;
              tokensSpent += result.totalTokens;
            }
            opts.budget?.recordSpend('contracts', merged.totalTokens);
            contractsResult = merged;
            await writeContractsArtifacts(merged.modules, {
              artifactsRoot: outDir,
            });
            await writeModuleCards(outDir, merged.modules, repoId, 'contracts');
            const errors = merged.modules.filter(
              (m) => m.skipReason === 'llm-error',
            ).length;
            const annotated = merged.modules.filter(
              (m) => m.card !== null,
            ).length;
            summary.contracts = {
              modulesAnnotated: annotated,
              tokensUsed: merged.totalTokens,
              errors,
            };
            log(
              `synth: contracts → ${annotated} module card(s), ${merged.totalTokens} tokens` +
                (errors > 0 ? `, ${errors} error(s) (continuing)` : ''),
            );
            await fireHook({
              repoId,
              passName: 'contracts',
              status: errors > 0 && annotated === 0 ? 'FAILED' : 'SUCCESS',
              model: loaded.config.passes.contracts.model,
              tokenCost: merged.totalTokens,
              startedAt: contractsStartedAt,
              finishedAt: new Date(),
              errorMessage:
                errors > 0
                  ? `${errors}/${merged.modules.length} module(s) failed`
                  : undefined,
            });
          } catch (err) {
            const finishedAt = new Date();
            log(`synth: contracts pass failed: ${(err as Error).message}`);
            summary.contracts = {
              modulesAnnotated: 0,
              tokensUsed: 0,
              errors: 1,
            };
            await fireHook({
              repoId,
              passName: 'contracts',
              status: 'FAILED',
              model: loaded.config.passes.contracts.model,
              tokenCost: 0,
              startedAt: contractsStartedAt,
              finishedAt,
              errorMessage: (err as Error).message,
            });
          }
        }
      }
    }
  }

  // ─── Gotchas ────────────────────────────────────────────────────────────
  let gotchasResult: GotchasPassResult | undefined;
  if (runGotchas) {
    const gotchasInputs = buildGotchasInputs(structure, sources);
    log(`synth: gotchas → ${gotchasInputs.length} module(s) scanned`);
    if (opts.dryRun) {
      summary.plannedCalls!.gotchas = gotchasInputs.length; // upper bound
    } else if (remaining() <= 0) {
      log('synth: gotchas skipped — token cap exhausted');
      summary.gotchas = { modulesAnnotated: 0, tokensUsed: 0, errors: 0 };
    } else {
      const gotchasStartedAt = new Date();
      const inc = await gateIncremental('gotchas', gotchasStartedAt);
      if (inc.skip) {
        summary.gotchas = { modulesAnnotated: 0, tokensUsed: 0, errors: 0 };
      } else {
        const gate = await gateBudget(
          'gotchas',
          loaded.config.passes.gotchas.model,
          gotchasStartedAt,
        );
        if ('skip' in gate) {
          summary.gotchas = { modulesAnnotated: 0, tokensUsed: 0, errors: 0 };
        } else {
          try {
            const result = await runGotchasPass(repoId, gotchasInputs, {
              llm: opts.overrides?.gotchasLlm,
              model: loaded.config.passes.gotchas.model,
              fallbackModel: loaded.config.passes.gotchas.fallback,
              maxInputTokens: loaded.config.passes.gotchas.maxInputTokens,
              maxOutputTokens: loaded.config.passes.gotchas.maxOutputTokens,
              maxLLMCalls: loaded.config.passes.gotchas.maxLLMCalls,
              runTokenCap: Math.min(gate.cap, perPassCap),
            });
            gotchasResult = result;
            tokensSpent += result.totalTokens;
            opts.budget?.recordSpend('gotchas', result.totalTokens);
            await writeGotchasArtifacts(result.modules, {
              artifactsRoot: outDir,
            });
            await writeModuleCards(outDir, result.modules, repoId, 'gotchas');
            const errors = result.modules.filter(
              (m) => m.skipReason === 'llm-error',
            ).length;
            const annotated = result.modules.filter(
              (m) => m.card !== null,
            ).length;
            summary.gotchas = {
              modulesAnnotated: annotated,
              tokensUsed: result.totalTokens,
              errors,
            };
            log(
              `synth: gotchas → ${annotated} module card(s), ${result.totalTokens} tokens` +
                (errors > 0 ? `, ${errors} error(s) (continuing)` : ''),
            );
            await fireHook({
              ...result.passRun,
              startedAt: gotchasStartedAt,
              finishedAt: new Date(),
            });
          } catch (err) {
            log(`synth: gotchas pass failed: ${(err as Error).message}`);
            summary.gotchas = { modulesAnnotated: 0, tokensUsed: 0, errors: 1 };
            await fireHook({
              repoId,
              passName: 'gotchas',
              status: 'FAILED',
              model: loaded.config.passes.gotchas.model,
              tokenCost: 0,
              startedAt: gotchasStartedAt,
              finishedAt: new Date(),
              errorMessage: (err as Error).message,
            });
          }
        }
      }
    }
  }

  // ─── Subsystem ──────────────────────────────────────────────────────────
  let subsystemResult: SubsystemPassResult | undefined;
  if (runSubsystem) {
    const moduleNodes = buildModuleNodes(structure.nodes);
    log(
      `synth: subsystem → ${moduleNodes.length} module(s) input to clustering`,
    );
    if (opts.dryRun) {
      // Without running the detector we can't know the exact cluster count;
      // report the upper bound (1 LLM call per cluster, capped at MAX_SUBSYSTEMS=15).
      summary.plannedCalls!.subsystem = Math.min(15, moduleNodes.length);
    } else if (remaining() <= 0) {
      log('synth: subsystem skipped — token cap exhausted');
      summary.subsystem = { subsystemsDiscovered: 0, tokensUsed: 0, errors: 0 };
    } else {
      const subsystemStartedAt = new Date();
      const inc = await gateIncremental('subsystem', subsystemStartedAt);
      if (inc.skip) {
        summary.subsystem = {
          subsystemsDiscovered: 0,
          tokensUsed: 0,
          errors: 0,
        };
      } else {
        const gate = await gateBudget(
          'subsystem',
          loaded.config.passes.synthesis.subsystem.model,
          subsystemStartedAt,
        );
        if ('skip' in gate) {
          summary.subsystem = {
            subsystemsDiscovered: 0,
            tokensUsed: 0,
            errors: 0,
          };
        } else {
          try {
            const result = await runSubsystemPass(
              repoId,
              structure.nodes,
              structure.edges,
              moduleNodes,
              {
                llm: opts.overrides?.subsystemLlm,
                model: loaded.config.passes.synthesis.subsystem.model,
                fallbackModel:
                  loaded.config.passes.synthesis.subsystem.fallback,
                runTokenCap: Math.min(gate.cap, perPassCap),
                quietWarnings: true,
              },
            );
            subsystemResult = result;
            tokensSpent += result.totalTokens;
            opts.budget?.recordSpend('subsystem', result.totalTokens);
            const artifactInputs = result.clusters
              .filter((c) => c.slug && !c.skipReason)
              .map((c) => {
                const subsystem = result.subsystems.find(
                  (s) => s.slug === c.slug,
                );
                if (!subsystem) return null;
                return {
                  subsystem,
                  cluster: {
                    clusterId: c.clusterId,
                    tokenCost: c.tokenCost,
                    truncated: c.truncated,
                    nameFallback: c.nameFallback,
                  },
                };
              })
              .filter((a): a is NonNullable<typeof a> => a !== null);
            await writeSubsystemArtifacts(artifactInputs, {
              artifactsRoot: outDir,
            });
            await writeSubsystemCards(outDir, result, repoId);
            const errors = result.clusters.filter(
              (c) => c.skipReason === 'llm-error',
            ).length;
            summary.subsystem = {
              subsystemsDiscovered: result.subsystems.length,
              tokensUsed: result.totalTokens,
              errors,
            };
            log(
              `synth: subsystem → ${result.subsystems.length} subsystem(s), ${result.totalTokens} tokens` +
                (errors > 0 ? `, ${errors} error(s) (continuing)` : ''),
            );
            await fireHook({
              ...result.passRun,
              startedAt: subsystemStartedAt,
              finishedAt: new Date(),
            });
          } catch (err) {
            log(`synth: subsystem pass failed: ${(err as Error).message}`);
            summary.subsystem = {
              subsystemsDiscovered: 0,
              tokensUsed: 0,
              errors: 1,
            };
            await fireHook({
              repoId,
              passName: 'subsystem',
              status: 'FAILED',
              model: loaded.config.passes.synthesis.subsystem.model,
              tokenCost: 0,
              startedAt: subsystemStartedAt,
              finishedAt: new Date(),
              errorMessage: (err as Error).message,
            });
          }
        }
      }
    }
  }

  // ─── Repository ─────────────────────────────────────────────────────────
  let repositoryResult: RepositoryPassResult | undefined;
  if (runRepository) {
    const repoInput = buildRepositoryInput(
      structure,
      subsystemResult,
      opts.repoPath,
    );
    log(
      `synth: repository → ${repoInput.subsystems.length} subsystem(s) folded in`,
    );
    if (opts.dryRun) {
      // Three LLM calls (summary/standard/deep); index is deterministic.
      summary.plannedCalls!.repository = 3;
    } else if (remaining() <= 0) {
      log('synth: repository skipped — token cap exhausted');
      summary.repository = { tokensUsed: 0, fallbacks: 4 };
    } else {
      const repositoryStartedAt = new Date();
      const inc = await gateIncremental(
        'synthesis-repository',
        repositoryStartedAt,
      );
      if (inc.skip) {
        summary.repository = { tokensUsed: 0, fallbacks: 0 };
      } else {
        const gate = await gateBudget(
          'synthesis-repository',
          loaded.config.passes.synthesis.repository.model,
          repositoryStartedAt,
        );
        if ('skip' in gate) {
          summary.repository = { tokensUsed: 0, fallbacks: 4 };
        } else {
          try {
            const result = await runRepositoryPass(repoId, repoInput, {
              llm: opts.overrides?.repositoryLlm,
              model: loaded.config.passes.synthesis.repository.model,
              fallbackModel: loaded.config.passes.synthesis.repository.fallback,
              runTokenCap: Math.min(gate.cap, perPassCap),
              quietWarnings: true,
            });
            repositoryResult = result;
            tokensSpent += result.totalTokens;
            opts.budget?.recordSpend(
              'synthesis-repository',
              result.totalTokens,
            );
            await writeRepositoryArtifact(
              {
                repoId,
                input: repoInput,
                cards: result.cards,
                lods: result.lods,
                totalTokens: result.totalTokens,
                model: loaded.config.passes.synthesis.repository.model,
              },
              { artifactsRoot: outDir },
            );
            await writeRepositoryCard(outDir, result);
            const fallbacks = result.lods.filter((l) => l.fallback).length;
            summary.repository = {
              tokensUsed: result.totalTokens,
              fallbacks,
            };
            log(
              `synth: repository → ${result.totalTokens} tokens` +
                (fallbacks > 0 ? `, ${fallbacks} LoD fallback(s)` : ''),
            );
            await fireHook({
              ...result.passRun,
              startedAt: repositoryStartedAt,
              finishedAt: new Date(),
            });
          } catch (err) {
            log(`synth: repository pass failed: ${(err as Error).message}`);
            summary.repository = { tokensUsed: 0, fallbacks: 4 };
            await fireHook({
              repoId,
              passName: 'synthesis-repository',
              status: 'FAILED',
              model: loaded.config.passes.synthesis.repository.model,
              tokenCost: 0,
              startedAt: repositoryStartedAt,
              finishedAt: new Date(),
              errorMessage: (err as Error).message,
            });
          }
        }
      }
    }
  }

  // ─── Hotspots (Pass 4, deterministic, EC-45) ────────────────────────────
  // No LLM, so no token spend — but still gated by `gateIncremental` so we
  // skip when nothing has changed, and still emits a `pass_runs` row via
  // `fireHook` for the dashboard. Budget tracker is intentionally NOT
  // consulted: a zero-cost pass that's already gated by the incremental
  // cache doesn't need a daily-cap check.
  let hotspotsResult: HotspotsPassResult | undefined;
  if (runHotspots) {
    // Build the per-file inventory from the structure pass. We want one
    // entry per source file, not per node (a single file produces many
    // structure nodes).
    const repoRelFiles = collectUniqueFilePaths(structure);
    if (opts.dryRun) {
      // Hotspots makes zero LLM calls. Report 0 so dry-run reflects reality.
      summary.plannedCalls!.hotspots = 0;
    } else if (repoRelFiles.length === 0) {
      log('synth: hotspots skipped — no source files in structure pass');
      summary.hotspots = { scoredFiles: 0, hotspotsFound: 0, cardsWritten: 0 };
    } else {
      const hotspotsStartedAt = new Date();
      const inc = await gateIncremental('hotspots', hotspotsStartedAt);
      if (inc.skip) {
        summary.hotspots = {
          scoredFiles: 0,
          hotspotsFound: 0,
          cardsWritten: 0,
        };
      } else {
        try {
          const absFiles = repoRelFiles.map((rel) => join(opts.repoPath, rel));
          const result = await runHotspotsPass(repoId, {
            files: absFiles,
            repoRoot: opts.repoPath,
          });
          hotspotsResult = result;
          const write = await writeHotspotCards({
            outDir,
            repoId,
            cards: result.cards,
          });
          summary.hotspots = {
            scoredFiles: result.scores.length,
            hotspotsFound: result.hotspots.length,
            cardsWritten: write.cardsWritten,
          };
          log(
            `synth: hotspots → ${result.scores.length} file(s) scored, ` +
              `${result.hotspots.length} hotspot(s), ` +
              `${write.cardsWritten} card(s) written`,
          );
          await fireHook({
            ...result.passRun,
            startedAt: hotspotsStartedAt,
            finishedAt: new Date(),
          });
        } catch (err) {
          log(`synth: hotspots pass failed: ${(err as Error).message}`);
          summary.hotspots = {
            scoredFiles: 0,
            hotspotsFound: 0,
            cardsWritten: 0,
          };
          await fireHook({
            repoId,
            passName: 'hotspots',
            status: 'FAILED',
            tokenCost: 0,
            startedAt: hotspotsStartedAt,
            finishedAt: new Date(),
            errorMessage: (err as Error).message,
          });
        }
      }
    }
  }

  summary.totalTokens = tokensSpent;

  // Reference unused locals so future maintainers see the result objects
  // are preserved for debugging.
  void contractsResult;
  void gotchasResult;
  void hotspotsResult;

  return summary;
}

/**
 * Distinct source-file inventory drawn from the structure-pass nodes. Used
 * by the hotspots pass as its per-file universe. Returns repo-relative
 * POSIX paths.
 */
function collectUniqueFilePaths(structure: StructurePassResult): string[] {
  const out = new Set<string>();
  for (const node of structure.nodes) {
    if (node.filePath) out.add(node.filePath);
  }
  return Array.from(out).sort();
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers — input assembly + persistence glue
// ───────────────────────────────────────────────────────────────────────────

/**
 * Read every parsed source file into memory so contracts + gotchas can
 * slice signatures and detect TODO/FIXME/etc. without re-walking the disk.
 *
 * Repo-relative file paths from the structure pass are joined back to the
 * repo root for reading; we map by repo-relative key for downstream lookup.
 */
async function loadRepoSources(
  repoPath: string,
  structure: StructurePassResult,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const seen = new Set<string>();
  for (const node of structure.nodes) {
    if (!node.filePath || seen.has(node.filePath)) continue;
    seen.add(node.filePath);
    try {
      const body = await fs.readFile(join(repoPath, node.filePath), 'utf8');
      out.set(node.filePath, body);
    } catch {
      // Missing source is non-fatal — contracts will emit empty signatures.
    }
  }
  return out;
}

/**
 * The contracts extractor groups by *language*, so we partition Pass 1
 * nodes by `language` (peeked off a sibling parseResult) and run one
 * extraction per language. We approximate `language` from the file
 * extension when the node doesn't carry it.
 */
function buildContractsByLanguage(
  structure: StructurePassResult,
  sources: Map<string, string>,
): Array<{ language: string; modules: ContractModuleSymbols[] }> {
  const byLang = new Map<string, StructureNode[]>();
  for (const node of structure.nodes) {
    const lang = languageForPath(node.filePath);
    if (!lang) continue;
    const arr = byLang.get(lang) ?? [];
    arr.push(node);
    byLang.set(lang, arr);
  }
  const resolveSource = (filePath: string) => sources.get(filePath);
  const out: Array<{ language: string; modules: ContractModuleSymbols[] }> = [];
  for (const [language, nodes] of byLang) {
    const modules = buildContractsFromStructure(nodes, language, resolveSource);
    out.push({ language, modules });
  }
  return out;
}

function languageForPath(filePath: string): string | null {
  if (!filePath) return null;
  if (/\.(ts|tsx)$/.test(filePath)) return 'typescript';
  if (/\.(js|jsx|mjs|cjs)$/.test(filePath)) return 'javascript';
  if (/\.py$/.test(filePath)) return 'python';
  if (/\.go$/.test(filePath)) return 'go';
  return null;
}

/**
 * Group structure-pass files into per-module bundles for the gotchas pass.
 *
 * A "module" here is the directory containing one or more source files
 * (mirrors how the gotchas detector keys candidates). README.md / ADR-*.md
 * files in that directory are folded in as `siblingDocs`.
 */
function buildGotchasInputs(
  structure: StructurePassResult,
  sources: Map<string, string>,
): DetectGotchasInput[] {
  const byModule = new Map<
    string,
    { files: Map<string, string>; sibling: Map<string, string> }
  >();
  for (const node of structure.nodes) {
    if (!node.filePath) continue;
    const modulePath = posix.normalize(dirname(node.filePath));
    const slot = byModule.get(modulePath) ?? {
      files: new Map<string, string>(),
      sibling: new Map<string, string>(),
    };
    const source = sources.get(node.filePath);
    if (source !== undefined) slot.files.set(node.filePath, source);
    byModule.set(modulePath, slot);
  }
  const out: DetectGotchasInput[] = [];
  for (const [modulePath, slot] of byModule) {
    const files = Array.from(slot.files.entries()).map(([path, source]) => ({
      path,
      source,
      language: languageForPath(path) ?? undefined,
    }));
    if (files.length === 0) continue;
    out.push({
      modulePath,
      files,
      siblingDocs: Array.from(slot.sibling.entries()).map(([path, source]) => ({
        path,
        source,
      })),
    });
  }
  out.sort((a, b) => a.modulePath.localeCompare(b.modulePath));
  return out;
}

/**
 * Assemble the repository pass input from structure + subsystem results.
 *
 * Pulls the repo name from the basename, the language list from the file
 * extensions seen by Pass 1, the top-level dirs by inspection, and a
 * trimmed README excerpt when one exists.
 */
function buildRepositoryInput(
  structure: StructurePassResult,
  subsystemResult: SubsystemPassResult | undefined,
  repoPath: string,
): RepositoryInput {
  const languages = new Set<string>();
  const topDirs = new Set<string>();
  for (const node of structure.nodes) {
    const lang = languageForPath(node.filePath);
    if (lang) languages.add(lang);
    const seg = node.filePath.split('/')[0];
    if (seg && seg !== node.filePath) topDirs.add(seg);
  }
  let readme: string | undefined;
  try {
    // Synchronous read here is fine — single small file at the repo root.

    const { readFileSync } = require('node:fs');
    readme = readFileSync(join(repoPath, 'README.md'), 'utf8');
  } catch {
    readme = undefined;
  }

  const summaries: SubsystemSummary[] = subsystemResult
    ? subsystemResult.subsystems.map((s) => {
        const card = subsystemResult.cards.find(
          (c) =>
            c.conceptPath === `${subsystemResult.repoId}/subsystems/${s.slug}`,
        );
        return {
          name: s.name,
          slug: s.slug,
          description: s.description,
          memberModulePaths: [...s.memberModulePaths],
          standardCard: card?.content,
        };
      })
    : [];

  const name = defaultRepoId(repoPath);
  return {
    metadata: {
      name,
      languages: [...languages].sort(),
      topLevelDirs: [...topDirs].sort(),
      readme,
    },
    subsystems: summaries,
  };
}

/**
 * Persist module-level cards (contracts/gotchas output) through the EC-14
 * markdown writer so `GET /v1/cards/<module>` can serve them.
 *
 * The orchestrators emit `CardInput`s keyed by `${repoId}/${modulePath}` so
 * the on-disk path matches the spec's concept hierarchy.
 */
async function writeModuleCards(
  outDir: string,
  modules: Array<{ card: CardInput | null; modulePath: string }>,
  repoId: string,
  pass: 'contracts' | 'gotchas',
): Promise<void> {
  for (const m of modules) {
    if (!m.card) continue;
    // Strip the leading `repoId/` so the on-disk concept path is repo-relative.
    const conceptPath = m.card.conceptPath.startsWith(`${repoId}/`)
      ? m.card.conceptPath.slice(repoId.length + 1)
      : m.card.conceptPath;
    const existing = await tryReadCard(outDir, conceptPath);
    const card: Card = {
      conceptPath,
      kind: 'module',
      lod: existing?.lod ?? { index: '', summary: '', standard: '', deep: '' },
      metadata: {
        ...(existing?.metadata ?? {}),
        generated_at: new Date().toISOString(),
        repo_id: repoId,
        last_pass: pass,
      },
    };
    // STANDARD content from the pass overwrites the standard slot. We keep
    // any pre-existing index/summary/deep so the next pass enriches the
    // same card instead of clobbering it.
    card.lod.standard = m.card.content;
    if (!card.lod.summary) {
      card.lod.summary = firstParagraph(m.card.content);
    }
    if (!card.lod.index) {
      card.lod.index = `${conceptPath} — ${pass}`;
    }
    await writeCard(outDir, card);
  }
}

/** Try to read a card by concept path; returns null if it doesn't exist. */
async function tryReadCard(
  rootDir: string,
  conceptPath: string,
): Promise<Card | null> {
  try {
    return await readCard(cardFilePath(rootDir, conceptPath));
  } catch {
    return null;
  }
}

function firstParagraph(body: string): string {
  const idx = body.indexOf('\n\n');
  const para = idx === -1 ? body : body.slice(0, idx);
  return para.trim().slice(0, 400);
}

/**
 * Persist subsystem cards through the markdown writer so the v1 API
 * `GET /v1/cards/subsystems/<slug>` resolves.
 */
async function writeSubsystemCards(
  outDir: string,
  result: SubsystemPassResult,
  repoId: string,
): Promise<void> {
  for (const cardInput of result.cards) {
    const conceptPath = cardInput.conceptPath.startsWith(`${repoId}/`)
      ? cardInput.conceptPath.slice(repoId.length + 1)
      : cardInput.conceptPath;
    const card: Card = {
      conceptPath,
      kind: 'subsystem',
      lod: {
        index: `${conceptPath} — subsystem`,
        summary: firstParagraph(cardInput.content),
        standard: cardInput.content,
        deep: cardInput.content,
      },
      metadata: {
        generated_at: new Date().toISOString(),
        repo_id: repoId,
        last_pass: 'subsystem',
      },
    };
    await writeCard(outDir, card);
  }
}

/**
 * Persist the repository card at concept path `repository` so the dashboard
 * `HomeCard` can resolve it via `GET /v1/cards/repository`.
 *
 * We collapse all four LoDs from the repository pass into a single card and
 * stamp the canonical concept path used by the HomeCard component.
 */
async function writeRepositoryCard(
  outDir: string,
  result: RepositoryPassResult,
): Promise<void> {
  const byLod = new Map<string, string>();
  for (const c of result.cards) byLod.set(c.lod, c.content);
  const card: Card = {
    conceptPath: REPOSITORY_CARD_CONCEPT_PATH,
    kind: 'repository',
    lod: {
      index: byLod.get('INDEX') ?? '',
      summary: byLod.get('SUMMARY') ?? '',
      standard: byLod.get('STANDARD') ?? '',
      deep: byLod.get('DEEP') ?? '',
    },
    metadata: {
      generated_at: new Date().toISOString(),
      repo_id: result.repoId,
      last_pass: 'synthesis-repository',
      db_concept_path: repositoryConceptPath(result.repoId),
    },
  };
  await writeCard(outDir, card);
}

/**
 * Parse the positional + flag args for the synth command. Exposed so the
 * cli.ts dispatcher can call it without re-implementing argparse.
 */
export interface SynthArgs {
  subcommand: SynthSubcommand;
  repoPath: string;
  outDir?: string;
  repoId?: string;
  dryRun?: boolean;
  /** EC-46: force every pass to rerun, ignoring the incremental cache. */
  full?: boolean;
  /** EC-46: anchor the git diff at this ref instead of last successful PassRun. */
  since?: string;
}

export function parseSynthArgs(argv: string[]): SynthArgs {
  let subcommand: SynthSubcommand = 'all';
  let repoPath: string | undefined;
  let outDir: string | undefined;
  let repoId: string | undefined;
  let dryRun = false;
  let full = false;
  let since: string | undefined;

  const rest: string[] = [];
  if (argv.length > 0 && VALID_SUBCOMMANDS.includes(argv[0])) {
    subcommand = argv[0] as SynthSubcommand;
    rest.push(...argv.slice(1));
  } else {
    rest.push(...argv);
  }

  for (const arg of rest) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--full') {
      full = true;
    } else if (arg.startsWith('--since=')) {
      since = arg.slice('--since='.length);
    } else if (arg.startsWith('--out=')) {
      outDir = arg.slice('--out='.length);
    } else if (arg.startsWith('--repo-id=')) {
      repoId = arg.slice('--repo-id='.length);
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown flag "${arg}"`);
    } else if (!repoPath) {
      repoPath = arg;
    } else {
      throw new Error(`unexpected positional argument "${arg}"`);
    }
  }

  if (!repoPath) throw new Error('missing required <repo-path>');
  return { subcommand, repoPath, outDir, repoId, dryRun, full, since };
}

/** Re-export so cli.ts can build the human-readable summary block. */
export function renderSummary(summary: SynthRunSummary): string {
  const lines: string[] = [];
  lines.push(`engram-code synth: ${summary.repoPath}`);
  lines.push(
    `  config: ${summary.configSource ?? '<built-in defaults>'}; tokens spent ${summary.totalTokens}`,
  );
  if (summary.structure) {
    lines.push(
      `  structure: ${summary.structure.filesParsed}/${summary.structure.filesWalked} files parsed`,
    );
  }
  if (summary.contracts) {
    lines.push(
      `  contracts: ${summary.contracts.modulesAnnotated} module card(s), ${summary.contracts.tokensUsed} tokens, ${summary.contracts.errors} error(s)`,
    );
  }
  if (summary.gotchas) {
    lines.push(
      `  gotchas:   ${summary.gotchas.modulesAnnotated} module card(s), ${summary.gotchas.tokensUsed} tokens, ${summary.gotchas.errors} error(s)`,
    );
  }
  if (summary.subsystem) {
    lines.push(
      `  subsystem: ${summary.subsystem.subsystemsDiscovered} subsystem(s), ${summary.subsystem.tokensUsed} tokens, ${summary.subsystem.errors} error(s)`,
    );
  }
  if (summary.repository) {
    lines.push(
      `  repository: ${summary.repository.tokensUsed} tokens, ${summary.repository.fallbacks} LoD fallback(s)`,
    );
  }
  if (summary.dryRun && summary.plannedCalls) {
    lines.push('  dry-run plan:');
    for (const [pass, calls] of Object.entries(summary.plannedCalls)) {
      lines.push(`    - ${pass}: ${calls} planned LLM call(s)`);
    }
  }
  return lines.join('\n') + '\n';
}

// Tests that need to exercise the LLM injection path without an
// orchestrator round-trip may use this no-op LLM client.
export const NOOP_LLM_CLIENT: LLMClient = async (
  req: LLMRequest,
): Promise<LLMResponse> => {
  return {
    model: req.model,
    content: '',
    totalTokens: 0,
  };
};

// Reference unused imports referenced via types to silence eslint when
// strict no-unused-vars is on (we keep them imported as docs / signature
// anchors for nearby code).
void CONTRACTS_DEFAULT_MODEL;
void CONTRACTS_FALLBACK_MODEL;
void GOTCHAS_DEFAULT_MODEL;
void GOTCHAS_FALLBACK_MODEL;
void SUBSYSTEM_DEFAULT_MODEL;
void SUBSYSTEM_FALLBACK_MODEL;
void REPOSITORY_DEFAULT_MODEL;
void REPOSITORY_FALLBACK_MODEL;
void callOpenRouter;
void walkRepo;
void buildStubCards;
void relative;
