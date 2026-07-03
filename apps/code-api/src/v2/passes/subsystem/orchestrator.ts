/**
 * Subsystem-detection pass orchestrator (engram-code v2, Pass 4).
 *
 * End-to-end pipeline:
 *
 *   Pass 1 graph + Pass 2 intents
 *      │
 *      ▼
 *   buildModuleGraph()  ─►  detectClusters() (Louvain)
 *      │
 *      ▼
 *   per cluster: buildSubsystemPrompt() → LLM → parseSubsystemResponse()
 *      │
 *      ▼
 *   SubsystemDetectionResult { subsystems, cards, passRun }
 *
 * Like every other Pass 2+ orchestrator, this module is pure-ish:
 *   - LLM client is injected (real `callOpenRouter` by default).
 *   - Disk + DB I/O happen in `writer.ts` and {@link persistSubsystemPass}
 *     respectively — the latter takes an injected Prisma client.
 *
 * Idempotency: persistence upserts subsystems keyed on `(repoId, slug)` and
 * upserts cards on `(repoId, conceptPath, lod)` — re-running on the same
 * repo never duplicates a row.
 *
 * Spec: docs/specs/engram-code-v2.md §4.2 Pass 4, §4.4 (model routing),
 *       §4.5 (Subsystem model).
 */

import type { PrismaClient } from '@prisma/client';

import type {
  ParseResult,
  StructureEdge,
  StructureNode,
} from '../../parsers/types';
import type {
  CardInput,
  PassRunInput,
  SubsystemInput,
} from '../../types/cards';
import {
  callOpenRouter,
  type LLMClient,
} from '../../llm/openrouter';

import {
  buildIntentEdges,
  buildModuleGraph,
  detectClusters,
  isValidSubsystemName,
  MAX_SUBSYSTEMS,
  type DetectedCluster,
  type DetectorOptions,
  type ModuleEdge,
  type ModuleNode,
  slugifyName,
} from './detector';
import {
  buildSubsystemPrompt,
  DEFAULT_MAX_INPUT_TOKENS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  parseSubsystemResponse,
} from './prompt';

/** Per spec §4.4 — Gemini Flash primary, Sonnet fallback. */
export const SUBSYSTEM_DEFAULT_MODEL = 'google/gemini-2.5-flash';
export const SUBSYSTEM_FALLBACK_MODEL = 'anthropic/claude-sonnet-4-6';

/** Total-tokens cap across the naming step for one pass. */
export const SUBSYSTEM_DEFAULT_RUN_TOKEN_CAP = 100_000;

/** Env var the conductor reads to override the daily ceiling. */
export const EC_DAILY_TOKEN_CAP_ENV = 'EC_DAILY_TOKEN_CAP';

/**
 * Per-cluster result row. `subsystem` is populated when naming succeeded;
 * `skipReason` tells the caller why a cluster was dropped or left
 * deterministically named.
 */
export interface SubsystemPassClusterResult {
  clusterId: number;
  members: string[];
  /** Final subsystem name (LLM or deterministic fallback). */
  name: string;
  /** Final slug derived from `name`. */
  slug: string;
  /** Final description (LLM-supplied or empty). */
  description: string;
  /** True when the name came from the deterministic fallback. */
  nameFallback: boolean;
  /** Reason a cluster was *dropped entirely* — populated only when skipped. */
  skipReason?:
    | 'budget-exceeded'
    | 'llm-error'
    | 'invalid-name'
    | 'too-many-clusters';
  /** Error message when `skipReason === 'llm-error'`. */
  errorMessage?: string;
  /** Token cost reported by the LLM. Zero when no LLM call was made. */
  tokenCost: number;
  /** Whether the naming prompt was truncated. */
  truncated: boolean;
}

export interface SubsystemPassOptions extends DetectorOptions {
  llm?: LLMClient;
  model?: string;
  fallbackModel?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  runTokenCap?: number;
  /**
   * If true, suppress the `console.warn` we emit when intent embeddings are
   * unavailable. Defaults to false; tests flip this off.
   */
  quietWarnings?: boolean;
  /**
   * Hook for the conductor to log structured warnings instead of
   * `console.warn`. When set, takes precedence over `quietWarnings`.
   */
  onWarning?: (message: string, context?: Record<string, unknown>) => void;
}

