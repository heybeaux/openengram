-- Add index for openai-large (HEY-388)
--
-- openai-large produces 3072-dim vectors. pgvector HNSW supports up to 2000
-- dimensions in versions < 0.8.0. Use a plain btree index on model_id for
-- filtering, and rely on sequential scan for cosine similarity on large vectors.
-- When pgvector >= 0.8.0 is available, an HNSW index can be added.

-- No vector index created — 3072 dims exceeds pgvector HNSW/IVFFlat limits.
-- Queries on openai-large embeddings will use sequential scan with the
-- existing model_id filter index.
