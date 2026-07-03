-- Dream Cycle schema additions
ALTER TABLE memories ADD COLUMN IF NOT EXISTS archived_reason TEXT;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS last_dream_cycle_at TIMESTAMPTZ;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS pattern_source_ids TEXT[] DEFAULT '{}';

CREATE TABLE IF NOT EXISTS dream_cycle_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms INT,
  dry_run BOOLEAN NOT NULL DEFAULT false,
  scores_refreshed INT NOT NULL DEFAULT 0,
  duplicates_merged INT NOT NULL DEFAULT 0,
  patterns_created INT NOT NULL DEFAULT 0,
  memories_archived INT NOT NULL DEFAULT 0,
  total_active INT NOT NULL DEFAULT 0,
  avg_effective_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  stage_details JSONB NOT NULL DEFAULT '{}',
  errors TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'RUNNING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dream_cycle_reports_user_created ON dream_cycle_reports(user_id, created_at);
