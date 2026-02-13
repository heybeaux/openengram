import {
  MemoryCreatedEvent,
  MemoryUpdatedEvent,
  MemoryDeletedEvent,
  MemoryMergedEvent,
  MemoryPromotedEvent,
  DreamStartedEvent,
  DreamCompletedEvent,
  DreamPatternFoundEvent,
  ContextRegeneratedEvent,
  SearchMissEvent,
  HealthDegradedEvent,
  HealthRecoveredEvent,
  DedupClusterFoundEvent,
} from './event-types';

describe('Event Types', () => {
  it('MemoryCreatedEvent has correct type and fields', () => {
    const evt = new MemoryCreatedEvent('m1', 'SESSION', 0.8, ['tag'], 'u1', 'preview');
    expect(evt.type).toBe('memory.created');
    expect(evt.memoryId).toBe('m1');
    expect(evt.layer).toBe('SESSION');
    expect(evt.importance).toBe(0.8);
    expect(evt.tags).toEqual(['tag']);
    expect(evt.userId).toBe('u1');
    expect(evt.preview).toBe('preview');
    expect(evt.timestamp).toBeInstanceOf(Date);
  });

  it('MemoryUpdatedEvent has correct type', () => {
    const evt = new MemoryUpdatedEvent('m1', { raw: 'new' }, 'u1');
    expect(evt.type).toBe('memory.updated');
    expect(evt.changes).toEqual({ raw: 'new' });
  });

  it('MemoryDeletedEvent has correct type', () => {
    const evt = new MemoryDeletedEvent('m1', 'u1');
    expect(evt.type).toBe('memory.deleted');
  });

  it('MemoryMergedEvent has correct type', () => {
    const evt = new MemoryMergedEvent(['m1', 'm2'], 'm3', 'u1');
    expect(evt.type).toBe('memory.merged');
    expect(evt.sourceIds).toEqual(['m1', 'm2']);
  });

  it('MemoryPromotedEvent has correct type', () => {
    const evt = new MemoryPromotedEvent('m1', 'SESSION', 'IDENTITY', 'u1');
    expect(evt.type).toBe('memory.promoted');
  });

  it('DreamStartedEvent has correct type', () => {
    const evt = new DreamStartedEvent();
    expect(evt.type).toBe('dream.started');
    expect(evt.dreamTimestamp).toBeInstanceOf(Date);
  });

  it('DreamCompletedEvent has correct type', () => {
    const evt = new DreamCompletedEvent(5, 3, 2, 1000);
    expect(evt.type).toBe('dream.completed');
    expect(evt.merged).toBe(5);
    expect(evt.archived).toBe(3);
    expect(evt.patternsCreated).toBe(2);
    expect(evt.duration).toBe(1000);
  });

  it('DreamPatternFoundEvent has correct type', () => {
    const evt = new DreamPatternFoundEvent('p1', 'Pattern desc');
    expect(evt.type).toBe('dream.pattern_found');
  });

  it('ContextRegeneratedEvent has correct type', () => {
    const evt = new ContextRegeneratedEvent('/path', 4000);
    expect(evt.type).toBe('context.regenerated');
    expect(evt.path).toBe('/path');
    expect(evt.tokenCount).toBe(4000);
  });

  it('SearchMissEvent has correct type', () => {
    const evt = new SearchMissEvent('query', 'u1');
    expect(evt.type).toBe('search.miss');
  });

  it('HealthDegradedEvent has correct type', () => {
    const evt = new HealthDegradedEvent('embedding', 'down');
    expect(evt.type).toBe('health.degraded');
    expect(evt.service).toBe('embedding');
  });

  it('HealthRecoveredEvent has correct type', () => {
    const evt = new HealthRecoveredEvent('embedding');
    expect(evt.type).toBe('health.recovered');
  });

  it('DedupClusterFoundEvent has correct type', () => {
    const evt = new DedupClusterFoundEvent('c1', ['m1', 'm2'], 0.95);
    expect(evt.type).toBe('dedup.cluster_found');
    expect(evt.memoryIds).toEqual(['m1', 'm2']);
  });

  it('toJSON serializes correctly', () => {
    const evt = new MemoryCreatedEvent('m1', 'SESSION', 0.8, [], 'u1', 'hi');
    const json = evt.toJSON();
    expect(json.type).toBe('memory.created');
    expect(typeof json.timestamp).toBe('string'); // ISO string
    expect(json.memoryId).toBe('m1');
  });
});
