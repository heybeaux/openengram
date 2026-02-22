import { Injectable, Logger, Optional } from '@nestjs/common';
import { AnticipatoryConfig } from './anticipatory.config';
import { ContextSignalService } from './context-signal.service';
import { StrategySelectorService } from './strategy-selector.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { FeedbackService } from './feedback/feedback.service';
import { EntityRadiationStrategy } from './strategies/entity-radiation.strategy';
import { InsightInjectionStrategy } from './strategies/insight-injection.strategy';
import {
  AnticipatoryStrategy,
  AnticipatoryResult,
  ContextSignals,
} from './strategies/strategy.interface';
import {
  AnticipatoryOptionsDto,
  AnticipatoryMeta,
  AnticipatoryMemoryMeta,
} from './dto/anticipatory.dto';
import { MemoryWithScore } from '../memory/memory.types';

/**
 * Extended memory type that includes anticipatory metadata.
 */
export interface AnticipatoryMemory extends MemoryWithScore {
  recallSource: 'anticipatory';
  anticipatory: AnticipatoryMemoryMeta;
}

/**
 * Full result of an anticipatory recall run.
 */
export interface AnticipatoryRunResult {
  memories: AnticipatoryMemory[];
  meta: AnticipatoryMeta;
}

/**
 * Anticipatory Recall Engine — Main Orchestrator
 *
 * Runs alongside standard recall to surface memories and insights
 * the agent didn't explicitly ask for. Coordinates:
 *
 * 1. Context signal extraction (from query text, no DB)
 * 2. Strategy selection (picks best 2 based on signals)
 * 3. Parallel strategy execution (with per-strategy timeouts)
 * 4. Result deduplication and ranking
 * 5. Event buffering for feedback loop
 *
 * Respects a hard latency budget and circuit breaker.
 * Never slows down standard recall — runs in parallel.
 */
@Injectable()
export class AnticipatoryService {
  private readonly logger = new Logger(AnticipatoryService.name);
  private readonly strategyMap = new Map<string, AnticipatoryStrategy>();

  constructor(
    private readonly signalService: ContextSignalService,
    private readonly selector: StrategySelectorService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly feedbackService: FeedbackService,
    @Optional() private readonly entityRadiation?: EntityRadiationStrategy,
    @Optional() private readonly insightInjection?: InsightInjectionStrategy,
  ) {
    // Register available strategies
    if (entityRadiation) this.strategyMap.set(entityRadiation.name, entityRadiation);
    if (insightInjection) this.strategyMap.set(insightInjection.name, insightInjection);
  }

  /**
   * Run anticipatory recall alongside a standard recall.
   *
   * @param query - The original recall query text
   * @param userId - User ID for the recall
   * @param excludeMemoryIds - IDs already in the standard result set
   * @param options - Anticipatory options from the recall request
   * @returns Anticipatory memories + metadata, or empty if disabled/tripped
   */
  async run(
    query: string,
    userId: string,
    excludeMemoryIds: Set<string>,
    options?: AnticipatoryOptionsDto,
  ): Promise<AnticipatoryRunResult> {
    const startTime = Date.now();

    // Check master toggle
    if (!AnticipatoryConfig.enabled) {
      return this.emptyResult(startTime);
    }

    // Check opt-in
    if (!options?.enabled) {
      return this.emptyResult(startTime);
    }

    // Check circuit breaker
    if (!this.circuitBreaker.isAllowed()) {
      return this.emptyResult(startTime, true);
    }

    const recallId = `rcl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const maxResults = options.maxResults ?? AnticipatoryConfig.maxResults;
    const minSalience = options.minSalience ?? AnticipatoryConfig.minSalience;
    const budgetMs = AnticipatoryConfig.latencyBudgetMs;

    try {
      // 1. Extract context signals (<10ms)
      const signals = await this.signalService.extract(query, userId, excludeMemoryIds);

      // 2. Get learned weights for strategy selection
      const weights = await this.feedbackService.getWeights(userId);

      // 3. Select strategies (<1ms)
      const strategyNames = this.selector.select(signals, options.strategies, weights);

      if (strategyNames.length === 0) {
        return this.emptyResult(startTime);
      }

      // 4. Execute selected strategies in parallel with timeout
      const perStrategyTimeout = Math.floor(budgetMs / strategyNames.length);
      const results = await this.executeStrategies(
        strategyNames,
        signals,
        maxResults,
        perStrategyTimeout,
      );

      // 5. Deduplicate, filter by salience, rank
      const filtered = results
        .filter((r) => r.meta.salience >= minSalience)
        .sort((a, b) => b.meta.salience - a.meta.salience)
        .slice(0, maxResults);

      // 6. Convert to response format
      const memories: AnticipatoryMemory[] = filtered.map((r) => ({
        ...r.memory,
        recallSource: 'anticipatory' as const,
        anticipatory: r.meta,
      }));

      const latencyMs = Date.now() - startTime;

      // 7. Record circuit breaker sample
      this.circuitBreaker.record(latencyMs);

      // 8. Buffer events for feedback (fire-and-forget)
      for (const mem of memories) {
        this.feedbackService.recordEvent({
          userId,
          recallId,
          strategy: mem.anticipatory.strategy,
          memoryId: mem.id,
          salience: mem.anticipatory.salience,
          wasUseful: null,
          latencyMs,
        });
      }

      const meta: AnticipatoryMeta = {
        strategiesRun: strategyNames,
        latencyMs,
        circuitBreakerActive: false,
        signals: {
          entitiesDetected: signals.entities,
          topics: signals.topics,
        },
      };

      this.logger.debug(
        `ARE completed: ${memories.length} results from [${strategyNames.join(', ')}] in ${latencyMs}ms`,
      );

      return { memories, meta };
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      this.circuitBreaker.record(latencyMs);
      this.logger.error(`ARE failed after ${latencyMs}ms: ${(err as Error).message}`);
      return this.emptyResult(startTime);
    }
  }

  /**
   * Execute strategies in parallel, each with its own timeout.
   */
  private async executeStrategies(
    names: string[],
    signals: ContextSignals,
    maxResults: number,
    perStrategyTimeoutMs: number,
  ): Promise<AnticipatoryResult[]> {
    const promises = names.map(async (name) => {
      const strategy = this.strategyMap.get(name);
      if (!strategy) return [];

      try {
        return await Promise.race([
          strategy.execute(signals, {
            maxResults,
            timeoutMs: perStrategyTimeoutMs,
          }),
          new Promise<AnticipatoryResult[]>((resolve) =>
            setTimeout(() => {
              this.logger.warn(`Strategy ${name} timed out at ${perStrategyTimeoutMs}ms`);
              resolve([]);
            }, perStrategyTimeoutMs),
          ),
        ]);
      } catch (err) {
        this.logger.warn(`Strategy ${name} failed: ${(err as Error).message}`);
        return [];
      }
    });

    const results = await Promise.all(promises);
    return results.flat();
  }

  private emptyResult(startTime: number, circuitBreakerActive = false): AnticipatoryRunResult {
    return {
      memories: [],
      meta: {
        strategiesRun: [],
        latencyMs: Date.now() - startTime,
        circuitBreakerActive,
        signals: { entitiesDetected: [], topics: [] },
      },
    };
  }
}
