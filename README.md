<p align="center">
  <img src="docs/assets/engram-logo.png" alt="Engram" width="120" />
  <h1 align="center">Engram</h1>
  <p align="center"><strong>Memory infrastructure for AI agents that actually works.</strong></p>
  <p align="center">
    <a href="https://github.com/heybeaux/engram/actions"><img src="https://img.shields.io/github/actions/workflow/status/heybeaux/engram/ci.yml?label=build&style=flat-square" alt="Build"></a>
    <a href="https://github.com/heybeaux/engram/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue?style=flat-square" alt="License"></a>
    <a href="https://github.com/heybeaux/engram/releases"><img src="https://img.shields.io/github/v/release/heybeaux/engram?style=flat-square&label=version" alt="Version"></a>
    <a href="https://github.com/heybeaux/engram"><img src="https://img.shields.io/github/stars/heybeaux/engram?style=flat-square" alt="Stars"></a>
  </p>
  <p align="center">
    <a href="https://github.com/heybeaux/engram">Core API</a> •
    <a href="https://github.com/heybeaux/engram-dashboard">Dashboard</a> •
    <a href="https://github.com/heybeaux/engram-embed">Local Embeddings</a> •
    <a href="https://github.com/heybeaux/engram/blob/main/docs/API.md">API Docs</a>
  </p>
</p>

---

> An **engram** is a hypothetical permanent change in the brain accounting for the existence of memory — a memory trace.

## Why Engram?

Every AI agent wakes up blank. It doesn't remember yesterday's conversation, last week's decision, or the user's name. Most "memory" solutions bolt vector search onto chat history and call it a day. That's not memory — that's ctrl+F.

Engram extracts structured knowledge from conversations, classifies it by type, scores importance, detects safety-critical information, and consolidates memories over time — like how your brain moves short-term into long-term storage while you sleep.

| Feature | Engram | Mem0 | Zep | LangMem |
|---------|--------|------|-----|---------|
| Self-hosted | ✅ | ✅ | ✅ | ✅ |
| Local embeddings (zero cost) | ✅ Metal GPU | ❌ | ❌ | ❌ |
| Multi-model ensemble search | ✅ 4 models | ❌ | ❌ | ❌ |
| Dream Cycle (consolidation) | ✅ 4-stage | ❌ | ❌ | ❌ |
| Semantic deduplication | ✅ 3-tier | Basic | Basic | ❌ |
| Safety-critical detection | ✅ 16 patterns | ❌ | ❌ | ❌ |
| Temporal reasoning | ✅ | ❌ | ❌ | ❌ |
| Memory pools (multi-agent) | ✅ | ❌ | ✅ | ❌ |
| Graph visualization | ✅ | ❌ | ✅ | ❌ |
| Fog Index (health scoring) | ✅ | ❌ | ❌ | ❌ |
| License | Apache 2.0 | Apache 2.0 | Apache 2.0 | MIT |

## Quickstart (5 minutes)

### Docker (recommended)

```bash
git clone https://github.com/heybeaux/engram && cd engram
cp .env.example .env
docker compose up -d
```

API at `localhost:3001`, Dashboard at `localhost:3000`.

### From Source

```bash
git clone https://github.com/heybeaux/engram && cd engram
pnpm install
cp .env.example .env  # edit DATABASE_URL
npx prisma migrate deploy
npx prisma generate
pnpm start:dev
```

### Fully Local (zero cloud dependency)

```bash
# In .env:
LLM_PROVIDER=ollama
LLM_MODEL=llama3.2
EMBEDDING_PROVIDER=local  # uses engram-embed (Rust, Metal GPU, free)
VECTOR_PROVIDER=pgvector
```

Zero data leaves your machine.

### Your First Memory

```bash
# Remember something
curl -X POST http://localhost:3001/v1/memories \
  -H "Content-Type: application/json" \
  -H "X-AM-User-ID: demo" \
  -d '{"raw": "The user prefers dark mode and is allergic to peanuts"}'

# Engram auto-extracts: type=PREFERENCE+CONSTRAINT, flags safety-critical, generates embeddings

# Recall it
curl -X POST http://localhost:3001/v1/memories/query \
  -H "Content-Type: application/json" \
  -H "X-AM-User-ID: demo" \
  -d '{"query": "What are the user preferences?", "limit": 5}'

# Temporal recall
curl -X POST http://localhost:3001/v1/memories/query \
  -d '{"query": "what did we discuss yesterday?", "limit": 10}'

# Generate context for system prompt injection
curl -X POST http://localhost:3001/v1/context \
  -d '{"maxTokens": 4000}'
```

## Architecture

```
┌──────────┐     ┌──────────────────────────────────┐     ┌──────────────┐
│  Your AI │────▶│        Engram API (NestJS)        │────▶│  PostgreSQL  │
│  Agent   │◀────│           port 3001               │     │  + pgvector  │
└──────────┘     │                                    │     └──────────────┘
                 │  Extraction · Scoring · Temporal   │
                 │  Safety Detection · Dream Cycle    │     ┌──────────────┐
                 │  Memory Pools · Ensemble Search    │────▶│ engram-embed │
                 └──────────────────────────────────┘     │ (Rust/Metal) │
                                │                          └──────────────┘
                 ┌──────────────────────────────────┐
                 │     Dashboard (Next.js:3000)      │     ┌──────────────┐
                 └──────────────────────────────────┘     │ LLM Provider │
                                                           │ OpenAI/Claude│
                                                           │ Ollama/LM St │
                                                           └──────────────┘
```

