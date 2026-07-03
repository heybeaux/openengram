-- Migration: Add indexes for analytics queries
-- This migration adds indexes to optimize time-series analytics queries
-- on the memories table without modifying any data.

-- Layer + time queries (for timeline by layer)
CREATE INDEX IF NOT EXISTS idx_memories_user_layer_created 
ON memories (user_id, layer, created_at DESC);

-- Session-based tracking (for source analytics)
CREATE INDEX IF NOT EXISTS idx_memories_session_created 
ON memories (session_id, created_at DESC);

-- Importance distribution queries
CREATE INDEX IF NOT EXISTS idx_memories_user_importance 
ON memories (user_id, importance_score DESC);

-- Compound index for analytics aggregations
-- Covers most analytics queries in a single index
CREATE INDEX IF NOT EXISTS idx_memories_analytics 
ON memories (user_id, deleted_at, created_at, layer, memory_type, importance_score);
