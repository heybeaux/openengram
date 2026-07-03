# Database Architecture

## Overview

Engram uses **PostgreSQL** with **pgvector** for vector similarity search and **Row Level Security (RLS)** for multi-tenant data isolation. The schema is managed by Prisma ORM.

## Ownership Chain

All data traces back to an `Account` through a strict ownership hierarchy:

```
Account
 └── Agent (API consumer)
      └── User (end-user)
           ├── Memory (core entity)
           │    ├── MemoryExtraction (5W1H structured data)
           │    ├── MemoryEntity → Entity (named entity junction)
           │    ├── MemoryChainLink (reasoning chains)
           │    ├── MemoryEmbedding (multi-model vectors)
           │    ├── MemoryPoolMembership → MemoryPool (shared pools)
           │    ├── HierarchyUnit (multi-granularity embeddings)
           │    └── GraphEntityMention → GraphEntity (knowledge graph)
           ├── Project (workstream grouping)
           ├── Session (conversation grouping)
           ├── Feedback (retrieval quality signals)
           ├── GraphEntity (knowledge graph nodes)
           ├── GraphRelationship (knowledge graph edges)
           └── DedupConfig / MergeCandidate / DreamCycleReport
      └── Webhook
           └── WebhookDelivery
 └── UxFeedback (dashboard feedback)
```

**Key relationships:**
- `Account` 1→N `Agent` — Each account can have multiple agents (plan-limited)
- `Agent` 1→N `User` — Each agent manages multiple end-users
- `User` 1→N `Memory` — Core data: the memories being stored and recalled
- `Memory` 1→N `MemoryEmbedding` — One embedding per model in the ensemble (4 local, up to 3 cloud)

## Database Roles

### `postgres` (superuser)
- System-level operations only
- Not used by the application

### `engram_admin` (migration + BYPASSRLS)
- **Used by:** Manual migrations, self-hosted deployments (LAN bypass)
- **Privileges:** Full schema access, `BYPASSRLS` — skips all RLS policies
- **When active:** Self-hosted mode (no `accountId` → no RLS transaction), migration operations

### `engram_app` (RLS-enforced)
- **Used by:** Cloud/SaaS application in production
- **Privileges:** SELECT, INSERT, UPDATE, DELETE on all tables; USAGE on sequences
- **Cannot:** DROP, TRUNCATE, CREATE, ALTER (prevents accidental schema damage)
- **RLS:** All queries filtered by `current_setting('app.current_account_id', true)`

### `clawdbot` (development application role)
- **Used by:** Local development, sub-agents
- **Privileges:** Same as `engram_app` — no DDL, prevents `prisma migrate reset` accidents
- **History:** Created after two database wipe incidents from sub-agents running `prisma migrate reset`

See [DATABASE-ROLES.md](./DATABASE-ROLES.md) for operational details.

## Row Level Security (RLS)

### How It Works

1. `RlsInterceptor` wraps each authenticated request in a Prisma interactive transaction
2. Runs `SET LOCAL app.current_account_id = '<id>'` (scoped to transaction)
3. RLS policies on every table check `current_setting('app.current_account_id', true)`
4. Queries can only see/modify rows belonging to that account

### Policy Types

**Direct ownership** — Tables with `account_id` column:
- `accounts` — `id = current_setting('app.current_account_id')`
- `agents` — `account_id = current_setting('app.current_account_id')`
- `ux_feedback` — `account_id = current_setting('app.current_account_id')`

**Through agents** — Join through `agents.account_id`:
- `users` — `agent_id IN (SELECT id FROM agents WHERE account_id = ...)`

**Through users** — Join through `users.agent_id → agents.account_id`:
- `memories`, `projects`, `sessions`, `feedback`, `graph_*`, `hierarchy_units`, `dedup_*`, `dream_cycle_reports`

**Through memories** — Join through the full chain:
- `memory_extractions`, `memory_entities`, `memory_chain_links`, `memory_embeddings`, `memory_pool_memberships`

**Service-only** — `USING (false)` denies all access; only `BYPASSRLS` roles can read:
- `_prisma_migrations`, `fog_index_snapshots`, `monitoring_snapshots`, system tables

### FORCE ROW LEVEL SECURITY

All tables have `FORCE ROW LEVEL SECURITY` enabled, meaning even the table owner is subject to policies. The `engram_admin` role has `BYPASSRLS` privilege to operate normally.

See [RLS-IMPLEMENTATION.md](./RLS-IMPLEMENTATION.md) for the full implementation details.

## Core Tables

### `accounts`
The SaaS customer. Stores email, bcrypt password hash, plan, usage counters, Stripe customer ID, and password reset tokens.

### `agents`
An API consumer application. Each agent has a SHA-256 hashed API key. Belongs to an account. Soft-deleted via `deleted_at`.

### `users`
An end-user whose memories are stored. Identified by `agent_id + external_id` (unique compound). Soft-deleted.

### `memories`
The core entity. Stores raw text, layer (IDENTITY/PROJECT/SESSION/TASK), memory type classification, importance scores, subject attribution, and consolidation state. Has a legacy single `embedding` column plus the newer `memory_embeddings` relation for multi-model ensemble.

### `memory_embeddings`
Multi-model vector storage. One row per (memory, model) pair. Uses pgvector's `vector` type. Models: `bge-base`, `minilm`, `gte-base`, `nomic` (local) or `openai-small`, `openai-large`, `cohere-v3` (cloud).

### `graph_entities` / `graph_relationships` / `graph_entity_mentions`
Semantic knowledge graph. Entities (people, places, concepts) connected by typed relationships (SPOUSE_OF, WORKS_AT, etc.) with mentions linking back to source memories.

## Enums

Key enums that define the domain model:

| Enum | Values | Purpose |
|------|--------|---------|
| `Plan` | FREE, STARTER, PRO, SCALE | Account subscription tier |
| `MemoryLayer` | IDENTITY, PROJECT, SESSION, TASK | Memory scope/lifetime |
| `MemoryType` | CONSTRAINT, PREFERENCE, FACT, TASK, EVENT, LESSON | Classification with priority |
| `SubjectType` | USER, AGENT, ENTITY | Who/what the memory is about |
| `MemorySource` | EXPLICIT_STATEMENT, AGENT_OBSERVATION, CORRECTION, ... | How the memory was created |
| `GraphEntityType` | PERSON, PLACE, ORGANIZATION, CONCEPT, ... | Knowledge graph node types |
| `GraphRelationshipType` | SPOUSE_OF, WORKS_AT, CAUSED_BY, ... | Knowledge graph edge types |

## Migrations

Migrations are managed by Prisma and stored in `supabase/migrations/`. Due to past incidents:

- **Never run `prisma migrate reset`** — The application role cannot drop tables
- **Use `engram_admin` for migrations:** `DATABASE_URL=postgresql://engram_admin:...@localhost:5432/engram pnpm prisma migrate deploy`
- **Re-grant permissions** after migrations (new tables need explicit grants to `clawdbot`)

See [DATABASE-ROLES.md](./DATABASE-ROLES.md) for safe migration procedures.

## Key Files

- `prisma/schema.prisma` — Full schema definition
- `supabase/migrations/` — SQL migrations (including RLS policies)
- `src/prisma/prisma.service.ts` — Prisma client with RLS proxy
- `src/prisma/rls.interceptor.ts` — RLS transaction wrapper
- `src/prisma/rls-context.ts` — AsyncLocalStorage for transactional client

---

*This is a critical architectural document. Update it when the schema, roles, or RLS policies change.*
