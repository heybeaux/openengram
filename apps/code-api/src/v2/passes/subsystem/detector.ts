/**
 * Subsystem detection (engram-code v2, Pass 4).
 *
 * Discovers — rather than declares — subsystems by clustering the module
 * graph. Two signals feed the graph:
 *
 *   1. **Import topology (hard edges).** From Pass 1: a module-level graph
 *      where nodes are modules (directories) and edges are import counts
 *      between modules. Heavy import traffic → modules belong together.
 *   2. **Intent similarity (soft edges).** From Pass 2: cosine similarity
 *      between per-module intent embeddings. Pairs above
 *      {@link DEFAULT_INTENT_SIMILARITY_THRESHOLD} get a small bonus weight.
 *      Skipped gracefully when no embeddings are available (an early Pass 2
 *      may have stored cards without vectors).
 *
 * The combined undirected weighted graph is partitioned with Louvain
 * community detection (`graphology-communities-louvain`) and the resulting
 * cluster IDs are returned with their member module paths.
 *
 * Determinism: Louvain depends on iteration order + an RNG. We pass a seeded
 * RNG so the same input always yields the same clusters in tests — the
 * orchestrator may override this in production runs where stochasticity is
 * fine.
 *
 * Spec: docs/specs/engram-code-v2.md §4.2 Pass 4, §4.5 (Subsystem model).
 */

import louvain from 'graphology-communities-louvain';
import Graph from 'graphology';

import type { StructureEdge, StructureNode } from '../../parsers/types';

/** Pairs above this cosine similarity get a soft intent edge. */
export const DEFAULT_INTENT_SIMILARITY_THRESHOLD = 0.7;

/**
 * Soft-edge weight added when an intent-similarity pair clears the
 * threshold. Chosen so a single intent-match equals roughly one import edge
 * — strong enough to nudge clustering but not overwhelm topology.
 */
export const DEFAULT_INTENT_SOFT_EDGE_WEIGHT = 1;

/** Cluster size guardrails per spec — 3–15 subsystems per repo. */
export const MIN_SUBSYSTEMS = 1;
export const MAX_SUBSYSTEMS = 15;

/**
 * Module-level node used during clustering. Carries the bare minimum the
 * Louvain pass needs plus a few attributes the orchestrator forwards into
 * the LLM naming step.
 */
export interface ModuleNode {
  /** Repo-relative module path (e.g. `src/v2/passes/intent`). */
  modulePath: string;
  /** Intent summary from Pass 2, if known. Used downstream for naming. */
  intent?: string;
  /** Optional intent embedding (Pass 2 may store these on cards). */
  embedding?: number[] | null;
  /** Top file paths inside the module, used downstream for naming. */
  topFiles?: string[];
}

/**
 * Edge between two modules. Direction is dropped — clustering is undirected.
 * `weight` defaults to the count of underlying import edges.
 */
export interface ModuleEdge {
  source: string;
  target: string;
  weight: number;
  /** Provenance: how the edge was produced — useful for debugging. */
  origin: 'import' | 'intent';
}

/** One discovered cluster. Slug + name are filled by the orchestrator. */
export interface DetectedCluster {
  /** Stable integer cluster id from Louvain. */
  clusterId: number;
  /** Member module paths, sorted alphabetically. */
  members: string[];
}

export interface DetectorOptions {
  /** Cosine threshold above which an intent-similarity edge is added. */
  intentSimilarityThreshold?: number;
  /** Soft-edge weight for intent matches. */
  intentSoftEdgeWeight?: number;
  /** Override the Louvain RNG. Defaults to a seeded mulberry32. */
  rng?: () => number;
  /** Optional resolution parameter for Louvain (>1 → more clusters). */
  resolution?: number;
}

/**
 * Build the module graph from Pass 1's node/edge output.
 *
 * Modules are derived from the directory of each node's `filePath`. An
 * import edge between two modules is added when a Pass 1 `imports` edge
 * crosses the directory boundary. Self-loops (intra-module imports) are
 * dropped — they don't tell us anything about clustering.
 *
 * Returns a Map keyed by module path so callers can attach extra attributes
 * (intent text, embedding) before clustering.
 */
