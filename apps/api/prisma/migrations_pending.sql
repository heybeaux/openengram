-- effectiveScore system additions
ALTER TABLE memories ADD COLUMN IF NOT EXISTS effective_score FLOAT DEFAULT 0.5;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS score_computed_at TIMESTAMP;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS safety_critical BOOLEAN DEFAULT FALSE;

-- Index for efficient retrieval by score
CREATE INDEX IF NOT EXISTS idx_memories_user_effective_score ON memories(user_id, effective_score DESC);
