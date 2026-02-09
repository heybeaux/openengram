<p align="center">
  <h1 align="center">Engram</h1>
  <p align="center"><strong>Memory infrastructure for AI agents.</strong></p>
  <p align="center">
    <a href="https://github.com/heybeaux/engram/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License"></a>
    <a href="https://github.com/heybeaux/engram/actions"><img src="https://img.shields.io/github/actions/workflow/status/heybeaux/engram/ci.yml?label=tests" alt="Tests"></a>
  </p>
  <p align="center">
    <strong>Ecosystem:</strong>&nbsp;
    <a href="https://github.com/heybeaux/engram">Core API</a> •
    <a href="https://github.com/heybeaux/engram-dashboard">Dashboard</a> •
    <a href="https://github.com/heybeaux/engram-embed">Local Embeddings</a>
  </p>
</p>

> An **engram** is a hypothetical permanent change in the brain accounting for the existence of memory — a memory trace.

Every AI agent wakes up blank. Engram fixes that.

---

## Why Engram?

Most "memory" solutions for AI agents are glorified vector search over chat history. Engram is different:

- **Type-aware** — Classifies memories as CONSTRAINT, PREFERENCE, FACT, TASK, or EVENT
- **Safety-critical** — Allergies, medications, and emergencies are never evicted from context
- **Time-aware** — Understands "yesterday," "last week," "3 hours ago" in recall queries
- **Scored** — effectiveScore blends decay, novelty, usage, and importance
- **Consolidating** — Sleep consolidation compresses duplicates into essential facts
- **Confident** — Per-field confidence scores (0.0-1.0) on every extraction
- **Flexible** — Bring your own LLM (OpenAI, Anthropic, Ollama, LM Studio)
- **Local-first** — pgvector for embeddings, no cloud required

```
"I'm allergic to peanuts"     → CONSTRAINT (safety-critical, never evicted)
"I prefer dark mode"          → PREFERENCE (high priority, slow decay)
"I live in Vancouver"         → FACT (stable, minimal decay)
"Fix the login bug"           → TASK (fast decay after completion)
"We discussed auth yesterday" → EVENT (normal decay)
```

## What's New in v0.5

### Graceful Degradation
When `engram-embed` is down, memories are saved without embeddings. A background retry runs every 5 minutes and backfills embeddings automatically once the service recovers.

### `/health` Endpoint
`GET /v1/health` (no auth) returns system health and quality metrics:

```json
{
  "status": "healthy | degraded | unhealthy",
  "timestamp": "2026-02-09T...",
  "metrics": {
    "totalMemories": 1539,
    "extractionRate": 0.94,
    "whoExtractionRate": 0.87,
    "entitiesPerMemory": 2.3,
    "linksPerMemory": 1.1,
    "memoriesLast24h": 42,
    "safetyCriticalCount": 8,
    "consolidatedCount": 156
  },
  "issues": []
}
```

### Retrieval-Aware Decay
Memory decay now anchors on `lastRetrievedAt` instead of `createdAt`. Memories you actively use stay relevant longer. Adjusted half-lives: SESSION 30d (was 14d), TASK 7d (was 3d).

### Generate Context Improvements
- Recent-first categorization with staleness filtering
- Current project detection from recent memory patterns
- Better token budget allocation across categories

### Eval Framework
22 semantic recall scenarios covering temporal queries, safety-critical recall, type classification, and deduplication. Run with `pnpm test:eval`.

---

## Quick Start

```bash
# Clone
git clone https://github.com/heybeaux/engram
cd engram

# Install
pnpm install

# Configure
cp .env.example .env
# Edit .env with your database URL and LLM keys

# Database
pnpm prisma migrate dev

# Run
pnpm start:dev
```

Server starts at `http://localhost:3001`. Health check: `GET /v1/health` (no auth required).

### Store a memory

```bash
curl -X POST http://localhost:3001/v1/memories \
  -H "Content-Type: application/json" \
  -H "X-AM-API-Key: your-key" \
  -H "X-AM-User-ID: beaux" \
  -d '{"raw": "I prefer dark mode for all applications"}'
```

Engram automatically:
- Extracts 5W1H structure (who, what, when, where, why, how)
- Classifies the memory type (PREFERENCE)
- Generates an embedding for semantic search
- Scores importance and detects safety-critical content
- Assigns field-level confidence scores
- Links related memories

