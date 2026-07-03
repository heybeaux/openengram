# Ensemble Module

Multi-model embedding and RRF fusion for improved memory retrieval.

## Overview

This module implements the Multi-Model Ensemble Retrieval spec:
- **Multi-model embedding**: bge-base-en-v1.5 (768-dim), nomic (768-dim), all-MiniLM-L6-v2 (384-dim)
- **RRF fusion**: Reciprocal Rank Fusion combines results from multiple models
- **pgvector storage**: Uses PostgreSQL pgvector extension (replaced Pinecone)
- **Feature-flagged**: Enable with `ENSEMBLE_ENABLED=true`

## Architecture

```
Query → EnsembleService
         ↓
   embedAll() → engram-embed (Rust)
         ↓
   [bge-base, nomic, minilm embeddings]
         ↓
   PgVectorEnsembleProvider
         ↓
   Parallel queries per model (memory_embeddings table)
         ↓
   reciprocalRankFusion()
         ↓
   Ranked results with consensus boost
```

## Database Schema

The `memory_embeddings` table stores multi-model embeddings:

```sql
CREATE TABLE memory_embeddings (
    id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL,  -- 'bge-base', 'nomic', 'minilm', 'gte-base'
    dimensions INTEGER DEFAULT 768,
    embedding vector,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE(memory_id, model_id)
);

-- Partial indexes for efficient dimension-specific queries
CREATE INDEX memory_embeddings_embedding_768_idx ON memory_embeddings 
    USING ivfflat (embedding vector_cosine_ops) WHERE dimensions = 768;
CREATE INDEX memory_embeddings_embedding_384_idx ON memory_embeddings 
    USING ivfflat (embedding vector_cosine_ops) WHERE dimensions = 384;
```

## Configuration

Environment variables:
- `ENSEMBLE_ENABLED=true` - Enable ensemble retrieval
- `ENSEMBLE_REEMBED_ENABLED=true` - Enable nightly batch re-embedding
- `LOCAL_EMBED_URL=http://127.0.0.1:8080` - engram-embed server URL
- `ENSEMBLE_CONSENSUS_BOOST=true` - Boost results appearing in multiple models
- `ENSEMBLE_CONSENSUS_FACTOR=0.1` - Consensus boost strength

Note: Pinecone configuration is no longer required. pgvector is the default storage.

## API Endpoints

### GET /ensemble/status
Returns ensemble configuration and status.

### POST /ensemble/query
```json
{
  "query": "What did Beaux say about deployment?",
  "userId": "user-123",
  "limit": 10,
  "k": 60,
  "weights": { "bge-base": 1.0, "minilm": 1.2 }
}
```

### POST /ensemble/upsert
```json
{
  "memoryId": "mem-123",
  "content": "Memory content to embed",
  "userId": "user-123"
}
```

### POST /ensemble/compare
Debugging endpoint to compare ensemble vs single-model results.

### POST /ensemble/embed
Utility endpoint to generate embeddings without storage.

### GET /ensemble/stats
Returns embedding counts per model.

## RRF Algorithm

Reciprocal Rank Fusion combines rankings from multiple models:

```
RRF_score(d) = Σ weight_m * (1 / (k + rank_m(d)))
```

Where:
- `d` = document (memory)
- `k` = constant (default 60) - controls how much weight top ranks get
- `rank_m(d)` = rank of document in model m's results (1-indexed)
- `weight_m` = per-model weight (default 1.0)

Documents appearing in multiple models' results get boosted by consensus.

## Handling Different Dimensions

The ensemble supports models with different embedding dimensions:
- **bge-base**: 768 dimensions
- **nomic**: 768 dimensions
- **gte-base**: 768 dimensions
- **minilm**: 384 dimensions

The `memory_embeddings` table stores the dimension in each row. Partial indexes
ensure efficient queries even with mixed dimensions:
- 768-dim embeddings use `memory_embeddings_embedding_768_idx`
- 384-dim embeddings use `memory_embeddings_embedding_384_idx`

## Services

### EnsembleService
Main service for multi-model embedding and retrieval:
- `embedAll(text)` - Generate embeddings from all models
- `upsert(options)` - Store embeddings in pgvector
- `query(options)` - Query and fuse results with RRF
- `delete(memoryId)` - Remove all embeddings for a memory

### PgVectorEnsembleProvider
Low-level pgvector operations:
- `upsertEmbedding(record)` - Insert/update single embedding
- `upsertEmbeddings(records)` - Batch upsert
- `queryByModel(options)` - Search within one model
- `queryWithModelEmbeddings(embeddings, userId, limit)` - Multi-model search
- `getEmbeddingCountByModel()` - Statistics

### NightlyReembedService
Batch re-embedding for new models or drift detection:
- Scheduled runs at 2 AM Pacific
- Incremental and full re-embed modes
- Checkpointing for resumability
- Drift detection

### DriftDetectionService
Measures embedding drift when re-embedding:
- Compares old vs new embeddings using cosine distance
- Flags high-drift memories for review
- Fetches existing embeddings from pgvector

## Migration from Pinecone

This module previously used Pinecone for vector storage. It now uses pgvector:

1. No external service required
2. No API key needed
3. All embeddings stored in PostgreSQL
4. Apply migration: `prisma migrate deploy`

To migrate existing Pinecone data (if needed):
1. Export vectors from Pinecone namespaces
2. Insert into `memory_embeddings` table with model_id

## Usage with engram-embed

Start the embed server with multiple models:
```bash
cd ~/projects/engram-embed
EMBED_MODELS=bge-base,minilm,nomic ./target/release/engram-embed
```

## Testing

```bash
npm test -- src/ensemble/
```

74 tests covering:
- RRF fusion algorithm
- Consensus boost
- Weighted models
- pgvector provider operations
- Drift detection
- Edge cases

## Running the Migration

Apply the multi-model embeddings migration:

```bash
# Preview the migration SQL (safe, no changes)
cat prisma/migrations/20260206070000_add_multi_model_embeddings/migration.sql

# Apply the migration (production-safe)
npx prisma migrate deploy
```

**Important**: Use `prisma migrate deploy` (not `prisma migrate dev`) to preserve existing data.
