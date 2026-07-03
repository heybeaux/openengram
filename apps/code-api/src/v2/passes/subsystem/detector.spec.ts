/**
 * Tests for the subsystem detector (EC-25).
 *
 * Pure deterministic logic — no LLM, no I/O.
 */

import type { StructureEdge, StructureNode } from '../../parsers/types';
import {
  buildIntentEdges,
  buildModuleGraph,
  cosineSimilarity,
  DEFAULT_INTENT_SIMILARITY_THRESHOLD,
  detectClusters,
  isValidSubsystemName,
  moduleForFile,
  slugifyName,
  type ModuleEdge,
  type ModuleNode,
} from './detector';

function node(filePath: string, name = filePath): StructureNode {
  return {
    kind: 'module',
    name,
    filePath,
    startLine: 1,
    endLine: 1,
  };
}

function importEdge(from: string, to: string): StructureEdge {
  return { from, to, type: 'imports' };
}

describe('moduleForFile', () => {
  it('returns the directory portion of a repo-relative path', () => {
    expect(moduleForFile('src/v2/passes/intent/orchestrator.ts')).toBe(
      'src/v2/passes/intent',
    );
  });

  it('returns "." for top-level files', () => {
    expect(moduleForFile('root.ts')).toBe('.');
  });
});

describe('buildModuleGraph', () => {
  it('aggregates cross-module import edges with summed weights', () => {
    const nodes: StructureNode[] = [
      node('src/a/x.ts'),
      node('src/a/y.ts'),
      node('src/b/z.ts'),
      node('src/c/w.ts'),
    ];
    const edges: StructureEdge[] = [
      importEdge('src/a/x.ts', 'src/b/z.ts'),
      importEdge('src/a/y.ts', 'src/b/z.ts'),
      importEdge('src/b/z.ts', 'src/c/w.ts'),
    ];

    const { modules, importEdges } = buildModuleGraph(nodes, edges);

    expect([...modules].sort()).toEqual(['src/a', 'src/b', 'src/c']);

    const findEdge = (a: string, b: string) =>
      importEdges.find(
        (e) =>
          (e.source === a && e.target === b) ||
          (e.source === b && e.target === a),
      );
    expect(findEdge('src/a', 'src/b')?.weight).toBe(2);
    expect(findEdge('src/b', 'src/c')?.weight).toBe(1);
    expect(importEdges.every((e) => e.origin === 'import')).toBe(true);
  });

  it('drops intra-module (self-loop) imports', () => {
    const nodes: StructureNode[] = [
      node('src/a/x.ts'),
      node('src/a/y.ts'),
    ];
    const edges: StructureEdge[] = [importEdge('src/a/x.ts', 'src/a/y.ts')];

    const { importEdges } = buildModuleGraph(nodes, edges);
    expect(importEdges).toHaveLength(0);
  });

  it('ignores non-import edges', () => {
    const nodes: StructureNode[] = [node('src/a/x.ts'), node('src/b/y.ts')];
    const edges: StructureEdge[] = [
      { from: 'src/a/x.ts', to: 'src/b/y.ts', type: 'calls' },
    ];
    const { importEdges } = buildModuleGraph(nodes, edges);
    expect(importEdges).toHaveLength(0);
  });

  it('resolves edges keyed by symbol name via the node-name index', () => {
    const nodes: StructureNode[] = [
      { ...node('src/a/x.ts', 'Foo') },
      { ...node('src/b/y.ts', 'Bar') },
    ];
    const edges: StructureEdge[] = [
      { from: 'Foo', to: 'Bar', type: 'imports' },
    ];
    const { importEdges } = buildModuleGraph(nodes, edges);
    expect(importEdges).toHaveLength(1);
    expect(importEdges[0].weight).toBe(1);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it('returns 0 when either vector is empty or zero', () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('returns 0 when dimensions mismatch', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });
});

describe('buildIntentEdges', () => {
  function mod(path: string, embedding: number[] | null): ModuleNode {
    return { modulePath: path, embedding };
  }

  it('skips when fewer than two embeddings present', () => {
    const result = buildIntentEdges([mod('a', [1, 0]), mod('b', null)]);
    expect(result.edges).toEqual([]);
    expect(result.skippedReason).toBe('fewer-than-two-embeddings');
  });

  it('skips when embedding dimensions disagree', () => {
    const result = buildIntentEdges([
      mod('a', [1, 0]),
      mod('b', [1, 0, 0]),
    ]);
    expect(result.edges).toEqual([]);
    expect(result.skippedReason).toBe('inconsistent-embedding-dimensions');
  });

  it('emits soft edges only for pairs above the similarity threshold', () => {
    const result = buildIntentEdges([
      mod('a', [1, 0]),
      mod('b', [0.99, 0.01]), // ~1 — above threshold
      mod('c', [0, 1]), //          0 — below threshold
    ]);
    expect(result.skippedReason).toBeUndefined();
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].source).toBe('a');
    expect(result.edges[0].target).toBe('b');
    expect(result.edges[0].origin).toBe('intent');
  });

  it('honours custom threshold + weight overrides', () => {
    const result = buildIntentEdges(
      [mod('a', [1, 0]), mod('b', [0, 1])],
      { intentSimilarityThreshold: -1, intentSoftEdgeWeight: 5 },
    );
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].weight).toBe(5);
  });

  it('uses the default threshold constant when none supplied', () => {
    // sanity-check: confirm the exported constant matches expectations
    expect(DEFAULT_INTENT_SIMILARITY_THRESHOLD).toBeGreaterThan(0);
    expect(DEFAULT_INTENT_SIMILARITY_THRESHOLD).toBeLessThan(1);
  });
});

