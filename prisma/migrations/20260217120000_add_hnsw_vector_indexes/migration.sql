-- Add HNSW indexes for vector similarity search
-- This dramatically speeds up cosine distance queries from sequential scan to index scan
-- HNSW chosen over IVFFlat: better recall, no need to rebuild after inserts, slightly more memory

-- Drop the useless B-tree index on the vector column
DROP INDEX IF EXISTS "memories_embedding_idx";

-- HNSW index on memories.embedding (inline legacy column)
-- m=16, ef_construction=64 are good defaults for <1M vectors
CREATE INDEX IF NOT EXISTS "memories_embedding_hnsw_idx"
ON "memories" USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- HNSW index on memory_embeddings.embedding (ensemble multi-model table)
-- This is the primary search path for ensemble queries
CREATE INDEX IF NOT EXISTS "memory_embeddings_embedding_hnsw_idx"
ON "memory_embeddings" USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Composite index for the most common query pattern: filter by model_id, then vector search
-- pgvector can't use a composite (model_id, embedding) index for HNSW,
-- but a partial index per model is efficient for the 3-4 models we have
CREATE INDEX IF NOT EXISTS "memory_embeddings_bge_base_hnsw_idx"
ON "memory_embeddings" USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64)
WHERE model_id = 'bge-base' AND embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS "memory_embeddings_minilm_hnsw_idx"
ON "memory_embeddings" USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64)
WHERE model_id = 'minilm' AND embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS "memory_embeddings_nomic_hnsw_idx"
ON "memory_embeddings" USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64)
WHERE model_id = 'nomic' AND embedding IS NOT NULL;
