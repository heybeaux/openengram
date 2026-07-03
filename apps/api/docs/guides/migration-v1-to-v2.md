# Migration Guide: v1 to v2

This guide covers upgrading from Engram v1.x to v2.0.

## Breaking Changes

### 1. Edition-Based Module Loading

Engram now has two editions: **local** and **cloud**. Set via `EDITION` environment variable.

- `EDITION=local` (default) — Core modules only. No billing, ensemble, analytics, or monitoring.
- `EDITION=cloud` — Full feature set including ensemble embeddings, Stripe billing, analytics, eval, and webhooks.

**Action required:** Set `EDITION=cloud` if you were using any cloud-only features (ensemble, analytics, webhooks, eval, monitoring, reembedding, or Stripe billing).

### 2. Authentication Header Changes

The legacy `x-api-key` header is still accepted but the canonical headers are now:

| Header | Purpose |
|--------|---------|
| `X-AM-API-Key` | API key authentication |
| `X-AM-User-ID` | User identification |
| `X-AM-Agent-ID` | Agent scoping (new) |
| `Authorization: Bearer <token>` | JWT authentication |

### 3. Embedding Provider Configuration

The `EMBEDDING_PROVIDER` environment variable replaces the old embedding configuration:

| v1 | v2 |
|----|-----|
| _(built-in OpenAI)_ | `EMBEDDING_PROVIDER=openai` |
| _(N/A)_ | `EMBEDDING_PROVIDER=local` (default) |
| _(N/A)_ | `EMBEDDING_PROVIDER=cloud-ensemble` |

### 4. Vector Dimension Changes

v2 supports multiple embedding dimensions. If you were using OpenAI embeddings in v1 (1536 dimensions), the migration to 768-dimension local embeddings requires re-embedding. Use the provided migration script:

```bash
npx ts-node scripts/migrate-embeddings-768.ts
```

### 5. Row-Level Security

v2 introduces Prisma-based row-level security (RLS). All queries are now scoped to the authenticated account. This means:

- Memories are isolated per account
- Cross-account queries are no longer possible
- Admin endpoints require the `AdminGuard`

## New Features Overview

### Identity Framework
- **Delegation Contracts** — Structured task delegation between agents with success criteria and timeouts
- **Challenge Protocol** — Agents can challenge unsafe, underspecified, or mismatched tasks
- **Trust Profiles** — Domain-specific trust scores built from task completion history
- **Team Profiles** — Aggregate capabilities across multiple agents
- **Portable Identity** — Export/import agent identity between instances
- **Failure Pattern Detection** — Automatic detection of repeated, cascading, and timeout failures

### Awareness Module
- **Waking Cycle** — Proactive memory processing triggered on schedule or on-demand
- **Signal Integration** — GitHub, Linear, and memory-based signals
- **Pattern Detection** — Automatic insight generation from signal analysis

### Cloud Sync
- **Push/Pull Sync** — Bidirectional sync between local instances and Engram Cloud
- **Instance Management** — Register and manage multiple local instances
- **Conflict Resolution** — Content-hash-based deduplication during sync

### Memory Enhancements
- **Contextual Recall** — Richer recall with agent and conversation context
- **Memory Pools** — Organize memories into named pools
- **Scoped Context** — Context generation scoped to specific domains
- **Fog Index** — Memory accessibility scoring
- **Agent Sessions** — Track conversation sessions per agent

### Infrastructure
- **Rate Limiting** — Token-bucket rate limiter per API key
- **Usage Tracking** — Request counting against plan limits
- **Webhook Events** — Subscribe to memory lifecycle events
- **Dream Cycle Improvements** — Dedup, drift detection, pattern extraction, and staleness stages

## Database Migration Steps

### 1. Backup Your Database

```bash
pg_dump -U engram -Fc engram > engram_v1_backup.dump
```

### 2. Update the Code

```bash
git pull origin main
pnpm install
```

### 3. Run Migrations

```bash
# Check what migrations are pending
pnpm run migrate:status

# Apply all pending migrations
pnpm run migrate:deploy
```

Key migrations in v2:
- HNSW vector indexes for faster similarity search
- Awareness module tables
- Task completion tracking tables
- Vector dimension fixes (768-dim support)

### 4. Re-generate Prisma Client

```bash
npx prisma generate
```

### 5. Rebuild

```bash
pnpm build
```

## API Changes

### New Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/recall/contextual` | Context-aware recall |
| POST | `/v1/agents/:id/reflect` | Agent self-reflection |
| GET | `/v1/agents/:id/memories` | Agent self-memories |
| GET | `/v1/agents/:id/context` | Agent context for prompts |
| POST | `/v1/identity/task-completions` | Record task completion |
| GET | `/v1/identity/delegation-templates` | Get delegation suggestions |
| GET | `/v1/identity/agents/:id/trust-profile` | Agent trust profile |
| POST | `/v1/identity/teams` | Create team profile |
| GET | `/v1/identity/delegation-recall` | Delegation-aware recall |
| GET/POST | `/v1/identity/agents/:id/export` | Export agent identity |
| POST | `/v1/identity/agents/import` | Import agent identity |
| POST | `/v1/awareness/cycle` | Trigger waking cycle |
| GET | `/v1/awareness/status` | Awareness configuration status |
| POST | `/v1/cloud/sync` | Trigger cloud sync |
| GET | `/v1/cloud/sync/status` | Sync status |
| POST | `/v1/sync/push` | Push memories to cloud |
| GET | `/v1/sync/pull` | Pull memories from cloud |

### Changed Endpoints

| Endpoint | Change |
|----------|--------|
| `POST /v1/memories` | Now accepts `agentId` in body or `X-AM-Agent-ID` header |
| `POST /v1/memories/query` | Supports `poolId` filter |
| `GET /v1/health` | Expanded response with embedding health, dream cycle status, monitoring alerts |

### Removed Endpoints

None — v2 is fully backward compatible with v1 endpoints.

## Configuration Changes

### New Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `EDITION` | `local` or `cloud` | `local` |
| `EMBEDDING_PROVIDER` | `local`, `openai`, `cloud-ensemble` | `local` |
| `AWARENESS_ENABLED` | Enable awareness module | `false` |
| `GITHUB_TOKEN` | GitHub signal integration | — |
| `GITHUB_REPOS` | Repos for GitHub signals | — |
| `LINEAR_API_KEY` | Linear signal integration | — |
| `ENCRYPTION_KEY` | Cloud-link encryption (cloud edition) | — |
| `CORS_ORIGINS` | Additional CORS origins | — |
| `LOG_LEVEL` | Pino log level | `info` |

### Removed Variables

None — all v1 variables continue to work.
