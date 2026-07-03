import { MemoryWithScore } from '../../memory/memory.types';
import { AnticipatoryMemoryMeta } from '../dto/anticipatory.dto';

/**
 * Context signals extracted from the recall query and environment.
 */
export interface ContextSignals {
  /** Raw query text. */
  query: string;
  /** User ID for the recall. */
  userId: string;
  /** Entity names detected in the query. */
  entities: string[];
  /** Topic IDs detected from keywords. */
  topics: string[];
  /** Hour of day (0-23) in user's timezone. */
  hourOfDay: number;
  /** Day of week (0=Sun, 6=Sat). */
  dayOfWeek: number;
  /** IDs of memories already in the standard recall result set. */
  excludeMemoryIds: Set<string>;
}

/**
 * A single anticipatory result from a strategy.
 */
export interface AnticipatoryResult {
  memory: MemoryWithScore;
  meta: AnticipatoryMemoryMeta;
}

/**
 * Interface all anticipatory strategies must implement.
 */
export interface AnticipatoryStrategy {
  /** Unique strategy name (e.g., 'entity_radiation'). */
  readonly name: string;

  /**
   * Execute the strategy and return anticipatory memories.
   * Must respect the timeout — return partial or empty on expiry.
   */
  execute(
    signals: ContextSignals,
    options: { maxResults: number; timeoutMs: number },
  ): Promise<AnticipatoryResult[]>;
}
