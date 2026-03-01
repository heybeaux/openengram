# AGENTS.md

## What is Engram?

Engram is an open-source memory system for AI agents. Built with NestJS, Prisma, PostgreSQL (pgvector), and TypeScript.

## Key Directories

- `src/memory/` — Core memory CRUD, search, extraction
- `src/identity/` — Agent identity, delegation, trust
- `src/awareness/` — Waking cycle, insight generation
- `src/cloud-sync/` — Bidirectional cloud sync
- `src/graph/` — Knowledge graph
- `shared/` — Shared types and API routes
- `prisma/` — Schema and migrations

## Build & Test

```bash
npm run build          # SWC compiler, ~250ms for 558 files
npm test               # Full suite (~2000 tests)
npm test -- --testPathPattern=<pattern>  # Scoped testing
```

## ⚠️ Database Safety (CRITICAL)

- **NEVER** run `prisma migrate dev` or `prisma migrate reset`
- Use `prisma migrate deploy` **ONLY**
- Production data is live — sub-agents have wiped 2,500+ memories before

## Large Files

These files may need extra context window budget:

- `src/memory/memory.controller.ts` (~934 lines)
- `src/memory/memory-query.service.ts` (~908 lines)
- `src/memory/memory.service.ts` (~873 lines)

## Patterns

- Services use constructor dependency injection
- Controllers use decorators for auth/validation
- `userId: ''` in queries = account-wide (skips user filter)
- Embeddings via local `engram-embed` service on port 8080

## Branch Protection

PRs required for `main` and `production`. No direct push.
