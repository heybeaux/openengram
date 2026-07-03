import { StrategySelectorService } from './strategy-selector.service';
import { AnticipatoryConfig } from './anticipatory.config';
import { ContextSignals } from './strategies/strategy.interface';

describe('StrategySelectorService', () => {
  let selector: StrategySelectorService;

  beforeEach(() => {
    // Enable all strategies for tests
    (AnticipatoryConfig.strategies as any) = {
      entityRadiation: true,
      insightInjection: true,
      contradictionSurfacing: false,
      behavioralSequence: false,
    };
    selector = new StrategySelectorService();
  });

  function makeSignals(
    overrides: Partial<ContextSignals> = {},
  ): ContextSignals {
    return {
      query: 'test',
      userId: 'user1',
      entities: [],
      topics: [],
      hourOfDay: 12,
      dayOfWeek: 1,
      excludeMemoryIds: new Set(),
      ...overrides,
    };
  }

  it('should return empty when no signals match', () => {
    const result = selector.select(makeSignals());
    expect(result).toHaveLength(0);
  });

  it('should select entity_radiation when entities detected', () => {
    const result = selector.select(makeSignals({ entities: ['Engram'] }));
    expect(result).toContain('entity_radiation');
  });

  it('should select insight_injection when topics detected', () => {
    const result = selector.select(makeSignals({ topics: ['projects'] }));
    expect(result).toContain('insight_injection');
  });

  it('should select both strategies when both signals present', () => {
    const result = selector.select(
      makeSignals({ entities: ['Engram'], topics: ['projects'] }),
    );
    expect(result).toHaveLength(2);
    expect(result).toContain('entity_radiation');
    expect(result).toContain('insight_injection');
  });

  it('should return at most 2 strategies', () => {
    (AnticipatoryConfig.strategies as any).contradictionSurfacing = true;
    (AnticipatoryConfig.strategies as any).behavioralSequence = true;

    const result = selector.select(
      makeSignals({
        entities: ['Engram', 'Railway'],
        topics: ['projects', 'technical'],
      }),
    );
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('should respect override strategies', () => {
    const result = selector.select(makeSignals({ entities: ['Engram'] }), [
      'insight_injection',
    ]);
    expect(result).toEqual(['insight_injection']);
    expect(result).not.toContain('entity_radiation');
  });

  it('should filter disabled strategies from overrides', () => {
    (AnticipatoryConfig.strategies as any).contradictionSurfacing = false;
    const result = selector.select(makeSignals(), ['contradiction_surfacing']);
    expect(result).toHaveLength(0);
  });

  it('should use custom weights when provided', () => {
    const result = selector.select(
      makeSignals({ entities: ['Engram'], topics: ['projects'] }),
      undefined,
      { entity_radiation: 0.1, insight_injection: 2.0 },
    );
    // insight_injection should rank first with higher weight
    expect(result[0]).toBe('insight_injection');
  });
});
