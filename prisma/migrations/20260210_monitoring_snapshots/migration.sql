-- Monitoring snapshots for system health tracking
CREATE TABLE IF NOT EXISTS monitoring_snapshots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  metrics JSONB NOT NULL DEFAULT '{}',
  alerts JSONB NOT NULL DEFAULT '[]',
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_monitoring_snapshots_snapshot_at ON monitoring_snapshots(snapshot_at);
