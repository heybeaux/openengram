-- Fix HNSW index dimensions (HEY-129)
--
-- bge-base produces 768-dim vectors, but the previous migration incorrectly
-- created the index with vector(1536). This would cause the index to be unused
-- since the actual embeddings don't match the cast dimension.
--
-- openai-large produces 3072-dim vectors. pgvector 0.7+ supports HNSW up to
-- 4000 dimensions, so we can now create a proper index for it.

-- Fix bge-base: drop wrong-dimension index and recreate with correct 768 dims
DROP INDEX IF EXISTS "memory_embeddings_bge_base_hnsw_idx";

CREATE INDEX IF NOT EXISTS "memory_embeddings_bge_base_hnsw_idx"
ON "memory_embeddings" USING hnsw ((embedding::vector(768)) vector_cosine_ops)
WITH (m = 16, ef_construction = 64)
WHERE model_id = 'bge-base' AND embedding IS NOT NULL;

-- Add openai-large index (3072 dims, supported by pgvector 0.7+)
CREATE INDEX IF NOT EXISTS "memory_embeddings_openai_large_hnsw_idx"
ON "memory_embeddings" USING hnsw ((embedding::vector(3072)) vector_cosine_ops)
WITH (m = 16, ef_construction = 64)
WHERE model_id = 'openai-large' AND embedding IS NOT NULL;

-- Refresh query planner statistics
ANALYZE "memory_embeddings";
