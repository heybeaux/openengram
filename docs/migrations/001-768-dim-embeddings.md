# Migration: 768-dim Local Embeddings

**Date:** February 5, 2026  
**From:** OpenAI text-embedding-3-small (1536-dim)  
**To:** Local bge-base-en-v1.5 (768-dim)  

## Overview

Migrated Engram from OpenAI's cloud embeddings to fully local embeddings using the `engram-embed` Rust server with bge-base-en-v1.5 model.

## Why?

| OpenAI | Local (engram-embed) |
|--------|---------------------|
| $0.0001/1K tokens | **Free** |
| ~100ms latency | **~10ms latency** |
| Rate limits | **Unlimited** |
| Data sent to cloud | **Fully local** |
| 1536 dimensions | 768 dimensions |

## Migration Stats

- **Total memories:** 504
- **Successfully migrated:** 504
- **Errors:** 0
- **Time:** 61.5s (~8.2 memories/second)

## How to Run

### Prerequisites

1. Start the engram-embed server:
   ```bash
   cd ~/projects/engram-embed
   cargo run --release
   ```

2. Verify it's running:
   ```bash
   curl http://127.0.0.1:8080/v1/embeddings \
     -H "Content-Type: application/json" \
     -d '{"input": "test"}'
   ```

### Run Migration

```bash
cd ~/projects/agent-memory/engram
npx ts-node --transpile-only scripts/migrate-embeddings-768.ts
```

### Update Configuration

In `.env`:
```
EMBEDDING_PROVIDER="local"
LOCAL_EMBED_URL="http://127.0.0.1:8080"
```

## Technical Details

### New Provider

Added `LocalProvider` in `src/llm/providers/local.provider.ts`:
- OpenAI-compatible API
- Supports single and batch embedding
- 768 dimensions (bge-base-en-v1.5)

### Database

Embeddings stored in pgvector (PostgreSQL):
- Column: `memories.embedding` (vector type)
- Model tracking: `memories.embedding_model` = 'bge-base-en-v1.5'

### Vector Storage

Using pgvector, not Pinecone. The Pinecone provider exists but requires API key configuration. For most use cases, pgvector is sufficient and simpler.

## Verification

Run the test script:
```bash
npx ts-node --transpile-only scripts/test-search-768.ts
```

Expected output shows relevant semantic matches with 70-80% similarity scores.

## Rollback

To rollback to OpenAI embeddings:

1. Update `.env`:
   ```
   EMBEDDING_PROVIDER="openai"
   ```

2. Re-run migration with OpenAI:
   ```bash
   # Modify migration script to use OpenAI, or
   # Create a reverse migration script
   ```

## Files Changed

- `src/llm/providers/local.provider.ts` (new)
- `src/llm/llm.interface.ts` (added 'local' provider type)
- `src/llm/llm.service.ts` (register local provider)
- `.env` (EMBEDDING_PROVIDER=local)
- `.env.example` (documented local option)
- `scripts/migrate-embeddings-768.ts` (new)
- `scripts/test-search-768.ts` (new)
