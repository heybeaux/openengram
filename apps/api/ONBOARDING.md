# Onboarding Guide

Welcome to Engram. This doc gets you productive fast — project structure, dev setup, key concepts, and common tasks.

## Project Structure

```
src/
├── memory/              # Core memory CRUD, recall, search, context generation
├── embedding/           # Embedding provider abstraction (local, OpenAI, Cohere)
├── ensemble/            # Multi-model ensemble search with Reciprocal Rank Fusion
├── vector/              # pgvector operations, similarity search
├── graph/               # Knowledge graph — entity/relationship extraction + querying
├── consolidation/       # Dream Cycle — nightly memory consolidation pipeline
├── clustering/          # Memory clustering (part of Dream Cycle)
├── deduplication/       # Three-tier dedup: merge ≥0.90, reject <0.85, review middle
├── fog-index/           # Memory health scoring ("brain fog" metric)
├── summarization/       # Memory summarization and compression
├── correction/          # Memory correction and fact updates
├── hierarchy/           # Memory hierarchy units (grouping/organization)
├── memory-pool/         # Shared memory spaces between agents
├── memory-access-log/   # Access tracking for recall analytics
├── scoped-context/      # Context window generation for LLM prompts
├── multi-query/         # Query expansion for better recall
├── prefetch/            # Predictive memory prefetching
├── reembedding/         # Re-embedding pipeline (model upgrades, new models)
├── agent/               # Agent management (CRUD, agent-scoped operations)
├── agent-session/       # Agent session tracking
├── user/                # User management
├── account/             # Account management (multi-tenant)
├── session/             # Session management
├── project/             # Project scoping
├── instance/            # Instance management (for cloud link)
├── cloud-link/          # Cloud Link — bridges local ↔ cloud editions
├── cloud-sync/          # Sync engine (push memories to cloud)
├── stripe/              # Stripe billing integration (cloud edition)
├── rate-limit/          # API rate limiting
├── monitoring/          # System monitoring and metrics
├── analytics/           # Usage analytics
├── eval/                # Memory quality evaluation
├── events/              # Internal event bus
├── webhooks/            # External webhook delivery with HMAC signing
├── feedback/            # User feedback on memory quality
├── health/              # Health check endpoints
├── dashboard/           # Dashboard API (stats, charts, admin)
├── llm/                 # LLM provider abstraction (OpenAI, Anthropic, Ollama)
├── auto/                # Auto-extraction, auto-tagging, safety detection
├── config/              # App configuration
├── common/              # Shared guards, middleware, decorators, DTOs
├── prisma/              # Prisma service and module
├── storage/             # File/blob storage
├── utils/               # Shared utilities
└── scripts/             # One-off and maintenance scripts
```

Key files:
- `src/app.module.ts` — Root module, conditionally loads cloud-only modules based on `EDITION` env
- `prisma/schema.prisma` — 53 models, the source of truth for the database
- `docker-compose.yml` — Local dev with pgvector
- `.env.example` — All configuration options documented

## Local Dev Setup

