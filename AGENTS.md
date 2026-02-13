# AGENTS.md — Engram Agent Entry Point

## Project
Engram is a NestJS semantic memory API for AI agents. PostgreSQL + pgvector for storage and vector search, Prisma ORM, class-validator DTOs, Jest tests. Port 3001.

## Architecture
Layered NestJS: Controllers handle HTTP, delegate to Services for business logic, which use PrismaService for data access. Cross-cutting: ApiKeyGuard for auth, ConfigService for env, shared types. Modules are self-contained in `src/{module}/` with co-located tests. See `docs/ARCHITECTURE.md` for the full domain map.

## Commands
```bash
npm test                  # 1100+ tests, 57 suites
npm run lint              # ESLint
npm run build             # Compile
npx tsc --noEmit          # Type check
npm run start:dev         # Dev server (port 3001)
npm run migrate:deploy    # Apply migrations (safe)
npm run migrate:safe      # Apply with wrapper script
```

## Critical Rules
1. **Every change needs tests** — no exceptions
2. **Migrations must be idempotent** — `IF NOT EXISTS`, `IF EXISTS`, `DROP+CREATE` for policies
3. **Never `prisma migrate dev`** in production — only `prisma migrate deploy`
4. **Every DTO field needs decorators** — `whitelist:true` strips undecorated fields silently
5. **Run `npm test` before pushing** — pre-push hook enforces this

## Where Things Are
```
src/{module}/              # Each domain module
  *.service.ts             # Business logic
  *.service.spec.ts        # Unit tests (co-located)
  *.controller.ts          # HTTP endpoints
  *.module.ts              # NestJS module definition
  *.types.ts               # Types and interfaces
  dto/                     # Request/response DTOs
src/common/guards/         # ApiKeyGuard
src/prisma/                # PrismaService (shared)
src/config/                # Configuration
prisma/schema.prisma       # Database schema
prisma/migrations/         # SQL migrations
docs/                      # Deep-dive documentation
```

## Key Modules
| Module | Purpose |
|--------|---------|
| memory | Core CRUD + semantic search |
| ensemble | Multi-model embedding + RRF fusion |
| graph | Knowledge graph extraction |
| prefetch | Predictive cache warming |
| hierarchy | Memory consolidation layers |
| deduplication | Near-duplicate detection |
| eval | Recall/latency benchmarks |
| analytics | Usage tracking |
| auto | Automatic memory observation |

## Testing Patterns
- Mock PrismaService with `{ model: { method: jest.fn() } }`
- Mock ConfigService with `{ get: jest.fn().mockReturnValue(val) }`
- `src/test-setup.ts` auto-closes TestingModules after each test
- See `docs/TESTING.md` for detailed patterns

## Auth
- `x-am-user-id` header required on most endpoints
- `ApiKeyGuard` — localhost bypasses auth
- API keys hashed with SHA-256

## Docs
- `docs/ARCHITECTURE.md` — domain map, layer rules
- `docs/TESTING.md` — test patterns, mocks
- `docs/MIGRATIONS.md` — safety rules, examples
- `docs/PATTERNS.md` — NestJS patterns, error handling
- `docs/QUALITY.md` — per-module quality grades
- `CLAUDE.md` — development rules and gotchas