### Recall memories

```bash
# Semantic search
curl -X POST http://localhost:3001/v1/memories/query \
  -H "Content-Type: application/json" \
  -H "X-AM-API-Key: your-key" \
  -H "X-AM-User-ID: beaux" \
  -d '{"query": "user preferences", "limit": 10}'

# Temporal search — understands "yesterday", "last week", etc.
curl -X POST http://localhost:3001/v1/memories/query \
  -d '{"query": "What did we discuss yesterday?", "limit": 10}'

# Load context for system prompt injection
curl -X POST http://localhost:3001/v1/context \
  -d '{"maxTokens": 4000}'
```

### Auto-capture from conversations

```bash
curl -X POST http://localhost:3001/v1/observe \
  -H "Content-Type: application/json" \
  -H "X-AM-API-Key: your-key" \
  -H "X-AM-User-ID: beaux" \
  -d '{
    "turns": [
      {"role": "user", "content": "I always use TypeScript for new projects"},
      {"role": "assistant", "content": "Noted — TypeScript it is."},
      {"role": "user", "content": "Remember: never deploy on Fridays"}
    ]
  }'
```

## Features

### Memory Intelligence v2

Every memory is classified by type and scored for priority:

| Type | Priority | Decay | Example |
|------|----------|-------|---------|
| CONSTRAINT | 1 (highest) | None (safety floor 0.6) | "Allergic to penicillin" |
| PREFERENCE | 2 | Slow (60d half-life) | "Prefers dark mode" |
| TASK | 2 | Fast (7d half-life) | "Fix the login bug by Friday" |
| FACT | 3 | Slow (60d half-life) | "Lives in Vancouver" |
| EVENT | 4 (lowest) | Normal (14d half-life) | "Discussed auth flow" |

### effectiveScore

```
effectiveScore = max(safetyFloor, (baseScore × decayFactor) + noveltyBoost + usageBoost + pinnedBoost)
```

- **Decay**: Memories fade over time (configurable per-layer half-life)
- **Novelty**: New memories get a temporary boost (+0.15, tapers over 7 days)
- **Usage**: Frequently retrieved memories score higher
- **Pinned**: User-pinned memories get a permanent boost
- **Safety floor**: Safety-critical memories never drop below 0.6

### Temporal Recall

Queries with temporal expressions are automatically parsed and time-filtered:

```
"What happened yesterday?"     → Filters to yesterday, searches "what happened"
"Show me last week's decisions" → Filters to last 7 days, searches "decisions"
"What did we discuss 2 hours ago?" → Filters to 2h window
```

Time is the primary constraint. Semantic similarity is secondary. This matches how human memory works — you jump to the time period first, then search within it.

### Sleep Consolidation

Periodic job that compresses duplicate memories:

1. Clusters similar SESSION memories (0.85 similarity threshold)
2. Uses LLM to extract the essential "gist" from each cluster
3. Promotes the canonical memory to IDENTITY layer
4. Soft-deletes duplicates with audit trail

### Contextual Recall

Automatically surfaces relevant memories when conversation topics shift:

```bash
curl -X POST http://localhost:3001/v1/recall/contextual \
  -H "Content-Type: application/json" \
  -H "X-AM-API-Key: your-key" \
  -d '{"sessionId": "abc123", "messages": [...]}'
```

- Detects topic shifts via cosine distance between consecutive messages
- 30-second cooldown prevents recall flooding
- Per-session rate limiting for multi-agent environments

### Dream Cycle

A 4-stage memory consolidation pipeline inspired by sleep consolidation in the brain:

```bash
curl -X POST http://localhost:3001/v1/consolidation/dream-cycle \
  -H "X-AM-API-Key: your-key" \
  -d '{"agentId": "clawd-agent-001"}'
```

1. **Dedup** — Merges duplicate memories (three-tier: auto-merge ≥0.93, reinforce ≥0.85, flag ≥0.78)
2. **Staleness** — Soft-deletes stale, low-value memories
3. **Patterns** — Extracts recurring themes into higher-order memories
4. **Report** — Summarizes all consolidation actions

Protected types (CONSTRAINT, pinned) are never touched. All deletes are soft-deletes.

### Generate Context

Auto-curates your top memories into a ready-to-inject `MEMORY_CONTEXT.md`:

