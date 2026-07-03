# Search Latency Investigation — HEY-22

**Date:** 2026-02-15
**Reported latency:** 2.2–2.4s per search query

## Architecture

Search path: `recall()` → `EmbeddingService.generate()` → `LLMService.embed()` → `EmbeddingService.embedOne()` → `CloudEnsembleEmbedProvider.embed()` → `CloudEnsembleService.embedAll()` → pgvector search

## Root Cause

**`CloudEnsembleEmbedProvider.embed()` was calling `embedAll()`**, which generates embeddings from ALL 3 cloud models in parallel (openai-small, openai-large, cohere-v3), then discards everything except `openai-small`.

Typical per-model latencies:
- `openai-small`: ~200-400ms
- `openai-large`: ~300-600ms  
- `cohere-v3`: ~400-800ms

Even though they run in parallel, the total is gated by the slowest model (~800ms). Combined with pgvector search (~200-400ms) and Prisma hydration (~100-200ms), total latency reaches 2.2-2.4s.

## Fix Applied

Added `CloudEnsembleService.embedSingle()` method that hits only one model. Updated `CloudEnsembleEmbedProvider.embed()` to use `embedSingle('openai-small')` instead of `embedAll()`.

**Expected improvement:** ~400-800ms reduction in embedding time (eliminating unnecessary openai-large + cohere calls). Search should drop to ~1.0-1.6s.

## Remaining Optimization Opportunities

| Optimization | Estimated Impact | Effort |
|---|---|---|
| **Embedding cache** (LRU for frequent queries) | -200-400ms for cache hits | Medium |
| **pgvector HNSW index** (vs current ivfflat) | -50-100ms, better recall | Medium (requires migration) |
| **Connection pooling** for OpenAI API | -50-100ms (connection reuse) | Low |
| **Query embedding precomputation** for common patterns | Variable | Medium |
| **Reduce Prisma hydration** (select only needed fields) | -50ms | Low |

## Notes

- The `embedAll()` path is still used for memory **storage** (via the ensemble/nightly-reembed pipeline), which is correct — we want multi-model embeddings for stored memories.
- The fix only affects the **query** path where we need a single embedding for similarity search.