export interface SubsystemPassResult {
  repoId: string;
  /** One per discovered cluster (including those skipped). */
  clusters: SubsystemPassClusterResult[];
  /** Subsystem rows ready for persistence — only successfully-named ones. */
  subsystems: SubsystemInput[];
  /** Card inputs (level=SUBSYSTEM, lod=STANDARD) for persistence. */
  cards: CardInput[];
  totalTokens: number;
  passRun: PassRunInput;
}

/**
 * Convenience: assemble the per-module input from a Pass 1 structure result
 * + per-module intent text. The orchestrator can consume this directly.
 *
 * `resolveIntent` returns the Pass-2 intent summary for a module path; it
 * returns `undefined` for modules without one. `resolveEmbedding` is
 * analogous — return `null`/`undefined` when no embedding exists, in which
 * case the soft-edge augmentation step is skipped for that module.
 */
export function buildModuleNodes(
  nodes: StructureNode[],
  resolveIntent?: (modulePath: string) => string | undefined,
  resolveEmbedding?: (modulePath: string) => number[] | null | undefined,
  resolveTopFiles?: (modulePath: string) => string[] | undefined,
): ModuleNode[] {
  const moduleSet = new Set<string>();
  for (const n of nodes) {
    if (!n.filePath) continue;
    const idx = n.filePath.lastIndexOf('/');
    moduleSet.add(idx < 0 ? '.' : n.filePath.slice(0, idx));
  }
  const out: ModuleNode[] = [];
  for (const modulePath of [...moduleSet].sort()) {
    out.push({
      modulePath,
      intent: resolveIntent?.(modulePath),
      embedding: resolveEmbedding?.(modulePath) ?? null,
      topFiles: resolveTopFiles?.(modulePath),
    });
  }
  return out;
}

/**
 * Run the subsystem-detection pass.
 *
 * 1. Build module graph from structure edges.
 * 2. Augment with intent-similarity edges (or skip + warn if no embeddings).
 * 3. Cluster with Louvain.
 * 4. For each cluster: call LLM to name it; fall back to a deterministic
 *    name when the LLM is unavailable or returns garbage.
 * 5. Emit `SubsystemInput`s + matching `SUBSYSTEM`-level cards.
 *
 * The function does NOT touch disk or DB — see {@link persistSubsystemPass}
 * and `writer.ts` for that.
 */