```bash
curl -X POST http://localhost:3001/v1/consolidation/generate-context \
  -H "X-AM-API-Key: your-key" \
  -d '{"agentId": "clawd-agent-001", "maxTokens": 1500}'
```

- Groups memories by category (Identity, Projects, Recent Context)
- Respects a configurable token budget
- Designed as Dream Cycle Stage 5

### Safety-Critical Detection

16 patterns detect safety-relevant information:

Allergies, medications, diabetes, seizures, asthma, emergency contacts, blood type, DNR directives, life-threatening conditions, and more.

Safety-critical memories:
- Get a score floor of 0.6 (never fade below this)
- Are never evicted from context, regardless of token budget
- Display with a red ring and 🏥 badge in the graph visualization

### Field-Level Confidence

Every extraction field carries a confidence score:

| Score | Meaning | Example |
|-------|---------|---------|
| 1.0 | Explicitly stated | "I live in Vancouver" → where: 1.0 |
| 0.7-0.9 | Strongly implied | "Working from Pacific timezone" → where: 0.8 |
| 0.4-0.6 | Inferred | "Mentioned a meeting at Google" → where: 0.5 |
| 0.1-0.3 | Guessed | Weak signal, heuristic extraction |

## Architecture

```
┌─────────────┐     ┌──────────────────────────────┐     ┌─────────────┐
│   Client    │────▶│         Engram Server         │────▶│  PostgreSQL │
│  (Agent /   │     │  ┌──────────┐ ┌────────────┐ │     │  + pgvector │
│   SDK)      │     │  │Extraction│ │  Temporal   │ │     └─────────────┘
└─────────────┘     │  │ Pipeline │ │   Parser    │ │
                    │  └──────────┘ └────────────┘ │     ┌─────────────┐
                    │  ┌──────────┐ ┌────────────┐ │     │  LLM APIs   │
                    │  │ Scoring  │ │   Safety    │ │────▶│  (OpenAI /  │
                    │  │ Engine   │ │  Detector   │ │     │  Anthropic /│
                    │  └──────────┘ └────────────┘ │     │  Ollama)    │
                    │  ┌──────────┐ ┌────────────┐ │     └─────────────┘
                    │  │Consolid- │ │   Graph     │ │
                    │  │ation     │ │   Viz (D3)  │ │     ┌─────────────┐
                    │  └──────────┘ └────────────┘ │     │  Pinecone   │
                    └──────────────────────────────┘     │  (optional) │
                                                         └─────────────┘
```

### LLM Providers

| Provider | Chat/Extraction | Embeddings | Local? |
|----------|----------------|------------|--------|
| OpenAI | ✅ | ✅ | No |
| Anthropic | ✅ | ❌ (use OpenAI) | No |
| Ollama | ✅ | ✅ | Yes |
| LM Studio | ✅ | ✅ | Yes |

### Vector Providers

| Provider | Local? | Notes |
|----------|--------|-------|
| pgvector | Yes | Default. Runs in your PostgreSQL. |
| Pinecone | No | Optional cloud vector store. |

## API Reference

### Core Memory Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/v1/memories` | POST | ✅ | Create a memory |
| `/v1/memories/:id` | PATCH | ✅ | Update a memory |
| `/v1/memories/:id` | DELETE | ✅ | Soft-delete a memory |
| `/v1/memories/query` | POST | ✅ | Semantic + temporal search |
| `/v1/memories/graph` | GET | ✅ | Graph data for visualization |
| `/v1/context` | POST | ✅ | Load context for system prompt |
| `/v1/observe` | POST | ✅ | Auto-capture from conversation |
| `/v1/consolidate` | POST | ✅ | Trigger sleep consolidation |
| `/v1/recall/contextual` | POST | ✅ | Contextual recall (topic shift detection) |
| `/v1/consolidation/dream-cycle` | POST | ✅ | Run 4-stage Dream Cycle consolidation |
| `/v1/consolidation/generate-context` | POST | ✅ | Generate MEMORY_CONTEXT.md from top memories |
| `/v1/health` | GET | ❌ | System health + metrics |

