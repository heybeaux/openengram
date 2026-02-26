-- Add IVFFlat index for openai-large (HEY-388)
--
-- openai-large produces 3072-dim vectors which exceed pgvector's 2000-dim HNSW
-- limit. IVFFlat supports higher dimensions, so we use it instead.
-- This replaces the sequential scan that was occurring on every query.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "memory_embeddings_openai_large_ivfflat_idx"
ON "memory_embeddings" USING ivfflat ((embedding::vector(3072)) vector_cosine_ops)
WITH (lists = 100)
WHERE model_id = 'openai-large' AND embedding IS NOT NULL;
