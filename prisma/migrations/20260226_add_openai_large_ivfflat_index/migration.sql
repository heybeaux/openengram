-- Add HNSW index for openai-large (HEY-388)
--
-- openai-large produces 3072-dim vectors. pgvector 0.7.0+ supports HNSW
-- up to 4096 dimensions. IVFFlat is limited to 2000 dimensions.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "memory_embeddings_openai_large_hnsw_idx"
ON "memory_embeddings" USING hnsw ((embedding::vector(3072)) vector_cosine_ops)
WITH (m = 16, ef_construction = 64)
WHERE model_id = 'openai-large' AND embedding IS NOT NULL;
