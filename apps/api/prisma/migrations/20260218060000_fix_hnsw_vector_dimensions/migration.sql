-- Fix HNSW index dimensions (HEY-129)
--
-- bge-base produces 768-dim vectors, but the previous migration incorrectly
-- created the index with vector(1536). This would cause the index to be unused
-- since the actual embeddings don't match the cast dimension.
--
-- openai-large produces 3072-dim vectors, which exceeds pgvector's 2000-dim
-- HNSW limit. Skip indexing for now (sequential scan is fine for small row counts).

-- Fix bge-base: drop wrong-dimension index and recreate with correct 768 dims
DROP INDEX IF EXISTS "memory_embeddings_bge_base_hnsw_idx";

CREATE INDEX IF NOT EXISTS "memory_embeddings_bge_base_hnsw_idx"
ON "memory_embeddings" USING hnsw ((embedding::vector(768)) vector_cosine_ops)
WITH (m = 16, ef_construction = 64)
WHERE model_id = 'bge-base' AND embedding IS NOT NULL;

-- openai-large is 3072 dims, exceeding pgvector's 2000-dim limit for HNSW
-- Skip indexing; sequential scan is acceptable for the current row count
-- TODO: Consider halfvec or dimensionality reduction if this model grows

-- Refresh query planner statistics
ANALYZE "memory_embeddings";