export function buildModuleGraph(
  nodes: StructureNode[],
  edges: StructureEdge[],
): {
  modules: Set<string>;
  importEdges: ModuleEdge[];
} {
  const fileToModule = new Map<string, string>();
  const modules = new Set<string>();

  for (const node of nodes) {
    if (!node.filePath) continue;
    const mod = moduleForFile(node.filePath);
    fileToModule.set(node.filePath, mod);
    modules.add(mod);
  }

  // Also map node-names to modules (so name-keyed edges from Pass 1 can be
  // attributed). Pass 1 uses qualified names for `from`/`to`, but it also
  // sometimes uses file paths — handle both.
  const nameToModule = new Map<string, string>();
  for (const node of nodes) {
    if (!node.filePath) continue;
    nameToModule.set(node.name, moduleForFile(node.filePath));
  }

  // Aggregate import edges into module pairs, summing weights.
  const pairWeights = new Map<string, number>();
  for (const edge of edges) {
    if (edge.type !== 'imports') continue;
    const fromMod = resolveModule(edge.from, fileToModule, nameToModule);
    const toMod = resolveModule(edge.to, fileToModule, nameToModule);
    if (!fromMod || !toMod) continue;
    if (fromMod === toMod) continue;
    const key = canonicalPairKey(fromMod, toMod);
    pairWeights.set(key, (pairWeights.get(key) ?? 0) + 1);
  }

  const importEdges: ModuleEdge[] = [];
  for (const [key, weight] of pairWeights) {
    const [source, target] = key.split('\u0000');
    importEdges.push({ source, target, weight, origin: 'import' });
  }

  return { modules, importEdges };
}

/**
 * Add soft edges based on cosine similarity of per-module intent embeddings.
 *
 * When `embeddings` is empty or sparse, returns an empty list and the caller
 * is expected to log a warning. We do not throw — a Phase 2 repo without
 * embeddings is a valid state.
 */
export function buildIntentEdges(
  modules: ModuleNode[],
  options: Pick<DetectorOptions, 'intentSimilarityThreshold' | 'intentSoftEdgeWeight'> = {},
): { edges: ModuleEdge[]; skippedReason?: string } {
  const threshold = options.intentSimilarityThreshold ?? DEFAULT_INTENT_SIMILARITY_THRESHOLD;
  const weight = options.intentSoftEdgeWeight ?? DEFAULT_INTENT_SOFT_EDGE_WEIGHT;

  const withEmbeddings = modules.filter(
    (m) => Array.isArray(m.embedding) && m.embedding.length > 0,
  );
  if (withEmbeddings.length < 2) {
    return {
      edges: [],
      skippedReason: 'fewer-than-two-embeddings',
    };
  }

  // Sanity check: every embedding must share the same dimensionality.
  const dim = withEmbeddings[0].embedding!.length;
  const consistent = withEmbeddings.every((m) => m.embedding!.length === dim);
  if (!consistent) {
    return {
      edges: [],
      skippedReason: 'inconsistent-embedding-dimensions',
    };
  }

  const edges: ModuleEdge[] = [];
  for (let i = 0; i < withEmbeddings.length; i++) {
    for (let j = i + 1; j < withEmbeddings.length; j++) {
      const a = withEmbeddings[i];
      const b = withEmbeddings[j];
      const sim = cosineSimilarity(a.embedding!, b.embedding!);
      if (sim < threshold) continue;
      edges.push({
        source: a.modulePath,
        target: b.modulePath,
        weight,
        origin: 'intent',
      });
    }
  }

  return { edges };
}

/**
 * Run Louvain community detection. Modules with no edges of any kind are
 * placed each in their own singleton cluster — Louvain would refuse them
 * otherwise, and downstream "subsystem of one orphan module" rows are
 * fine (the orchestrator filters them by size when appropriate).
 *
 * Returns clusters sorted by size descending, then by leader-module path
 * alphabetically — gives a stable iteration order for tests + diffs.
 */
