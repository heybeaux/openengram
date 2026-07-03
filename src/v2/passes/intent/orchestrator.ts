/**
 * Intent pass orchestrator (engram-code v2, Pass 2).
 *
 * Walks a Pass 1 structure result, groups it by module, builds an intent
 * prompt per module, calls the LLM, and emits an `intent.md` artifact +
 * card row per module.
 *
 * Phase 2 scope:
 *   - Module = directory containing source files. Modules are derived from
 *     the structure pass output (one per unique directory of any parsed file).
 *   - Default model = `google/gemini-2.5-flash` with `anthropic/claude-sonnet-4-6`
 *     fallback. Override via {@link IntentPassOptions.model}.
 *   - Budget guardrail: enforces a per-run total-token cap; modules that
 *     would push past the cap are skipped (logged in `skipped`).
 *
 * I/O is injected: the LLM client + file writer are options, so the test
 * suite can run without touching the network or disk.
 *
 * Spec: docs/specs/engram-code-v2.md §4.2 Pass 2, §4.4 Model routing.
 */

import { dirname, posix } from 'node:path';

import type {
  ParseResult,
  StructureEdge,
  StructureNode,
} from '../../parsers/types';
import type { CardInput, PassRunInput } from '../../types/cards';
import {
  callOpenRouter,
  type LLMClient,
} from '../../llm/openrouter';
import {
  buildIntentPrompt,
  DEFAULT_MAX_INPUT_TOKENS,
  DEFAULT_MAX_OUTPUT_TOKENS,
} from './prompt';

/** Default model + fallback per spec §4.4. */
export const INTENT_DEFAULT_MODEL = 'google/gemini-2.5-flash';
export const INTENT_FALLBACK_MODEL = 'anthropic/claude-sonnet-4-6';

/** Default total-tokens cap for a single intent run across all modules. */
export const INTENT_DEFAULT_RUN_TOKEN_CAP = 200_000;

/**
 * Per-module input the orchestrator builds before calling the LLM. Exposed
 * so tests can hand-craft modules without standing up a full structure pass.
 */
export interface IntentModuleInput {
  /** Repo-relative module path, e.g. `src/v2/passes/intent`. */
  modulePath: string;
  /** Structure slice for this module. */
  structure: Pick<ParseResult, 'nodes' | 'edges' | 'language'>;
  /** Files inside this module with their source bodies. */
  files: Array<{ path: string; source?: string }>;
  /** Optional README content sibling. */
  readme?: string;
}

/**
 * One result row per module. `intent` is the LLM output (or null on skip);
 * `card` is the {@link CardInput} ready for persistence.
 */
export interface IntentModuleResult {
  modulePath: string;
  intent: string | null;
  /** Reason a module was skipped — populated only when intent is null. */
  skipReason?: 'budget-exceeded' | 'no-source' | 'llm-error';
  /** Error message when skipReason='llm-error'. */
  errorMessage?: string;
  /** Card payload for persistence. Null when the module was skipped. */
  card: CardInput | null;
  /** Token cost reported by the LLM for this module. Zero on skip. */
  tokenCost: number;
  /** Whether the prompt was truncated to fit the input budget. */
  truncated: boolean;
}

export interface IntentPassOptions {
  /** Pluggable LLM client. Defaults to the real OpenRouter caller. */
  llm?: LLMClient;
  /** Override the primary model. */
  model?: string;
  /** Override the fallback model. */
  fallbackModel?: string;
  /** Per-module input cap (tokens). */
  maxInputTokens?: number;
  /** Per-module output cap (tokens). */
  maxOutputTokens?: number;
  /** Total-tokens cap for the whole run. */
  runTokenCap?: number;
}

export interface IntentPassResult {
  repoId: string;
  modules: IntentModuleResult[];
  /** Sum of `tokenCost` across all successful modules. */
  totalTokens: number;
  /** Ledger entry the conductor will persist into `pass_runs`. */
  passRun: PassRunInput;
}

/**
 * Given a Pass 1 structure result, group the nodes by their owning module
 * (directory) so the orchestrator can dispatch one LLM call per module.
 *
 * Module identity: the directory of the source file the node was extracted
 * from. Nodes without a `filePath` are skipped (defensive — extractors are
 * expected to populate it, but we don't want one bad node to drop a module).
 */
