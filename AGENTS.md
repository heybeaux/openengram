# AGENTS.md — Engram

## What Is This?
Engram is a semantic memory service for AI agents. NestJS + Prisma + PostgreSQL + pgvector.

## Architecture (one-liner)
`src/{module}/` with controller/service/module/spec per module. 38 modules. Prisma ORM, pgvector for embeddings.

## Key Commands
| Command | Purpose |
|---|---|
| `npm test` | Run all 57 spec files (Jest) |
| `npm run build` | Compile (nest build) |
| `npm run lint` | ESLint with --fix |
| `npm run start:dev` | Dev server with watch |
| `npm run migrate:deploy` | Safe migration (deploy only) |

## Directory Structure
```
src/
├── app.module.ts          # Root module
├── main.ts                # Entry point
├── memory/                # Core: CRUD, embedding, recall, temporal parsing
├── prisma/                # PrismaService wrapper
├── vector/                # pgvector provider
├── ensemble/              # Multi-model RRF fusion, drift detection, nightly re-embed
├── llm/                   # LLM abstraction (OpenAI)
├── correction/            # Contradiction detection, memory superseding
├── consolidation/         # Memory merging/dedup
├── agent/                 # Agent config and profiles
├── agent-session/         # Session management
├── analytics/             # Usage analytics
├── dashboard/             # Serve static dashboard UI
├── webhook/               # Webhook delivery
├── ...                    # 25+ more modules
prisma/
├── schema.prisma
├── migrations/            # SQL migrations (idempotent!)
docs/                      # Architecture, testing, migration guides
```

## Critical Rules
1. Every change needs tests
2. Every DTO needs class-validator decorators (whitelist:true strips bare fields)
3. Migrations: `IF NOT EXISTS`, never `CREATE POLICY IF NOT EXISTS` (invalid PG)
4. **Never** `prisma migrate dev` on prod — use `migrate deploy`
5. User ID via `x-am-user-id` header

## Docs
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — module map, layer rules
- [docs/TESTING.md](docs/TESTING.md) — test patterns, mocking guide
- [docs/MIGRATIONS.md](docs/MIGRATIONS.md) — idempotency rules, safe patterns
- [CLAUDE.md](CLAUDE.md) — commands, gotchas, quick reference

## Known Gotchas
- PrefetchCacheService maxSize=0 → infinite loop
- `$queryRaw` returns BigInt for COUNT
- `CREATE POLICY IF NOT EXISTS` is invalid PostgreSQL
- `prisma migrate dev` once wiped 543 memories — blocked by premigrate:dev script