export function detectClusters(
  moduleNodes: ModuleNode[],
  moduleEdges: ModuleEdge[],
  options: DetectorOptions = {},
): DetectedCluster[] {
  if (moduleNodes.length === 0) return [];

  // 1) Build a Graphology undirected weighted graph.
  const graph = new Graph({ type: 'undirected', multi: false });
  for (const mod of moduleNodes) {
    if (!graph.hasNode(mod.modulePath)) graph.addNode(mod.modulePath);
  }
  for (const edge of moduleEdges) {
    if (!graph.hasNode(edge.source)) graph.addNode(edge.source);
    if (!graph.hasNode(edge.target)) graph.addNode(edge.target);
    if (graph.hasEdge(edge.source, edge.target)) {
      // Merge weights when both import + intent edges exist between a pair.
      const existing = graph.getEdgeAttribute(
        graph.edge(edge.source, edge.target),
        'weight',
      ) as number;
      graph.setEdgeAttribute(
        graph.edge(edge.source, edge.target),
        'weight',
        existing + edge.weight,
      );
    } else {
      graph.addEdge(edge.source, edge.target, { weight: edge.weight });
    }
  }

  // 2) Run Louvain. Singletons (no edges) are auto-assigned their own
  // community by the library.
  const rng = options.rng ?? mulberry32(0xc0ffee);
  const mapping = graph.size > 0
    ? louvain(graph, {
        getEdgeWeight: 'weight',
        resolution: options.resolution ?? 1,
        rng,
      })
    : isolatedNodesMapping(graph);

  // 3) Group module paths by cluster id.
  const byCluster = new Map<number, string[]>();
  for (const [modulePath, clusterId] of Object.entries(mapping)) {
    const arr = byCluster.get(clusterId) ?? [];
    arr.push(modulePath);
    byCluster.set(clusterId, arr);
  }

  const clusters: DetectedCluster[] = [];
  for (const [clusterId, members] of byCluster) {
    members.sort((a, b) => a.localeCompare(b));
    clusters.push({ clusterId, members });
  }
  clusters.sort((a, b) => {
    const sizeDiff = b.members.length - a.members.length;
    if (sizeDiff !== 0) return sizeDiff;
    return a.members[0].localeCompare(b.members[0]);
  });

  return clusters;
}

/** Derive a module path (directory) from a repo-relative file path. */
export function moduleForFile(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx < 0 ? '.' : filePath.slice(0, idx);
}

/**
 * Cosine similarity for two equal-length numeric vectors. Returns 0 when
 * either input is the zero vector.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Slugify a candidate subsystem name into kebab-case `[a-z0-9-]+`.
 *
 * Returns `null` when the input cannot produce a slug at least 3 chars long
 * — the orchestrator uses that signal to reject the LLM suggestion and fall
 * back to a deterministic name.
 */
export function slugifyName(name: string): string | null {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length < 3) return null;
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) return null;
  return slug;
}

/**
 * Validate a name candidate from the LLM. Mirror of {@link slugifyName} but
 * checks the *display* name rather than the slug.
 */
export function isValidSubsystemName(name: string): boolean {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (trimmed.length < 3) return false;
  if (trimmed.length > 60) return false;
  return slugifyName(trimmed) !== null;
}

function resolveModule(
  endpoint: string,
  fileToModule: Map<string, string>,
  nameToModule: Map<string, string>,
): string | undefined {
  // Endpoint might be a file path, a node name, or a module-style import
  // (e.g. `./logger`). Try file lookup first, then symbol-name fallback.
  const byFile = fileToModule.get(endpoint);
  if (byFile) return byFile;
  return nameToModule.get(endpoint);
}

function canonicalPairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function isolatedNodesMapping(graph: Graph): Record<string, number> {
  const out: Record<string, number> = {};
  let next = 0;
  graph.forEachNode((node) => {
    out[node] = next++;
  });
  return out;
}

/**
 * Seeded RNG so tests are deterministic. Mulberry32 — small, fast, good
 * enough for clustering. Not cryptographic, deliberately.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
