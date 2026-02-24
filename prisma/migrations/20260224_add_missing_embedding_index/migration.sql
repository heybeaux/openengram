-- HEY-359: Partial index for memories missing embeddings
-- Speeds up queries like `WHERE embedding_id IS NULL` used by backfill/reembed jobs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memories_missing_embedding
  ON memories (created_at DESC)
  WHERE embedding_id IS NULL AND deleted_at IS NULL;