export async function runSubsystemPass(
  repoId: string,
  structureNodes: StructureNode[],
  structureEdges: StructureEdge[],
  moduleNodes: ModuleNode[],
  opts: SubsystemPassOptions = {},
): Promise<SubsystemPassResult> {
  const llm = opts.llm ?? callOpenRouter;
  const model = opts.model ?? SUBSYSTEM_DEFAULT_MODEL;
  const fallbackModel = opts.fallbackModel ?? SUBSYSTEM_FALLBACK_MODEL;
  const maxInputTokens = opts.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS;
  const maxOutputTokens = opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const runCap = opts.runTokenCap ?? resolveRunTokenCap();
  const warn = opts.onWarning ?? (opts.quietWarnings ? noopWarn : defaultWarn);

  const startedAt = new Date();

  // 1) Build the module graph from Pass 1 output.
  const { importEdges } = buildModuleGraph(structureNodes, structureEdges);

  // 2) Add soft intent-similarity edges where possible.
  const { edges: intentEdges, skippedReason } = buildIntentEdges(moduleNodes, opts);
  if (skippedReason) {
    warn(
      'subsystem-pass: intent-similarity augmentation skipped',
      { reason: skippedReason, moduleCount: moduleNodes.length },
    );
  }

  const allEdges: ModuleEdge[] = [...importEdges, ...intentEdges];

  // 3) Cluster.
  const clusters = detectClusters(moduleNodes, allEdges, opts);

  // 4) Name each cluster via the LLM (or fall back deterministically). When
  // the detector emits an absurd number of clusters (> MAX_SUBSYSTEMS),
  // we still process the top ones but mark the tail `too-many-clusters` so
  // they don't get persisted — the spec caps at 15 per repo.
  const results: SubsystemPassClusterResult[] = [];
  const subsystems: SubsystemInput[] = [];
  const cards: CardInput[] = [];
  let totalTokens = 0;
  let llmErrors = 0;

  // Look up intent + topFiles per module so we can hand them to the prompt.
  const moduleByPath = new Map<string, ModuleNode>();
  for (const m of moduleNodes) moduleByPath.set(m.modulePath, m);

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];

    if (i >= MAX_SUBSYSTEMS) {
      results.push({
        clusterId: cluster.clusterId,
        members: cluster.members,
        name: '',
        slug: '',
        description: '',
        nameFallback: false,
        skipReason: 'too-many-clusters',
        tokenCost: 0,
        truncated: false,
      });
      continue;
    }

    const members = cluster.members.map((modulePath) => {
      const mod = moduleByPath.get(modulePath);
      return {
        modulePath,
        intent: mod?.intent,
        topFiles: mod?.topFiles,
      };
    });

    const built = buildSubsystemPrompt({
      clusterId: cluster.clusterId,
      members,
      maxInputTokens,
    });

    let llmName: string | undefined;
    let llmDescription = '';
    let tokenCost = 0;
    let fallback = false;

    if (totalTokens >= runCap) {
      // Budget gone — fall back rather than skip entirely. A named cluster
      // (even with a deterministic name) is more useful than a hole.
      fallback = true;
    } else {
      try {
        const response = await llm({
          model,
          fallbackModel,
          prompt: built.prompt,
          system: built.system,
          maxOutputTokens,
        });
        totalTokens += response.totalTokens;
        tokenCost = response.totalTokens;
        const parsed = parseSubsystemResponse(response.content);
        if (parsed && isValidSubsystemName(parsed.name)) {
          llmName = parsed.name;
          llmDescription = parsed.description;
        } else {
          fallback = true;
        }
      } catch (err) {
        llmErrors += 1;
        fallback = true;
        results.push({
          clusterId: cluster.clusterId,
          members: cluster.members,
          name: '',
          slug: '',
          description: '',
          nameFallback: true,
          skipReason: 'llm-error',
          errorMessage: (err as Error).message,
          tokenCost: 0,
          truncated: built.truncated,
        });
        continue;
      }
    }

    const finalName = fallback || !llmName ? fallbackName(cluster) : llmName;
    const slug = slugifyName(finalName);
    if (!slug) {
      results.push({
        clusterId: cluster.clusterId,
        members: cluster.members,
        name: finalName,
        slug: '',
        description: llmDescription,
        nameFallback: true,
        skipReason: 'invalid-name',
        tokenCost,
        truncated: built.truncated,
      });
      continue;
    }

    const subsystem: SubsystemInput = {
      repoId,
      name: finalName,
      slug,
      description: llmDescription || undefined,
      memberModulePaths: cluster.members,
    };
    subsystems.push(subsystem);

    const card: CardInput = {
      repoId,
      conceptPath: `${repoId}/subsystems/${slug}`,
      lod: 'STANDARD',
      level: 'SUBSYSTEM',
      content: renderSubsystemMarkdown(subsystem, members),
      sourcePass: 'subsystem',
      tokenCount: tokenCost,
    };
    cards.push(card);

    results.push({
      clusterId: cluster.clusterId,
      members: cluster.members,
      name: finalName,
      slug,
      description: llmDescription,
      nameFallback: fallback,
      tokenCost,
      truncated: built.truncated,
    });
  }

  const finishedAt = new Date();

  const passRun: PassRunInput = {
    repoId,
    passName: 'subsystem',
    status:
      subsystems.length === 0 && llmErrors > 0
        ? 'FAILED'
        : 'SUCCESS',
    model,
    tokenCost: totalTokens,
    startedAt,
    finishedAt,
    errorMessage:
      llmErrors > 0
        ? `${llmErrors}/${clusters.length} cluster(s) failed naming`
        : undefined,
  };

  return {
    repoId,
    clusters: results,
    subsystems,
    cards,
    totalTokens,
    passRun,
  };
}

/**
 * Resolve the per-run token cap. Order of precedence:
 *   1. Explicit `runTokenCap` option (handled by the caller).
 *   2. `EC_DAILY_TOKEN_CAP` env var (positive integer).
 *   3. {@link SUBSYSTEM_DEFAULT_RUN_TOKEN_CAP}.
 *
 * Exposed so tests can exercise the env-var fall-back without spinning up
 * the full pass.
 */
export function resolveRunTokenCap(): number {
  const raw = process.env[EC_DAILY_TOKEN_CAP_ENV];
  if (!raw) return SUBSYSTEM_DEFAULT_RUN_TOKEN_CAP;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return SUBSYSTEM_DEFAULT_RUN_TOKEN_CAP;
}

