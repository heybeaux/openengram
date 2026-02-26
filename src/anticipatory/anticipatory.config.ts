/**
 * Anticipatory Recall Engine — Configuration
 *
 * All values driven by environment variables for operator control.
 * Defaults are conservative and safe for production.
 */
export const AnticipatoryConfig = {
  /** Master feature flag. */
  enabled: process.env.ANTICIPATORY_ENABLED === 'true',

  // ── Strategy toggles ─────────────────────────────────────────────────
  strategies: {
    entityRadiation: process.env.ANTICIPATORY_ENTITY_RADIATION !== 'false',
    insightInjection: process.env.ANTICIPATORY_INSIGHT_INJECTION !== 'false',
    contradictionSurfacing:
      process.env.ANTICIPATORY_CONTRADICTION_SURFACING === 'true',
    behavioralSequence: process.env.ANTICIPATORY_BEHAVIORAL_SEQUENCE === 'true',
  },

  // ── Performance budgets ───────────────────────────────────────────────
  latencyBudgetMs: int('ANTICIPATORY_LATENCY_BUDGET_MS', 100),
  circuitBreaker: {
    p95ThresholdMs: int('ANTICIPATORY_CIRCUIT_BREAKER_P95_MS', 200),
    cooldownMs: int('ANTICIPATORY_CIRCUIT_BREAKER_COOLDOWN_MS', 120_000),
    windowMs: int('ANTICIPATORY_CIRCUIT_BREAKER_WINDOW_MS', 300_000), // 5 min
    minSamples: int('ANTICIPATORY_CIRCUIT_BREAKER_MIN_SAMPLES', 10),
  },

  // ── Result limits ─────────────────────────────────────────────────────
  maxResults: int('ANTICIPATORY_MAX_RESULTS', 3),
  maxEntityHops: int('ANTICIPATORY_MAX_ENTITY_HOPS', 1),
  minSalience: float('ANTICIPATORY_MIN_SALIENCE', 0.3),

  // ── Feedback / learning ───────────────────────────────────────────────
  eventFlushIntervalMs: int('ANTICIPATORY_EVENT_FLUSH_INTERVAL_MS', 30_000),
  minSamplesForLearning: int('ANTICIPATORY_MIN_SAMPLES_FOR_LEARNING', 20),

  // ── Cold-start strategy weights ───────────────────────────────────────
  defaultWeights: {
    entity_radiation: float('ANTICIPATORY_WEIGHT_ENTITY_RADIATION', 1.0),
    insight_injection: float('ANTICIPATORY_WEIGHT_INSIGHT_INJECTION', 0.8),
    contradiction_surfacing: float('ANTICIPATORY_WEIGHT_CONTRADICTION', 0.5),
    behavioral_sequence: float('ANTICIPATORY_WEIGHT_BEHAVIORAL', 0.3),
  } as Record<string, number>,
};

function int(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? parseInt(v, 10) : fallback;
}

function float(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? parseFloat(v) : fallback;
}
