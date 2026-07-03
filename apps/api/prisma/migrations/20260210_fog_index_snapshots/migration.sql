-- Fog Index Snapshots table for historical tracking
CREATE TABLE IF NOT EXISTS fog_index_snapshots (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    score       DOUBLE PRECISION NOT NULL,
    tier        TEXT NOT NULL,
    components  JSONB NOT NULL DEFAULT '[]'::jsonb,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fog_index_snapshots_computed_at
    ON fog_index_snapshots (computed_at DESC);