/**
 * Render the per-subsystem markdown body. Used both as the `Card.content`
 * for the SUBSYSTEM-level card AND as the body of the on-disk artifact.
 */
export function renderSubsystemMarkdown(
  subsystem: SubsystemInput,
  members: Array<{ modulePath: string; intent?: string }>,
): string {
  const desc = subsystem.description
    ? `\n\n${subsystem.description}\n`
    : '';
  const memberLines = members.length
    ? members
        .map((m) => {
          const summary = m.intent ? oneLineSummary(m.intent) : '_(no intent recorded)_';
          return `- \`${m.modulePath}\` — ${summary}`;
        })
        .join('\n')
    : '_(no members)_';
  return (
    `## Subsystem: ${subsystem.name}\n` +
    `slug: \`${subsystem.slug}\`  ·  modules: ${subsystem.memberModulePaths.length}` +
    `${desc}\n\n### Modules\n\n${memberLines}\n`
  );
}

/**
 * Deterministic fallback name for a cluster when the LLM is unavailable or
 * returns an invalid label. Uses the alphabetically-first module path's
 * tail directory as a hint — never empty, never invalid.
 */
function fallbackName(cluster: DetectedCluster): string {
  if (cluster.members.length === 0) return `Cluster ${cluster.clusterId}`;
  const sample = cluster.members[0];
  const tail = sample.split('/').filter(Boolean).pop() ?? '';
  if (tail.length < 2) return `Cluster ${cluster.clusterId}`;
  const title = tail
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return `${title} Cluster`;
}

function oneLineSummary(text: string): string {
  // First non-empty line, trimmed to ~120 chars.
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return line.length > 120 ? line.slice(0, 117) + '...' : line;
}

function defaultWarn(message: string, context?: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.warn(message, context ?? {});
}

function noopWarn(): void {
  /* intentionally empty — used when `quietWarnings: true`. */
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Subset of Prisma we use. Keeping the surface minimal makes the mock easier
 * to write and isolates this module from `@prisma/client` runtime drift.
 */
export type SubsystemPersistClient = Pick<PrismaClient, 'card' | 'subsystem' | '$transaction'>;

export interface PersistSubsystemStats {
  subsystemsUpserted: number;
  cardsUpserted: number;
}

/**
 * Persist the subsystem pass output for a repo.
 *
 * Strategy:
 *   - For each `SubsystemInput`: upsert by `(repoId, slug)`. `name`,
 *     `description`, and `memberModulePaths` are refreshed on every run.
 *   - For each `CardInput`: upsert by the existing `(repoId, conceptPath, lod)`
 *     composite key. Re-running on the same repo never duplicates rows.
 *
 * Everything runs inside a single `$transaction` so a crash midway through
 * doesn't leave the repo with subsystems but no cards (or vice-versa).
 */
export async function persistSubsystemPass(
  client: SubsystemPersistClient,
  subsystems: SubsystemInput[],
  cards: CardInput[],
): Promise<PersistSubsystemStats> {
  // Pre-validate at the boundary — subsystem rows must have a slug, cards
  // must be SUBSYSTEM-level. Throwing here is preferable to a confusing
  // Prisma error inside the transaction.
  for (const s of subsystems) {
    if (!s.slug || s.slug.length < 3) {
      throw new Error(`persistSubsystemPass: invalid slug for "${s.name}"`);
    }
  }

  const runInTx = client.$transaction as unknown as (
    fn: (tx: SubsystemPersistClient) => Promise<unknown>,
  ) => Promise<unknown>;

  await runInTx(async (tx) => {
    for (const s of subsystems) {
      await tx.subsystem.upsert({
        where: { repoId_slug: { repoId: s.repoId, slug: s.slug } },
        create: {
          repoId: s.repoId,
          name: s.name,
          slug: s.slug,
          description: s.description,
          memberModulePaths: s.memberModulePaths,
        },
        update: {
          name: s.name,
          description: s.description,
          memberModulePaths: s.memberModulePaths,
        },
      });
    }

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

  return {
    subsystemsUpserted: subsystems.length,
    cardsUpserted: cards.length,
  };
}

// Silence "unused import" — `ParseResult` is re-exported by callers that
// hand structure-pass output to {@link runSubsystemPass}.
export type { ParseResult };