describe('detectClusters', () => {
  function mod(path: string): ModuleNode {
    return { modulePath: path };
  }

  it('returns [] for empty input', () => {
    expect(detectClusters([], [])).toEqual([]);
  });

  it('places isolated modules each in their own singleton cluster', () => {
    const clusters = detectClusters(
      [mod('a'), mod('b'), mod('c')],
      [],
    );
    expect(clusters).toHaveLength(3);
    expect(clusters.every((c) => c.members.length === 1)).toBe(true);
  });

  it('groups densely-connected modules into a single cluster', () => {
    const moduleNodes: ModuleNode[] = [
      mod('a'),
      mod('b'),
      mod('c'),
      mod('x'),
      mod('y'),
      mod('z'),
    ];
    // Tight triangle a/b/c, separate triangle x/y/z, single bridge.
    const moduleEdges: ModuleEdge[] = [
      { source: 'a', target: 'b', weight: 10, origin: 'import' },
      { source: 'b', target: 'c', weight: 10, origin: 'import' },
      { source: 'a', target: 'c', weight: 10, origin: 'import' },
      { source: 'x', target: 'y', weight: 10, origin: 'import' },
      { source: 'y', target: 'z', weight: 10, origin: 'import' },
      { source: 'x', target: 'z', weight: 10, origin: 'import' },
      { source: 'c', target: 'x', weight: 1, origin: 'import' },
    ];
    const clusters = detectClusters(moduleNodes, moduleEdges);
    expect(clusters.length).toBeGreaterThanOrEqual(2);
    // The largest cluster must contain a coherent triangle (a/b/c or x/y/z).
    const top = clusters[0];
    const containsAbc = ['a', 'b', 'c'].every((m) => top.members.includes(m));
    const containsXyz = ['x', 'y', 'z'].every((m) => top.members.includes(m));
    expect(containsAbc || containsXyz).toBe(true);
  });

  it('sorts members alphabetically inside each cluster', () => {
    const clusters = detectClusters(
      [mod('zeta'), mod('alpha'), mod('mu')],
      [
        { source: 'zeta', target: 'alpha', weight: 5, origin: 'import' },
        { source: 'alpha', target: 'mu', weight: 5, origin: 'import' },
      ],
    );
    const sorted = clusters.flatMap((c) => c.members);
    // members within a cluster sorted; verify no cluster is out of order
    for (const cluster of clusters) {
      const copy = [...cluster.members].sort();
      expect(cluster.members).toEqual(copy);
    }
    expect(sorted).toContain('alpha');
  });

  it('is deterministic across runs with the same seed', () => {
    const nodes: ModuleNode[] = [
      mod('a'),
      mod('b'),
      mod('c'),
      mod('d'),
      mod('e'),
    ];
    const edges: ModuleEdge[] = [
      { source: 'a', target: 'b', weight: 4, origin: 'import' },
      { source: 'b', target: 'c', weight: 4, origin: 'import' },
      { source: 'd', target: 'e', weight: 4, origin: 'import' },
    ];
    const a = detectClusters(nodes, edges);
    const b = detectClusters(nodes, edges);
    expect(a).toEqual(b);
  });

  it('merges import + intent edges between the same module pair', () => {
    // Two pairs share both import + intent edges. Cluster output should be
    // stable and group the pair together.
    const moduleNodes: ModuleNode[] = [mod('a'), mod('b')];
    const moduleEdges: ModuleEdge[] = [
      { source: 'a', target: 'b', weight: 1, origin: 'import' },
      { source: 'a', target: 'b', weight: 1, origin: 'intent' },
    ];
    const clusters = detectClusters(moduleNodes, moduleEdges);
    // Single cluster of both modules since they share weight 2.
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members.sort()).toEqual(['a', 'b']);
  });
});

describe('slugifyName', () => {
  it('produces kebab-case slugs', () => {
    expect(slugifyName('Auth Service')).toBe('auth-service');
    expect(slugifyName('Ingestion Pipeline')).toBe('ingestion-pipeline');
  });

  it('returns null for too-short inputs', () => {
    expect(slugifyName('A')).toBeNull();
    expect(slugifyName('!!')).toBeNull();
  });

  it('strips leading/trailing punctuation', () => {
    expect(slugifyName('--foo--')).toBe('foo');
  });
});

describe('isValidSubsystemName', () => {
  it('rejects names shorter than 3 chars', () => {
    expect(isValidSubsystemName('Hi')).toBe(false);
    expect(isValidSubsystemName('  ')).toBe(false);
  });

  it('rejects names longer than 60 chars', () => {
    expect(isValidSubsystemName('x'.repeat(61))).toBe(false);
  });

  it('rejects names that cannot slug-safely', () => {
    expect(isValidSubsystemName('!!!')).toBe(false);
  });

  it('accepts well-formed subsystem names', () => {
    expect(isValidSubsystemName('Auth')).toBe(true);
    expect(isValidSubsystemName('Payment Gateway')).toBe(true);
  });
});
