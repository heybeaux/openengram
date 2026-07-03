-- Add HNSW indexes for vector similarity search
-- This dramatically speeds up cosine distance queries from sequential scan to index scan
-- HNSW chosen over IVFFlat: better recall, no need to rebuild after inserts, slightly more memory

-- Drop the useless B-tree index on the vector column
DROP INDEX IF EXISTS "memories_embedding_idx";

-- HNSW index on memories.embedding (inline legacy column)
-- All legacy embeddings are 1536-dimensional; cast required since column is untyped vector
-- m=16, ef_construction=64 are good defaults for <1M vectors
CREATE INDEX IF NOT EXISTS "memories_embedding_hnsw_idx"
ON "memories" USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
WITH (m = 16, ef_construction = 64)
WHERE embedding IS NOT NULL;

-- Partial HNSW indexes per model on memory_embeddings
-- Column is untyped vector (mixed dimensions), so we need per-model indexes with casts
-- pgvector HNSW requires fixed-dimension vectors

CREATE INDEX IF NOT EXISTS "memory_embeddings_bge_base_hnsw_idx"
ON "memory_embeddings" USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
WITH (m = 16, ef_construction = 64)
WHERE model_id = 'bge-base' AND embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS "memory_embeddings_openai_small_hnsw_idx"
ON "memory_embeddings" USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
WITH (m = 16, ef_construction = 64)
WHERE model_id = 'openai-small' AND embedding IS NOT NULL;

-- openai-large is 3072 dims, exceeding pgvector's 2000-dim limit for HNSW/IVFFlat
-- Skip indexing for now; sequential scan is fine for the small row count
-- TODO: Consider halfvec or dimensionality reduction if this model grows

CREATE INDEX IF NOT EXISTS "memory_embeddings_cohere_v3_hnsw_idx"
ON "memory_embeddings" USING hnsw ((embedding::vector(1024)) vector_cosine_ops)
WITH (m = 16, ef_construction = 64)
WHERE model_id = 'cohere-v3' AND embedding IS NOT NULL;
