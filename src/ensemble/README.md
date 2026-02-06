# Ensemble Module

Multi-model embedding and RRF fusion for improved memory retrieval.

## Overview

This module implements MVP of the Multi-Model Ensemble Retrieval spec:
- **Dual embedding**: bge-base-en-v1.5 (768-dim) + all-MiniLM-L6-v2 (384-dim)
- **RRF fusion**: Reciprocal Rank Fusion combines results from multiple models
- **Feature-flagged**: Enable with `ENSEMBLE_ENABLED=true`

## Architecture

```
Query → EnsembleService
         ↓
   embedAll() → engram-embed (Rust)
         ↓
   [bge-base embedding, minilm embedding]
         ↓
   Parallel Pinecone queries (by namespace)
         ↓
   reciprocalRankFusion()
         ↓
   Ranked results
```

## Configuration

Environment variables:
- `ENSEMBLE_ENABLED=true` - Enable ensemble retrieval
- `LOCAL_EMBED_URL=http://127.0.0.1:8080` - engram-embed server URL
- `PINECONE_INDEX_768=engram-768` - Index for 768-dim vectors
- `PINECONE_INDEX_384=engram-384` - Index for 384-dim vectors

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

## Usage with engram-embed

Start the embed server with multiple models:
```bash
cd ~/projects/engram-embed
EMBED_MODELS=bge-base,minilm ./target/release/engram-embed
```

## Testing

```bash
npm test -- src/ensemble/
```

13 tests covering RRF fusion logic, edge cases, and configuration.

## Next Steps

1. **Production indexes**: Create Pinecone indexes for 768-dim and 384-dim vectors
2. **Integration**: Wire ensemble upsert into memory observe flow
3. **Benchmarking**: Compare ensemble vs single-model retrieval quality
4. **Weights tuning**: Optimize per-model weights based on query types