### Prerequisites
- Node.js 20+
- pnpm 9+
- PostgreSQL 16 with pgvector (or just use Docker)
- [engram-embed](https://github.com/heybeaux/engram-embed) for local embeddings (optional — falls back to mock)

### Steps

```bash
# 1. Clone and install
git clone https://github.com/heybeaux/engram && cd engram
pnpm install

# 2. Start PostgreSQL with pgvector
docker compose up postgres -d

# 3. Configure environment
cp .env.example .env
# Defaults work for local dev — no changes needed

# 4. Run migrations
pnpm migrate:deploy

# 5. Generate Prisma client
npx prisma generate

# 6. Start dev server
pnpm start:dev
```

API runs at `http://localhost:3001`. Swagger UI at `http://localhost:3001/v1/docs`.

### With engram-embed (local GPU embeddings)

If you have a Mac with Apple Silicon, run [engram-embed](https://github.com/heybeaux/engram-embed) alongside for local embedding generation (~10ms per vector on Metal GPU). Without it, the API still works but uses mock/cloud embeddings.

## Running Tests

```bash
pnpm test              # Run all 1,504 tests
pnpm test:watch        # Watch mode
pnpm test:cov          # With coverage
pnpm test:e2e          # End-to-end tests (needs running DB)
pnpm test -- --grep "dedup"  # Run tests matching a pattern
```

Tests are colocated with source files: `src/memory/memory.service.spec.ts` lives next to `memory.service.ts`.

## Key Concepts

### Memory
The core entity. A memory has `content` (text), `metadata`, `importance` score, `layer` (episodic/semantic/procedural), and belongs to an `agent` and `user` within an `account`. Memories are soft-deleted (never truly gone).

### Agent
An AI agent that owns memories. Each agent has its own memory space. Agents belong to an account.

### User
The human a memory is about. Agents store memories *about* users. The agent-user pair scopes most queries.

### Account
Multi-tenant isolation boundary. In cloud edition, each account has RLS policies on 42 tables. In local edition, there's typically one account.

### Embeddings
Every memory gets embedded by up to 4 models (bge-base, MiniLM, gte-base, nomic). Stored in `MemoryEmbedding` with pgvector. Ensemble search fuses results across all models using Reciprocal Rank Fusion — this is a core differentiator.

### Dream Cycle
Runs nightly at 3am. Four stages:
1. **Deduplication** — find and merge near-duplicate memories
2. **Staleness** — decay importance of old, unaccessed memories
3. **Pattern detection** — cluster related memories, extract themes
4. **Report** — generate a `DreamCycleReport` with stats

Creates `DreamCycleRun` records. Configurable per-agent.

### Fog Index
A health metric for memory quality. Measures coherence, redundancy, staleness, and gaps. Think of it as "brain fog scoring" — lower is better. Snapshots stored in `FogIndexSnapshot`.

### Cloud Link
Bridges local and cloud editions. Local instance registers with cloud via `InstanceApiKey` (prefixed `eng_inst_`), then pushes memories upstream. Pull sync is Phase 2. See `docs/specs/` and `cloud-sync-v2.md`.

### Memory Pools
Shared memory spaces. Multiple agents can read/write to a pool via `PoolGrant` permissions. Useful for team knowledge bases.

## Database Schema Overview

53 Prisma models. The key ones and their relationships:

```
Account (tenant root)
├── Agent (AI agents)
│   ├── Memory (the memories)
│   │   ├── MemoryEmbedding (vector embeddings, one per model)
│   │   ├── MemoryEntity (links to GraphEntity)
│   │   ├── MemoryExtraction (extracted facts)
│   │   └── MemoryAccessLog (recall tracking)
│   ├── AgentSession (session tracking)
│   └── DreamCycleRun / DreamCycleReport
├── User (humans the memories are about)
├── GraphEntity / GraphRelationship (knowledge graph)
├── MemoryPool / PoolGrant (shared memory)
├── Webhook / WebhookSubscription (event notifications)
├── CloudLink / InstanceApiKey (cloud sync)
└── FogIndexSnapshot / MonitoringSnapshot (health)
```

Key patterns:
- Almost everything is scoped to `accountId` for multi-tenant isolation
- Memories have a `contentHash` for dedup (SHA-256 of normalized content)
- Soft deletes via `deletedAt` timestamp
- `MemoryEmbedding` is separate from `Memory` — one memory has multiple embeddings (one per model)

## Common Tasks

### Add a new endpoint

1. Create or edit the relevant module in `src/<module>/`
2. Add the route to the controller: `src/<module>/<module>.controller.ts`
3. Add business logic in the service: `src/<module>/<module>.service.ts`
4. Add DTOs in `src/<module>/dto/`
5. Write tests in `src/<module>/<module>.service.spec.ts`
6. If it needs a new module, register it in `src/app.module.ts`

### Add a database migration

```bash
# Edit prisma/schema.prisma, then:
pnpm migrate:safe          # Uses safe-migrate.sh wrapper

# NEVER run `prisma migrate dev` or `prisma migrate reset` — these can wipe data.
# Always use migrate:safe or migrate:deploy.
```

### Run deduplication manually

Dedup runs as part of the Dream Cycle, but you can trigger it via the API or through the dashboard. The dedup config is in `DedupConfig` — thresholds for merge (≥0.90), reject (<0.85), and the review band in between.

### Test a specific module

```bash
pnpm test -- src/ensemble    # Run all ensemble tests
pnpm test -- --watch src/memory/memory.service.spec.ts  # Watch one file
```

## Architecture Decisions

### Why ensemble search (4 models)?
No single embedding model is best at everything. bge-base handles general semantics, MiniLM is fast for short queries, gte-base catches things others miss, nomic handles longer contexts. Reciprocal Rank Fusion combines their rankings — if 3 of 4 models agree a memory is relevant, it ranks high even if one model misses it. This eliminates single-model blind spots and measurably improves recall quality.

### Why content hash dedup?
Every memory gets a SHA-256 hash of its normalized content. This catches exact duplicates at write time (O(1) lookup) before they ever hit the more expensive semantic dedup in the Dream Cycle. Three-tier semantic dedup then handles near-duplicates: merge if ≥0.90 similarity, reject if <0.85, flag for review in between.

### Why Row-Level Security (RLS)?
Cloud edition is multi-tenant. Rather than hoping every query includes `WHERE accountId = ?`, RLS enforces isolation at the PostgreSQL level. 42 tables have RLS policies. Even if application code has a bug, one tenant can never see another's data. See `docs/RLS-IMPLEMENTATION.md`.

### Why separate embedding service (Rust)?
Embedding generation is CPU/GPU-bound work. Running it in the Node.js process would block the event loop. engram-embed is a standalone Rust binary using Candle for inference on Apple Metal — it generates embeddings in ~10ms and communicates over HTTP. Decoupled, independently scalable.

### Why edition-based module loading?
`app.module.ts` conditionally loads modules based on `EDITION` env var. Local edition doesn't load Stripe, cloud-specific auth, or RLS modules. This keeps local installs simple and dependency-free while sharing the same codebase. See `docs/specs/edition-split.md`.

## Useful Links

- [API Reference](./docs/API.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Architecture Decisions](./docs/ARCHITECTURE_DECISION.md)
- [Auth Architecture](./docs/AUTH-ARCHITECTURE.md)
- [Cloud Sync V2 Spec](./cloud-sync-v2.md)
- [Configuration](./docs/CONFIGURATION.md)
- [Database Architecture](./docs/DATABASE-ARCHITECTURE.md)
- [Embedding Architecture](./docs/EMBEDDING-ARCHITECTURE.md)
- [Edition Split Spec](./docs/specs/edition-split.md)
- [Getting Started](./docs/getting-started.md)
- [Migrations Guide](./docs/MIGRATIONS.md)
- [Patterns](./docs/PATTERNS.md)
- [RLS Implementation](./docs/RLS-IMPLEMENTATION.md)
- [Testing](./docs/TESTING.md)
- [Dashboard Repo](https://github.com/heybeaux/engram-dashboard)
- [Local Embeddings (engram-embed)](https://github.com/heybeaux/engram-embed)
