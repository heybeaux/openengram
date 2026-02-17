/**
 * Awareness / Waking Cycle configuration.
 *
 * All values are controlled via environment variables so operators can tune
 * behaviour without code changes. Defaults are conservative.
 */
export const AwarenessConfig = {
  /** Master feature flag — when false the module is a no-op. */
  enabled: process.env.AWARENESS_ENABLED === 'true',

  /**
   * Cron expression for the Waking Cycle scheduler.
   * Default: every 4 hours during waking hours (08:00–23:00).
   */
  schedule: process.env.AWARENESS_SCHEDULE || '0 */4 8-23 * * *',

  // ── Resource budgets (per cycle) ──────────────────────────────────────
  maxDbQueries: int('AWARENESS_MAX_DB_QUERIES', 50),
  maxEmbeddingCalls: int('AWARENESS_MAX_EMBEDDING_CALLS', 10),
  maxLlmCalls: int('AWARENESS_MAX_LLM_CALLS', 3),
  cycleTimeoutMs: int('AWARENESS_CYCLE_TIMEOUT_MS', 60_000),
  maxInsightsPerCycle: int('AWARENESS_MAX_INSIGHTS_PER_CYCLE', 5),

  // ── Quality gates ─────────────────────────────────────────────────────
  minConfidence: float('AWARENESS_MIN_CONFIDENCE', 0.5),
  insightTtlDays: int('AWARENESS_INSIGHT_TTL_DAYS', 14),

  // ── Signal sources ────────────────────────────────────────────────────
  signals: (process.env.AWARENESS_SIGNALS || 'memory').split(',').map(s => s.trim()),

  // ── LLM model for insight generation (budget-friendly default) ───────
  llmModel: process.env.AWARENESS_LLM_MODEL || 'gpt-4o-mini',
};

// ── Helpers ───────────────────────────────────────────────────────────────
function int(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? parseInt(v, 10) : fallback;
}

function float(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? parseFloat(v) : fallback;
}
