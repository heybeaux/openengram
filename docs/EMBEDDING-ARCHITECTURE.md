# Embedding Architecture

## Overview

Engram uses **multi-model ensemble embedding** for semantic search. The embedding backend differs between self-hosted and cloud (SaaS) deployments.

## Self-Hosted: Local Ensemble (engram-embed)

- **Service:** [engram-embed](https://github.com/heybeaux/engram-embed) (Rust, Axum, Candle)
- **Port:** 8080
- **Models (4, all on Metal GPU):**
  - `bge-base-en-v1.5` (768-dim)
  - `all-MiniLM-L6-v2` (384-dim)
  - `gte-base-en-v1.5` (768-dim)
  - `nomic-embed-text-v1.5` (768-dim)
- **Config:** `EMBEDDING_PROVIDER=local` (default)
- **Cost:** Zero (runs locally on Apple Silicon)
- **Latency:** ~50ms per embedding (all 4 models in parallel)

## Cloud / SaaS: Cloud Ensemble (OpenAI + Cohere)

- **Service:** Built-in `CloudEnsembleService` (`src/embedding/cloud-ensemble.service.ts`)
- **Models (up to 3):**
  - `openai-small` — OpenAI `text-embedding-3-small` (1536-dim)
  - `openai-large` — OpenAI `text-embedding-3-large` (3072-dim)
  - `cohere-v3` — Cohere Embed v3 (1024-dim)
- **Config:** `EMBEDDING_PROVIDER=cloud-ensemble`
- **Required env vars:**
  - `OPENAI_API_KEY` (required — enables both OpenAI models)
  - `COHERE_API_KEY` (optional — enables Cohere model)
- **Cost:** Per-token pricing from OpenAI/Cohere
- **Latency:** ~200-500ms per embedding (all models in parallel)

## Why Different Models Per Environment?

| Concern | Self-Hosted | Cloud (SaaS) |
|---------|------------|---------------|
| Cost | Zero (local GPU) | Per-token API costs |
| Privacy | All data stays local | Data sent to OpenAI/Cohere |
| Setup | Requires Apple Silicon + Rust build | Just API keys |
| Quality | Research models, excellent for general use | Industry-leading models, best recall |
| Scaling | Limited by local hardware | Scales with API rate limits |

Self-hosted users get free, private embeddings via engram-embed on their own hardware. SaaS users get the highest-quality commercial models without any infrastructure setup.

## Configuration

### Railway (Production SaaS)

Set these environment variables on the Railway service:

```
EMBEDDING_PROVIDER=cloud-ensemble
OPENAI_API_KEY=sk-...
COHERE_API_KEY=...          # optional but recommended
```

### Local Development

engram-embed starts automatically via LaunchAgent `ai.engram.embed`:

```
EMBEDDING_PROVIDER=local
ENGRAM_EMBED_URL=http://localhost:8080
EMBED_DEVICE=metal
```

### Fallback Behavior

If `EMBEDDING_PROVIDER=cloud-ensemble` is set but the API keys are missing:
- Missing `OPENAI_API_KEY`: No cloud models available (warning logged)
- Missing `COHERE_API_KEY`: Only OpenAI models active (2 of 3)

If `EMBEDDING_PROVIDER=local` but engram-embed is unreachable:
- Health endpoint reports `engramEmbed: down`
- Semantic search returns errors until the service is restored
- Memory creation still works (embeddings queued or skipped)

## Ensemble Search

Both backends produce multiple embeddings per memory. At query time, Engram's ensemble search:

1. Generates query embeddings with all available models
2. Runs parallel pgvector similarity searches per model
3. Fuses results using Reciprocal Rank Fusion (RRF)
4. Returns a single ranked result set

This multi-model approach improves recall by ~15-20% over single-model search, as different models capture different semantic aspects of the text.

## Key Files

- `src/embedding/cloud-ensemble.service.ts` — Cloud provider orchestration
- `src/embedding/openai-embed.provider.ts` — OpenAI embedding provider
- `src/embedding/providers/` — Provider implementations
- `src/embedding/embedding-provider.interface.ts` — Common interface
- `src/ensemble/` — Ensemble search, RRF fusion, drift detection

---

*This is a critical architectural document. Update it when embedding providers or models change.*
