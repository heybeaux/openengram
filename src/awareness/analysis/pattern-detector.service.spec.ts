import { PatternDetectorService } from './pattern-detector.service';
import { Observation } from '../signals/signal.interface';

describe('PatternDetectorService', () => {
  let service: PatternDetectorService;

  beforeEach(() => {
    service = new PatternDetectorService();
  });

  // ── Helper to build observations ──────────────────────────────────────

  function makeHotEntitiesObs(
    entities: Array<{
      id: string;
      name: string;
      type: string;
      mentionCount: number;
    }>,
    id = 'hot-entities-test',
  ): Observation {
    return {
      id,
      source: 'memory',
      content: `Top recurring entities: ${entities.map((e) => `${e.name} (${e.type}, ${e.mentionCount})`).join(', ')}`,
      observedAt: new Date(),
      metadata: { entities },
    };
  }

  function makeNewMemoriesObs(
    count: number,
    memoryIds: string[] = [],
  ): Observation {
    return {
      id: `new-memories-test`,
      source: 'memory',
      content: `${count} new memories`,
      observedAt: new Date(),
      relatedMemoryIds: memoryIds,
      metadata: { count },
    };
  }

  function makeStaleObs(): Observation {
    return {
      id: 'stale-memories-test',
      source: 'memory',
      content: '5 important memories have never been retrieved',
      observedAt: new Date(),
      relatedMemoryIds: ['m1', 'm2'],
    };
  }

  function makeCrossCuttingObs(): Observation {
    return {
      id: 'cross-cutting-test',
      source: 'memory',
      content: 'Cross-cutting sample of 20 memories',
      observedAt: new Date(),
      relatedMemoryIds: ['m1', 'm2', 'm3'],
    };
  }

  // ── Noise filtering ───────────────────────────────────────────────────

  describe('noise filtering', () => {
    it('should NOT generate patterns for PERSON entities', () => {
      const obs = makeHotEntitiesObs([
        { id: '1', name: 'Beaux', type: 'PERSON', mentionCount: 402 },
        { id: '2', name: 'Rook', type: 'PERSON', mentionCount: 200 },
      ]);
      const patterns = service.detect([obs]);
      const recurring = patterns.filter((p) => p.type === 'recurring_pattern');
      expect(recurring).toHaveLength(0);
    });

    it('should NOT generate patterns for DATE entities', () => {
      const obs = makeHotEntitiesObs([
        { id: '1', name: '2026-02-20', type: 'DATE', mentionCount: 237 },
        { id: '2', name: '2026-01-15', type: 'DATE', mentionCount: 150 },
      ]);
      const patterns = service.detect([obs]);
      const recurring = patterns.filter((p) => p.type === 'recurring_pattern');
      expect(recurring).toHaveLength(0);
    });

    it('should NOT generate patterns for ISO date strings even without DATE type', () => {
      const obs = makeHotEntitiesObs([
        { id: '1', name: '2026-02', type: 'TOPIC', mentionCount: 300 },
      ]);
      const patterns = service.detect([obs]);
      const recurring = patterns.filter((p) => p.type === 'recurring_pattern');
      expect(recurring).toHaveLength(0);
    });

    it('should NOT generate patterns for pure numbers', () => {
      const obs = makeHotEntitiesObs([
        { id: '1', name: '42', type: 'QUANTITY', mentionCount: 100 },
      ]);
      const patterns = service.detect([obs]);
      const recurring = patterns.filter((p) => p.type === 'recurring_pattern');
      expect(recurring).toHaveLength(0);
    });

    it('should NOT generate patterns for very short entity names', () => {
      const obs = makeHotEntitiesObs([
        { id: '1', name: 'AI', type: 'TOPIC', mentionCount: 500 },
      ]);
      const patterns = service.detect([obs]);
      const recurring = patterns.filter((p) => p.type === 'recurring_pattern');
      expect(recurring).toHaveLength(0);
    });
  });

  // ── Concentration detection ───────────────────────────────────────────

  describe('concentration detection', () => {
    it('should detect when one entity dominates (>40% share, ≥20 mentions)', () => {
      const obs = makeHotEntitiesObs([
        { id: '1', name: 'Engram', type: 'PROJECT', mentionCount: 80 },
        { id: '2', name: 'Railway', type: 'TOOL', mentionCount: 10 },
        { id: '3', name: 'Prisma', type: 'TOOL', mentionCount: 10 },
      ]);
      const patterns = service.detect([obs]);
      const recurring = patterns.filter((p) => p.type === 'recurring_pattern');
      expect(recurring.length).toBeGreaterThanOrEqual(1);
      expect(recurring[0].description).toContain('Engram');
      expect(recurring[0].description).toContain('dominates');
    });

    it('should NOT flag concentration for entities under 20 mentions', () => {
      const obs = makeHotEntitiesObs([
        { id: '1', name: 'TestThing', type: 'PROJECT', mentionCount: 15 },
        { id: '2', name: 'Other', type: 'TOOL', mentionCount: 5 },
      ]);
      const patterns = service.detect([obs]);
      const recurring = patterns.filter((p) => p.type === 'recurring_pattern');
      expect(recurring).toHaveLength(0);
    });

    it('should NOT flag when mentions are evenly distributed', () => {
      const obs = makeHotEntitiesObs([
        { id: '1', name: 'Alpha', type: 'PROJECT', mentionCount: 25 },
        { id: '2', name: 'Bravo', type: 'PROJECT', mentionCount: 25 },
        { id: '3', name: 'Charlie', type: 'PROJECT', mentionCount: 25 },
      ]);
      const patterns = service.detect([obs]);
      const recurring = patterns.filter((p) => p.type === 'recurring_pattern');
      // ~33% share each, under 40% threshold
      expect(recurring).toHaveLength(0);
    });
  });

  // ── Cluster detection ─────────────────────────────────────────────────

  describe('cluster detection', () => {
    it('should detect entity clusters (≥3 entities with ≥15 mentions)', () => {
      const obs = makeHotEntitiesObs([
        { id: '1', name: 'Engram', type: 'PROJECT', mentionCount: 80 },
        { id: '2', name: 'Railway', type: 'TOOL', mentionCount: 20 },
        { id: '3', name: 'Prisma', type: 'TOOL', mentionCount: 30 },
        { id: '4', name: 'PostgreSQL', type: 'TOOL', mentionCount: 25 },
      ]);
      const patterns = service.detect([obs]);
      const connections = patterns.filter(
        (p) => p.type === 'pattern_connection',
      );
      expect(connections.length).toBeGreaterThanOrEqual(1);
      expect(connections[0].description).toContain('cluster');
    });

    it('should NOT flag clusters when fewer than 3 entities are active', () => {
      const obs = makeHotEntitiesObs([
        { id: '1', name: 'Engram', type: 'PROJECT', mentionCount: 80 },
        { id: '2', name: 'Railway', type: 'TOOL', mentionCount: 20 },
      ]);
      const patterns = service.detect([obs]);
      const connections = patterns.filter(
        (p) =>
          p.type === 'pattern_connection' && p.description.includes('cluster'),
      );
      expect(connections).toHaveLength(0);
    });
  });

  // ── Deduplication ─────────────────────────────────────────────────────

  describe('deduplication', () => {
    it('should not produce duplicate patterns within the same cycle', () => {
      // Two hot-entities observations with the same entity
      const obs1 = makeHotEntitiesObs(
        [{ id: '1', name: 'Engram', type: 'PROJECT', mentionCount: 80 }],
        'hot-entities-aaa',
      );
      const obs2 = makeHotEntitiesObs(
        [{ id: '1', name: 'Engram', type: 'PROJECT', mentionCount: 80 }],
        'hot-entities-bbb',
      );
      const patterns = service.detect([obs1, obs2]);
      const recurring = patterns.filter((p) => p.type === 'recurring_pattern');
      // Should have at most 1 (not 2)
      expect(recurring.length).toBeLessThanOrEqual(1);
    });
  });

  // ── Passthrough types ─────────────────────────────────────────────────

  describe('passthrough patterns', () => {
    it('should pass through stale memory observations', () => {
      const patterns = service.detect([makeStaleObs()]);
      expect(patterns).toHaveLength(1);
      expect(patterns[0].type).toBe('stale_thread');
      expect(patterns[0].actionable).toBe(true);
    });

    it('should pass through new-memories with count ≥ 3', () => {
      const patterns = service.detect([makeNewMemoriesObs(5, ['m1', 'm2'])]);
      expect(patterns).toHaveLength(1);
      expect(patterns[0].type).toBe('pattern_connection');
    });

    it('should NOT pass through new-memories with count < 3', () => {
      const patterns = service.detect([makeNewMemoriesObs(2)]);
      expect(patterns).toHaveLength(0);
    });

    it('should pass through cross-cutting observations', () => {
      const patterns = service.detect([makeCrossCuttingObs()]);
      expect(patterns).toHaveLength(1);
      expect(patterns[0].type).toBe('pattern_connection');
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle empty observations array', () => {
      const patterns = service.detect([]);
      expect(patterns).toHaveLength(0);
    });

    it('should handle hot-entities with no entities metadata', () => {
      const obs: Observation = {
        id: 'hot-entities-empty',
        source: 'memory',
        content: 'No entities',
        observedAt: new Date(),
        metadata: {},
      };
      const patterns = service.detect([obs]);
      // Should not crash, no recurring patterns generated
      const recurring = patterns.filter((p) => p.type === 'recurring_pattern');
      expect(recurring).toHaveLength(0);
    });

    it('should handle mixed observation types in one cycle', () => {
      const patterns = service.detect([
        makeStaleObs(),
        makeHotEntitiesObs([
          { id: '1', name: 'Engram', type: 'PROJECT', mentionCount: 80 },
          { id: '2', name: 'Prisma', type: 'TOOL', mentionCount: 15 },
          { id: '3', name: 'Railway', type: 'TOOL', mentionCount: 20 },
        ]),
        makeNewMemoriesObs(5, ['m1']),
        makeCrossCuttingObs(),
      ]);
      // Should have: stale_thread + entity patterns + pattern_connection (new) + pattern_connection (cross)
      expect(patterns.length).toBeGreaterThanOrEqual(3);
    });
  });
});
