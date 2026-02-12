# Contributing to Engram

Thanks for your interest in contributing to Engram! Whether it's a bug fix, new feature, documentation improvement, or just a question — we appreciate it.

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| **Node.js** | 20+ | We use pnpm as the package manager |
| **pnpm** | 9+ | `npm install -g pnpm` |
| **PostgreSQL** | 16+ | Must have the **pgvector** extension installed |
| **Rust** | Latest stable | Only needed if working on [engram-embed](https://github.com/heybeaux/engram-embed) (local embeddings) |

You'll also need at least one LLM provider configured — OpenAI is the easiest to start with, but Ollama works great for fully local development.

## Dev Environment Setup

```bash
# 1. Clone the repo
git clone https://github.com/heybeaux/engram.git
cd engram

# 2. Install dependencies
pnpm install

# 3. Set up your environment
cp .env.example .env
# Edit .env — at minimum you need:
#   DATABASE_URL (your PostgreSQL connection string)
#   LLM_PROVIDER + API key (or Ollama for local)
#   EMBEDDING_PROVIDER (openai, ollama, or local)

# 4. Set up the database
# Make sure PostgreSQL is running with pgvector:
#   CREATE EXTENSION IF NOT EXISTS vector;
pnpm prisma migrate deploy

# 5. Start the dev server
pnpm start:dev
```

The server starts at `http://localhost:3000` (or whatever `PORT` you set). Health check: `GET /v1/health` (no auth required).

### Local Embeddings (Optional)

If you want to use local embeddings instead of OpenAI:

```bash
# In a separate directory
git clone https://github.com/heybeaux/engram-embed.git
cd engram-embed
cargo run --release
# Runs on http://127.0.0.1:8080

# Then in your .env:
# EMBEDDING_PROVIDER=local
# LOCAL_EMBED_URL=http://127.0.0.1:8080
```

## Project Structure

```
src/
├── main.ts                 # Entry point
├── app.module.ts           # Root NestJS module
├── app.controller.ts       # Root controller (health, etc.)
│
├── memory/                 # Core memory CRUD, query, and extraction pipeline
├── vector/                 # Vector storage (pgvector, Pinecone)
├── llm/                    # LLM provider abstraction (OpenAI, Anthropic, Ollama, LM Studio)
├── graph/                  # Semantic memory graph (entity/relation extraction)
├── consolidation/          # Sleep consolidation & Dream Cycle pipeline
├── health/                 # /v1/health endpoint and quality metrics
│
├── ensemble/               # Multi-model embedding fusion (RRF)
├── reembedding/            # Batch re-embedding jobs
├── deduplication/          # Duplicate detection and merging
├── multi-query/            # Multi-query retrieval (synonym expansion)
├── prefetch/               # Query prefetching
├── summarization/          # Memory summarization
├── hierarchy/              # Hierarchy units
│
├── agent/                  # Agent-scoped memory (self-memories, reflection)
├── agent-session/          # Agent session management
├── session/                # User session tracking
├── user/                   # User management
├── memory-pool/            # Pool-scoped memory isolation
├── scoped-context/         # Scoped context generation
│
├── analytics/              # Usage analytics
├── monitoring/             # System monitoring and snapshots
├── fog-index/              # Fog index scoring
├── eval/                   # Eval framework (recall scenarios)
├── feedback/               # User feedback on memories
├── correction/             # Memory correction pipeline
├── rate-limit/             # Rate limiting
├── webhook/                # Webhook events
│
├── prisma/                 # Prisma service (database client)
├── config/                 # Configuration module
├── common/                 # Shared DTOs, decorators, guards
├── utils/                  # Utility functions
├── dashboard/              # Dashboard static serving
└── scripts/                # Internal scripts

prisma/
├── schema.prisma           # Database schema
└── migrations/             # Migration history

test/                       # E2E tests
tests/evaluation/           # Eval framework (recall scenarios)
docs/                       # Design docs and guides
```

## Running Tests

```bash
# Unit tests
pnpm test

# Unit tests in watch mode
pnpm test:watch

# Unit tests with coverage
pnpm test:cov

# E2E tests (requires running database)
pnpm test:e2e

# Eval framework (22 recall scenarios — requires running server + embeddings)
pnpm test:eval
```

The eval framework in `tests/evaluation/` tests semantic recall quality across temporal queries, safety-critical recall, type classification, and deduplication. See `tests/evaluation/README.md` for details.

## Code Style

### General

- **TypeScript** everywhere — strict mode, no `any` unless absolutely necessary
- **Prettier** for formatting: `pnpm format`
- **ESLint** for linting: `pnpm lint`

### NestJS Patterns

We follow standard NestJS conventions:

- One module per feature (e.g., `memory/memory.module.ts`)
- Services for business logic, controllers for HTTP
- DTOs with `class-validator` decorators for input validation
- `@nestjs/swagger` decorators on all endpoints
- Dependency injection via constructors

### Prisma Conventions

- Schema lives in `prisma/schema.prisma`
- **Never use `prisma migrate dev`** in production — use `pnpm migrate:safe` or `pnpm migrate:deploy`
- New migrations: create a SQL file in `prisma/migrations/` with a descriptive name (e.g., `20260211_add_context_token_budget`)
- All deletes should be soft-deletes (`deletedAt` timestamp)

## Pull Request Process

### Branch Naming

```
feat/short-description     # New features
fix/short-description      # Bug fixes
docs/short-description     # Documentation
refactor/short-description # Refactoring
test/short-description     # Test additions
```

### Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add webhook events for memory creation
fix: temporal parser handles "last month" correctly
docs: update API reference for dream cycle
test: add eval scenario for safety-critical recall
refactor: extract scoring logic into separate service
```

### What to Include in a PR

- **Clear description** of what changed and why
- **Tests** for new features or bug fixes
- **Updated docs** if you changed API behavior
- **Passing CI** — `pnpm lint && pnpm test` should pass
- **Small, focused PRs** are easier to review than large ones

### Review Process

1. Open a PR against `main`
2. CI runs lint + tests automatically
3. A maintainer will review (usually within a few days)
4. Address feedback, then we merge!

## Architecture Decisions

**Why NestJS?**
Structured dependency injection, module system, and decorator-based routing make it easy to organize a complex API with many feature modules. The ecosystem (Swagger, validation, testing) is mature.

**Why pgvector?**
Keeps everything in one database — no separate vector store to manage. Great performance for our scale, and it's free. Pinecone is available as an optional cloud alternative.

**Why local embeddings (engram-embed)?**
Privacy and cost. A Rust-based embedding server using `bge-base-en-v1.5` generates 768-dim embeddings in ~10ms with zero API calls. Your data never leaves your machine.

**Why type-aware memory?**
Not all memories are equal. "I'm allergic to peanuts" should never be evicted from context, while "we discussed the auth flow" can safely fade. Type classification enables safety-critical handling and intelligent decay.

## Where to Find Things

| What | Where |
|------|-------|
| API Documentation | `http://localhost:3000/v1/docs` (Swagger UI, auto-generated) |
| Dashboard | Separate repo: [engram-dashboard](https://github.com/heybeaux/engram-dashboard) |
| Health & Metrics | `GET /v1/health` (no auth) |
| Memory Graph | `http://localhost:3000/memory-graph.html` (D3 visualization) |
| Design Docs | `docs/` directory |
| Eval Results | `tests/evaluation/results/` |
| Self-Hosting Guide | `docs/SELF_HOSTING.md` |
| Changelog | `CHANGELOG.md` |
| Roadmap | `ROADMAP.md` |

## High-Impact Areas

Looking for where to start? These areas would benefit most from contributions:

- **Python SDK** — Make Engram accessible to the Python AI ecosystem
- **Integration guides** — LangChain, AutoGen, CrewAI, etc.
- **New LLM/vector providers** — See `src/llm/` and `src/vector/` for the provider pattern
- **Extraction improvements** — Better 5W1H extraction, confidence scoring
- **Eval scenarios** — More recall test cases in `tests/evaluation/`
- **Documentation** — Always welcome

## Questions?

Open an issue or start a discussion on GitHub. We're happy to help you get oriented.

---

*Every agent deserves to remember — and every contributor deserves a warm welcome.* 🧠