### Multi-Model Ensemble Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/ensemble/status` | GET | ✅ | Get ensemble config and status |
| `/ensemble/query` | POST | ✅ | Multi-model RRF fusion query |
| `/ensemble/upsert` | POST | ✅ | Upsert with multi-model embeddings |
| `/ensemble/compare` | POST | ✅ | Compare ensemble vs single-model |
| `/ensemble/embed` | POST | ✅ | Generate embeddings for text |

### Re-embedding Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/v1/reembedding/enabled` | GET | ✅ | Check if re-embedding is enabled |
| `/v1/reembedding/status` | GET | ✅ | Get current job status |
| `/v1/reembedding/status/:jobId` | GET | ✅ | Get specific job status |
| `/v1/reembedding/jobs` | GET | ✅ | List all re-embedding jobs |
| `/v1/reembedding/run` | POST | ✅ | Trigger batch re-embedding |
| `/v1/reembedding/preview/:memoryId` | GET | ✅ | Preview enrichment for memory |
| `/v1/reembedding/memory/:memoryId` | POST | ✅ | Re-embed a single memory |

### Dashboard Integration Endpoints (Proposed)

These endpoints would enhance the dashboard's multi-model visibility:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ensemble/models` | GET | List all registered models with status |
| `/ensemble/memories/:id/embeddings` | GET | Per-memory embedding status per model |
| `/ensemble/coverage` | GET | Embedding coverage statistics |
| `/ensemble/ab-results` | GET | A/B test results for model comparison |

Full API documentation available in the [dashboard](https://github.com/heybeaux/engram-dashboard).

## Memory Layers

| Layer | Purpose | Decay Half-Life | Example |
|-------|---------|-----------------|---------|
| IDENTITY | Core user facts | ∞ (no decay) | Name, preferences, allergies |
| PROJECT | Work context | 60 days | Current projects, teammates |
| SESSION | Conversation context | 30 days | Recent discussions |
| TASK | Immediate work | 7 days | Active todos |

> **v0.5:** Decay is now retrieval-aware — the decay clock resets from `lastRetrievedAt` instead of `createdAt`, so memories you actually use stay fresh longer.

## Dashboard

Engram ships with a web dashboard (separate repo: [engram-dashboard](https://github.com/heybeaux/engram-dashboard)):

- **Memory browser** — Search, filter, edit memories
- **Graph visualization** — D3 force-directed graph with effectiveScore sizing and safety-critical badges
- **Documentation** — Built-in docs with quickstart, architecture, and API reference
- **Health monitoring** — System metrics and issue detection

## Integrations

### OpenClaw

Engram integrates with [OpenClaw](https://github.com/openclaw/openclaw) via workspace hooks for automatic memory capture from conversations.

See [OpenClaw Integration Guide](./docs/OPENCLAW_HOOK_INTEGRATION.md).

## Self-Hosting

### Requirements

- Node.js 20+
- PostgreSQL 15+ with pgvector extension
- An LLM provider (OpenAI API key, or local Ollama/LM Studio)

### Docker Compose

```yaml
version: '3.8'
services:
  engram:
    build: .
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: postgresql://engram:engram@postgres:5432/engram
      LLM_PROVIDER: openai
      OPENAI_API_KEY: ${OPENAI_API_KEY}
    depends_on:
      - postgres
  
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: engram
      POSTGRES_PASSWORD: engram
      POSTGRES_DB: engram
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

volumes:
  pgdata:
```

### Fully Local (No Cloud APIs)

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull models
ollama pull llama3.2
ollama pull nomic-embed-text

# Configure .env
LLM_PROVIDER=ollama
LLM_MODEL=llama3.2
EMBEDDING_PROVIDER=ollama
VECTOR_PROVIDER=pgvector
```

Zero data leaves your machine.

## Contributing

We'd love your help. See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

**High-impact areas:**
- Python SDK
- Integration guides (LangChain, AutoGen, CrewAI)
- New LLM/vector providers
- Extraction improvements
- Documentation

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for current priorities and future plans.

**Coming soon:**
- Webhook events (memory created, contradiction detected)
- Dashboard authentication
- Analytics and usage trends
- Python SDK
- Engram Cloud (managed hosting)

## License

Apache License 2.0 — see [LICENSE](./LICENSE).

## Authors

Built by [Beaux Walton](https://heybeaux.dev) and Rook ♜ in Powell River, BC.

---

<p align="center">
  <em>Every agent deserves to remember.</em>
</p>