- **Core API** (NestJS) — CRUD, search, context generation, 120+ endpoints
- **Ensemble Search** — 4 embedding models vote on relevance via RRF fusion
- **Dream Cycle** — Nightly 4-stage consolidation: dedup → staleness → patterns → report
- **engram-embed** — Local Rust embedding server, Metal GPU, ~10ms per vector, $0 cost
- **engram-code** — Semantic code search across repos
- **Plugin System** — Swap embedding providers, storage backends, event handlers

## Key Features

### Ensemble Search

Four embedding models (bge-base, minilm, nomic, gte-base) independently score every query. Results are fused via Reciprocal Rank Fusion, eliminating single-model blind spots. Each model runs locally on Metal GPU through [engram-embed](https://github.com/heybeaux/engram-embed) at ~10ms per embedding.

### Dream Cycle

Inspired by sleep neuroscience, the Dream Cycle runs a 4-stage consolidation pipeline: semantic deduplication, staleness decay, pattern extraction, and health reporting. Memories that reinforce each other strengthen; isolated or stale memories fade. Safety-critical memories (allergies, medications, DNR directives) are exempt — they never decay.

### Semantic Deduplication

Three-tier dedup catches duplicates that simple string matching misses. Exact match, embedding similarity, and LLM-verified semantic equivalence work together. Merge candidates surface in the dashboard for review or auto-resolution.

### Safety-Critical Detection

Sixteen patterns detect health information, allergies, medications, emergency contacts, and legal directives. Flagged memories get elevated importance, decay immunity, and always appear in context — your agent will never forget a peanut allergy.

### Temporal Reasoning

Understands natural language time references: "yesterday," "last week," "3 hours ago." Time-first retrieval, then semantic ranking. Your agent knows *when* things happened, not just what.

### Fog Index

A 6-component cognitive health score that measures how "clear" your agent's memory is — duplicate ratio, staleness, coverage gaps, contradiction density. Monitor drift before it becomes a problem.

## Screenshots

<p align="center">
  <img src="docs/screenshots/dashboard-overview.jpg" alt="Dashboard Overview" width="700" /><br />
  <em>Dashboard — Memory stats, Fog Index, API volume, layer breakdown</em>
</p>

<p align="center">
  <img src="docs/screenshots/knowledge-graph.jpg" alt="Knowledge Graph" width="700" /><br />
  <em>Knowledge Graph — Entities and relationships visualized with D3</em>
</p>

<p align="center">
  <img src="docs/screenshots/memories.jpg" alt="Memory Browser" width="700" /><br />
  <em>Memory Browser — Semantic search, layer filtering, importance scores</em>
</p>

## API Reference

Full Swagger docs at `/v1/docs` when the server is running. See [docs/API.md](./docs/API.md) for the complete reference.

**Most-used endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/memories` | Store a memory |
| `POST` | `/v1/memories/query` | Semantic + temporal search |
| `POST` | `/v1/observe` | Auto-capture from conversation turns |
| `POST` | `/v1/context` | Generate context for system prompt |
| `POST` | `/ensemble/query` | Multi-model RRF fusion search |
| `POST` | `/v1/consolidation/dream-cycle` | Run Dream Cycle |
| `GET` | `/v1/health` | System health + metrics |
| `GET` | `/v1/fog-index` | Cognitive health score |

## Dashboard

The [Engram Dashboard](https://github.com/heybeaux/engram-dashboard) is a Next.js app included in `docker compose up`:

- **Memory Browser** — Search, filter, inspect, edit memories with full metadata
- **Knowledge Graph** — Interactive D3 force-directed graph with effectiveScore sizing
- **Ensemble Status** — Active models, coverage stats, A/B comparisons
- **Fog Index** — Real-time cognitive health monitoring
- **Merge Candidates** — Review and resolve duplicate clusters
- **Dream Cycle Status** — Consolidation history and health reports

## Integration

### Any AI Framework

Engram is a REST API. Point your agent at `localhost:3001` and use the endpoints above.

### OpenClaw

Native integration via workspace hooks — automatic memory capture on conversation turns, contextual recall on topic shifts. See the [Integration Guide](./docs/OPENCLAW_HOOK_INTEGRATION.md).

### Bring Your Own LLM

OpenAI, Anthropic, Ollama, LM Studio — swap providers with one env var. See [`.env.example`](.env.example).

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | *required* |
| `LLM_PROVIDER` | `openai` / `anthropic` / `ollama` / `lmstudio` | `openai` |
| `EMBEDDING_PROVIDER` | `openai` / `ollama` / `local` | `openai` |
| `ENSEMBLE_ENABLED` | Multi-model ensemble search | `true` |
| `LOCAL_EMBED_URL` | engram-embed server URL | `http://localhost:8080` |

See [`.env.example`](.env.example) for the full list.

## Contributing

We'd love your help. See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

**High-impact areas:**
- Python SDK
- Integration adapters (LangChain, CrewAI, AutoGen)
- New embedding/LLM providers
- Extraction quality improvements
- Documentation and examples

## Roadmap

**v2.0 and beyond:**
- 🔌 Plugin system — pluggable storage, embedding, and event adapters
- 🕐 Temporal reasoning v2 — contradiction detection, change tracking
- 🌐 Federated memory — CRDT-based sync between instances
- 🎤 Multimodal — voice transcription, image memories
- 👥 Team memory — multi-user pools with RBAC

See [ROADMAP.md](./ROADMAP.md) for the full plan.

## License

[Apache License 2.0](./LICENSE)

---

<p align="center">
  <em>Every agent deserves to remember.</em>
</p>