export function groupNodesByModule(
  nodes: StructureNode[],
  edges: StructureEdge[],
): Map<string, { nodes: StructureNode[]; edges: StructureEdge[]; files: Set<string> }> {
  const byModule = new Map<
    string,
    { nodes: StructureNode[]; edges: StructureEdge[]; files: Set<string> }
  >();

  for (const node of nodes) {
    const filePath = node.filePath;
    if (!filePath) continue;
    const modulePath = posix.normalize(dirname(filePath));
    const entry = byModule.get(modulePath) ?? {
      nodes: [],
      edges: [],
      files: new Set<string>(),
    };
    entry.nodes.push(node);
    entry.files.add(filePath);
    byModule.set(modulePath, entry);
  }

  // Edges are attributed by matching their qualified `from` to a node name in
  // the module. Best-effort — intent prompts only use the *count* of edges as
  // a coarse density hint, so partial attribution is fine.
  const nameToModule = new Map<string, string>();
  for (const [mod, entry] of byModule) {
    for (const n of entry.nodes) nameToModule.set(n.name, mod);
  }
  for (const edge of edges) {
    const mod = nameToModule.get(edge.from);
    if (!mod) continue;
    byModule.get(mod)?.edges.push(edge);
  }

  return byModule;
}

/**
 * Build the per-module input list from a Pass 1 result + a source resolver.
 * The resolver returns the raw text for a given file path; we don't read the
 * filesystem here so the orchestrator is unit-testable.
 */
export function buildModulesFromStructure(
  nodes: StructureNode[],
  edges: StructureEdge[],
  language: string,
  resolveSource: (filePath: string) => string | undefined,
  resolveReadme?: (modulePath: string) => string | undefined,
): IntentModuleInput[] {
  const grouped = groupNodesByModule(nodes, edges);
  const modules: IntentModuleInput[] = [];
  for (const [modulePath, entry] of grouped) {
    modules.push({
      modulePath,
      structure: { nodes: entry.nodes, edges: entry.edges, language },
      files: [...entry.files].map((path) => ({ path, source: resolveSource(path) })),
      readme: resolveReadme?.(modulePath),
    });
  }
  // Stable order — alphabetical by path. Easier to diff snapshots.
  modules.sort((a, b) => a.modulePath.localeCompare(b.modulePath));
  return modules;
}

/**
 * Run the intent pass.
 *
 * Returns one result per module + an aggregate token total + a `PassRun`
 * ledger entry. Persistence (writing markdown to disk, upserting cards) is
 * the caller's job — keeps this function pure-ish and testable.
 */
export async function runIntentPass(
  repoId: string,
  modules: IntentModuleInput[],
  opts: IntentPassOptions = {},
): Promise<IntentPassResult> {
  const llm = opts.llm ?? callOpenRouter;
  const model = opts.model ?? INTENT_DEFAULT_MODEL;
  const fallbackModel = opts.fallbackModel ?? INTENT_FALLBACK_MODEL;
  const maxInputTokens = opts.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS;
  const maxOutputTokens = opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const runCap = opts.runTokenCap ?? INTENT_DEFAULT_RUN_TOKEN_CAP;

  const startedAt = new Date();
  const results: IntentModuleResult[] = [];
  let totalTokens = 0;

  for (const mod of modules) {
    const hasSource = mod.files.some((f) => f.source && f.source.length > 0);
    if (!hasSource) {
      results.push({
        modulePath: mod.modulePath,
        intent: null,
        skipReason: 'no-source',
        card: null,
        tokenCost: 0,
        truncated: false,
      });
      continue;
    }

    if (totalTokens >= runCap) {
      results.push({
        modulePath: mod.modulePath,
        intent: null,
        skipReason: 'budget-exceeded',
        card: null,
        tokenCost: 0,
        truncated: false,
      });
      continue;
    }

    const built = buildIntentPrompt({
      modulePath: mod.modulePath,
      structure: mod.structure,
      files: mod.files,
      readme: mod.readme,
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

      const card: CardInput = {
        repoId,
        conceptPath: `${repoId}/${mod.modulePath}`,
        lod: 'STANDARD',
        level: 'MODULE',
        content: response.content,
        sourcePass: 'intent',
        tokenCount: response.completionTokens,
      };

      results.push({
        modulePath: mod.modulePath,
        intent: response.content,
        card,
        tokenCost: response.totalTokens,
        truncated: built.truncated,
      });
    } catch (err) {
      results.push({
        modulePath: mod.modulePath,
        intent: null,
        skipReason: 'llm-error',
        errorMessage: (err as Error).message,
        card: null,
        tokenCost: 0,
        truncated: built.truncated,
      });
    }
  }

  const finishedAt = new Date();
  const succeeded = results.filter((r) => r.intent !== null).length;
  const failed = results.filter((r) => r.skipReason === 'llm-error').length;

  const passRun: PassRunInput = {
    repoId,
    passName: 'intent',
    status: failed > 0 && succeeded === 0 ? 'FAILED' : 'SUCCESS',
    model,
    tokenCost: totalTokens,
    startedAt,
    finishedAt,
    errorMessage:
      failed > 0
        ? `${failed}/${modules.length} module(s) failed`
        : undefined,
  };

  return { repoId, modules: results, totalTokens, passRun };
}
