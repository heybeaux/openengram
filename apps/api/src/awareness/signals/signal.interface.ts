/**
 * Base interface for all Waking Cycle signal sources.
 *
 * Each signal source collects raw observations from a specific domain
 * (memories, GitHub, Linear, etc.) and returns them in a uniform shape
 * for the pattern detector.
 */
export interface Observation {
  /** Unique identifier for deduplication. */
  id: string;
  /** Which signal source produced this observation. */
  source: string;
  /** Human-readable summary of what was observed. */
  content: string;
  /** When the underlying event occurred. */
  observedAt: Date;
  /** Optional references to related memory IDs. */
  relatedMemoryIds?: string[];
  /** Arbitrary source-specific metadata. */
  metadata?: Record<string, unknown>;
}

export interface SignalSource {
  /** Unique name for this signal (e.g. "memory", "github"). */
  readonly name: string;

  /**
   * Collect new observations since the last checkpoint.
   *
   * @param checkpoint - Opaque state from the previous run (or null on first run).
   * @param budget     - Maximum number of DB/API calls this source may make.
   * @returns Observations and an updated checkpoint to persist.
   */
  collect(
    checkpoint: Record<string, unknown> | null,
    budget: { maxQueries: number },
  ): Promise<{
    observations: Observation[];
    checkpoint: Record<string, unknown>;
  }>;
}
