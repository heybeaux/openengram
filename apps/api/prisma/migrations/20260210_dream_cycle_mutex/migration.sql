-- Dream Cycle mutex: run tracking table
CREATE TABLE IF NOT EXISTS dream_cycle_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  status TEXT NOT NULL DEFAULT 'RUNNING',
  instance_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dream_cycle_runs_status ON dream_cycle_runs(status);
