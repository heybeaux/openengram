/**
 * Typed event classes for the Engram internal event bus.
 *
 * Convention: each event carries a `type` string matching the event-emitter topic
 * and a `timestamp` for when it was created.
 */

// ─── Base ────────────────────────────────────────────────────────────────────

export abstract class EngramEvent {
  readonly timestamp: Date = new Date();
  abstract readonly type: string;

  toJSON(): Record<string, any> {
    return { ...this, timestamp: this.timestamp.toISOString() };
  }
}

// ─── Memory Events ───────────────────────────────────────────────────────────

export class MemoryCreatedEvent extends EngramEvent {
  readonly type = 'memory.created';
  constructor(
    public readonly memoryId: string,
    public readonly layer: string,
    public readonly importance: number,
    public readonly tags: string[],
    public readonly userId: string,
    public readonly preview: string,
  ) {
    super();
  }
}

export class MemoryUpdatedEvent extends EngramEvent {
  readonly type = 'memory.updated';
  constructor(
    public readonly memoryId: string,
    public readonly changes: Record<string, any>,
    public readonly userId: string,
  ) {
    super();
  }
}

export class MemoryDeletedEvent extends EngramEvent {
  readonly type = 'memory.deleted';
  constructor(
    public readonly memoryId: string,
    public readonly userId: string,
  ) {
    super();
  }
}

export class MemoryMergedEvent extends EngramEvent {
  readonly type = 'memory.merged';
  constructor(
    public readonly sourceIds: string[],
    public readonly targetId: string,
    public readonly userId: string,
  ) {
    super();
  }
}

export class MemoryPromotedEvent extends EngramEvent {
  readonly type = 'memory.promoted';
  constructor(
    public readonly memoryId: string,
    public readonly fromLayer: string,
    public readonly toLayer: string,
    public readonly userId: string,
  ) {
    super();
  }
}

// ─── Consolidation Events ────────────────────────────────────────────────────

export class DreamStartedEvent extends EngramEvent {
  readonly type = 'dream.started';
  constructor(public readonly dreamTimestamp: Date = new Date()) {
    super();
  }
}

export class DreamCompletedEvent extends EngramEvent {
  readonly type = 'dream.completed';
  constructor(
    public readonly merged: number,
    public readonly archived: number,
    public readonly patternsCreated: number,
    public readonly duration: number,
  ) {
    super();
  }
}

export class DreamPatternFoundEvent extends EngramEvent {
  readonly type = 'dream.pattern_found';
  constructor(
    public readonly patternId: string,
    public readonly description: string,
  ) {
    super();
  }
}

export class ContextRegeneratedEvent extends EngramEvent {
  readonly type = 'context.regenerated';
  constructor(
    public readonly path: string | null,
    public readonly tokenCount: number,
  ) {
    super();
  }
}

// ─── Search Events ───────────────────────────────────────────────────────────

export class SearchMissEvent extends EngramEvent {
  readonly type = 'search.miss';
  constructor(
    public readonly query: string,
    public readonly userId: string,
  ) {
    super();
  }
}

// ─── System Events ───────────────────────────────────────────────────────────

export class HealthDegradedEvent extends EngramEvent {
  readonly type = 'health.degraded';
  constructor(
    public readonly service: string,
    public readonly error: string,
  ) {
    super();
  }
}

export class HealthRecoveredEvent extends EngramEvent {
  readonly type = 'health.recovered';
  constructor(public readonly service: string) {
    super();
  }
}

export class DedupClusterFoundEvent extends EngramEvent {
  readonly type = 'dedup.cluster_found';
  constructor(
    public readonly clusterId: string,
    public readonly memoryIds: string[],
    public readonly similarity: number,
  ) {
    super();
  }
}
