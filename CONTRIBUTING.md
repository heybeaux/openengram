# Contributing to Engram

Thanks for wanting to help build memory infrastructure for AI agents. Seriously.

Engram is built by a small team (currently a solo developer + an AI agent), so every contribution matters — from typo fixes to new LLM providers.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Local Development Setup](#local-development-setup)
  - [Environment Configuration](#environment-configuration)
  - [Running with Docker](#running-with-docker)
  - [Fully Local (No Cloud APIs)](#fully-local-no-cloud-apis)
- [Architecture Overview](#architecture-overview)
  - [Project Structure](#project-structure)
  - [Module System](#module-system)
  - [Key Concepts](#key-concepts)
  - [Request Flow](#request-flow)
  - [Provider Architecture](#provider-architecture)
- [Development Workflow](#development-workflow)
  - [Branching](#branching)
  - [Making Changes](#making-changes)
  - [Commit Messages](#commit-messages)
  - [Pull Requests](#pull-requests)
- [Code Style & Conventions](#code-style--conventions)
  - [TypeScript](#typescript)
  - [Formatting](#formatting)
  - [Naming Conventions](#naming-conventions)
  - [Logging](#logging)
  - [Error Handling](#error-handling)
- [Testing](#testing)
  - [Unit Tests](#unit-tests)
  - [End-to-End Tests](#end-to-end-tests)
  - [Writing Good Tests](#writing-good-tests)
- [Database & Migrations](#database--migrations)
- [Adding New Providers](#adding-new-providers)
  - [LLM Providers](#llm-providers)
  - [Vector Providers](#vector-providers)
- [Reporting Issues](#reporting-issues)
  - [Bug Reports](#bug-reports)
  - [Feature Requests](#feature-requests)
  - [Security Vulnerabilities](#security-vulnerabilities)
- [What We're Looking For](#what-were-looking-for)
- [License](#license)

---

## Code of Conduct

By participating in this project, you agree to abide by our standards of respectful, constructive collaboration. Be kind, be helpful, and assume good intent. We're all here to make agents smarter.

---

## Getting Started

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| **Node.js** | 20+ | Required for NestJS and ES2023 target |
| **pnpm** | 8+ | Package manager (we don't use npm or yarn) |
| **PostgreSQL** | 15+ | With the [pgvector](https://github.com/pgvector/pgvector) extension |
| **Git** | 2.x | For version control |

Optional:
- **Docker** & **Docker Compose** — for containerized development
- **Ollama** or **LM Studio** — for fully local LLM development (no cloud API keys needed)

### Local Development Setup

```bash
# 1. Fork and clone
git clone https://github.com/YOUR_USERNAME/engram.git
cd engram

# 2. Install dependencies
pnpm install

# 3. Set up your environment
cp .env.example .env
# Edit .env — see "Environment Configuration" below

# 4. Start PostgreSQL (if not already running)
# macOS:
brew services start postgresql@16

# Or with Docker (recommended):
docker compose up -d postgres

# 5. Enable pgvector extension (if using local PostgreSQL)
psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS vector;"

# 6. Run database migrations
pnpm prisma migrate dev

# 7. Generate Prisma client
pnpm prisma generate

# 8. Start the dev server (hot-reload)
pnpm start:dev
```

The server starts at `http://localhost:3000` (or the port in your `.env`). Verify it's running:

```bash
curl http://localhost:3000/v1/health
```

### Environment Configuration

Copy `.env.example` to `.env` and configure. Here are the key settings:

```bash
# Database (required)
DATABASE_URL="postgresql://user:password@localhost:5432/engram?schema=public"

# Vector provider (default: pgvector — runs in your PostgreSQL)
VECTOR_PROVIDER="pgvector"

# LLM provider — choose one:
LLM_PROVIDER="openai"       # or: anthropic, ollama, lmstudio
LLM_MODEL="gpt-4o-mini"     # model name for your provider

# Embedding provider
EMBEDDING_PROVIDER="openai"  # or: ollama (Anthropic doesn't support embeddings)

# API keys (only for cloud providers)
OPENAI_API_KEY="sk-..."
ANTHROPIC_API_KEY="sk-ant-..."

# Server
PORT=3000
NODE_ENV=development
```

**Example configurations:**

| Setup | LLM_PROVIDER | EMBEDDING_PROVIDER | Notes |
|-------|-------------|-------------------|-------|
| Cloud (OpenAI) | `openai` | `openai` | Easiest to start with |
| Hybrid | `anthropic` | `openai` | Claude for chat, OpenAI for embeddings |
| Fully Local | `ollama` | `ollama` | Zero data leaves your machine |
| LM Studio | `lmstudio` | `lmstudio` | GUI-based local models |

### Running with Docker

```bash
# Start everything (Engram + PostgreSQL)
docker compose up -d

# Or just the database (develop locally)
docker compose up -d postgres
```

The Docker setup uses `pgvector/pgvector:pg16` for PostgreSQL with vector support built in.

### Fully Local (No Cloud APIs)

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull required models
ollama pull llama3.2           # For chat/extraction
ollama pull nomic-embed-text   # For embeddings

# Configure .env
LLM_PROVIDER=ollama
LLM_MODEL=llama3.2
EMBEDDING_PROVIDER=ollama
VECTOR_PROVIDER=pgvector
```

---

## Architecture Overview

Engram is a [NestJS](https://nestjs.com/) application written in TypeScript. It uses Prisma for database access, pgvector for embeddings storage (with optional Pinecone), and supports pluggable LLM providers.

### Project Structure

```
engram/
├── src/
│   ├── main.ts                    # Application bootstrap
│   ├── app.module.ts              # Root module (imports all feature modules)
│   ├── app.controller.ts          # Health check endpoint
│   │
│   ├── common/                    # Shared infrastructure
│   │   ├── guards/
│   │   │   └── api-key.guard.ts   # API key authentication (X-AM-API-Key)
│   │   └── decorators/
│   │       └── user-id.decorator.ts  # @UserId() parameter decorator
│   │
│   ├── memory/                    # Core memory engine (the heart of Engram)
│   │   ├── memory.module.ts       # Module definition
│   │   ├── memory.controller.ts   # REST endpoints (/v1/memories, /v1/context, etc.)
│   │   ├── memory.service.ts      # Main business logic (remember, recall, context)
│   │   ├── extraction.service.ts  # 5W1H extraction via LLM
│   │   ├── embedding.service.ts   # Vector embedding generation & search
│   │   ├── importance.service.ts  # Importance scoring (effectiveScore)
│   │   ├── consolidation.service.ts  # Sleep consolidation (dedup & promote)
│   │   ├── backfill.service.ts    # Backfill scripts for existing data
│   │   ├── dto/                   # Request/response DTOs (class-validator)
│   │   │   ├── create-memory.dto.ts
│   │   │   ├── query-memory.dto.ts
│   │   │   └── update-memory.dto.ts
│   │   ├── temporal/              # Temporal query parsing
│   │   │   └── temporal-parser.service.ts  # "yesterday", "last week", etc.
│   │   └── intelligence/          # Memory Intelligence v2
│   │       ├── safety-detector.service.ts   # Safety-critical pattern matching
│   │       └── importance-scorer.service.ts # effectiveScore computation
│   │
│   ├── auto/                      # Automatic memory capture
│   │   ├── auto.module.ts
│   │   ├── auto.controller.ts     # POST /v1/observe
│   │   ├── conversation-observer.service.ts  # Conversation analysis
│   │   ├── auto-extractor.service.ts         # Auto-extraction pipeline
│   │   └── importance-detector.service.ts    # Signal detection
│   │
│   ├── agent/                     # Agent self-reflection
│   │   ├── agent.module.ts
│   │   ├── agent.controller.ts    # POST /v1/agents/:id/reflect
│   │   ├── agent.service.ts       # Self-reflection logic
│   │   └── reflection.prompts.ts  # LLM prompts for reflection
│   │
│   ├── dashboard/                 # Dashboard API
│   │   ├── dashboard.module.ts
│   │   ├── dashboard.controller.ts
│   │   └── dashboard.service.ts
│   │
│   ├── llm/                       # LLM provider abstraction
│   │   ├── llm.module.ts
│   │   ├── llm.service.ts         # Provider router
│   │   ├── llm.interface.ts       # LLMProvider interface
│   │   └── providers/
│   │       ├── openai.provider.ts
│   │       ├── anthropic.provider.ts
│   │       ├── ollama.provider.ts
│   │       └── lmstudio.provider.ts
│   │
│   ├── vector/                    # Vector storage abstraction
│   │   ├── vector.module.ts
│   │   ├── vector.service.ts      # Provider router
│   │   ├── vector.interface.ts    # VectorProvider interface
│   │   └── providers/
│   │       ├── pgvector.provider.ts
│   │       └── pinecone.provider.ts
│   │
│   ├── prisma/                    # Database client
│   │   ├── prisma.module.ts
│   │   └── prisma.service.ts
│   │
│   └── utils/
│       └── date-parser.ts         # Flexible date parsing utility
│
├── prisma/
│   ├── schema.prisma              # Database schema (source of truth)
│   └── migrations/                # Migration history
│
├── test/                          # End-to-end tests
│   ├── jest-e2e.json
│   ├── app.e2e-spec.ts
│   ├── memory.e2e-spec.ts
│   └── agent-self-memory.e2e-spec.ts
│
├── scripts/                       # Utility scripts (backfill, debugging)
├── docs/                          # Design documents and guides
├── public/                        # Static files (graph visualization)
└── docker-compose.yml
```

### Module System

Engram follows NestJS module architecture. Each feature is a self-contained module:

| Module | Purpose | Key Services |
|--------|---------|-------------|
| `MemoryModule` | Core memory CRUD, search, context loading | `MemoryService`, `ExtractionService`, `EmbeddingService`, `ImportanceService`, `ConsolidationService`, `TemporalParserService` |
| `AutoModule` | Automatic memory capture from conversations | `ConversationObserverService`, `AutoExtractorService` |
| `AgentModule` | Agent self-reflection and self-memories | `AgentService` |
| `LLMModule` | LLM provider abstraction | `LLMService` + provider implementations |
| `VectorModule` | Vector storage abstraction | `VectorService` + provider implementations |
| `DashboardModule` | Dashboard data endpoints | `DashboardService` |
| `PrismaModule` | Database access | `PrismaService` |

### Key Concepts

Understanding these concepts will help you navigate the codebase:

**Memory Layers** — Where a memory lives in the hierarchy:
- `IDENTITY` — Core user facts (no decay, e.g., "allergic to peanuts")
- `PROJECT` — Work context (60-day half-life)
- `SESSION` — Conversation context (14-day half-life)
- `TASK` — Active todos (3-day half-life)

**Memory Types** — What kind of information:
- `CONSTRAINT` — Safety-critical, never evicted (priority 1)
- `PREFERENCE` — User preferences (priority 2)
- `TASK` — Action items (priority 2)
- `FACT` — Stable facts (priority 3)
- `EVENT` — Temporal events (priority 4)

**effectiveScore** — The unified ranking score:
```
effectiveScore = max(safetyFloor, (baseScore × decayFactor) + noveltyBoost + usageBoost + pinnedBoost)
```

**5W1H Extraction** — Every memory is parsed into structured fields:
- Who, What, When, Where, Why, How + Topics + Entities
- Each field has a confidence score (0.0–1.0)

**Safety-Critical Detection** — 16 regex patterns detect medical/safety information. Safety-critical memories get a score floor of 0.6 and are never evicted from context.

**Temporal Parsing** — Queries like "what happened yesterday?" are parsed into time ranges. Time is the primary filter; semantic similarity is secondary.

### Request Flow

Here's what happens when a memory is created (`POST /v1/memories`):

```
Client → ApiKeyGuard (auth) → MemoryController.remember()
  → MemoryService.remember()
    1. Fetch user info for extraction context
    2. Check for duplicates (semantic dedup at 0.90 similarity)
    3. If duplicate: reinforce existing memory, return
    4. Calculate importance score
    5. Classify layer (if not explicitly set)
    6. Create memory record in PostgreSQL
    7. Async: Extract 5W1H structure via LLM
    8. Async: Generate embedding vector
    9. Async: Store in vector database
   10. Async: Link to related memories (0.65–0.90 similarity)
   11. Async: Store extracted entities
```

### Provider Architecture

LLM and vector storage use the **provider pattern**. Each provider implements a common interface:

- **LLM**: `LLMProvider` interface in `src/llm/llm.interface.ts`
  - Methods: `chat()`, `json()`, `embed()`, `supportsEmbeddings()`
  - Implementations: OpenAI, Anthropic, Ollama, LM Studio

- **Vector**: `VectorProvider` interface in `src/vector/vector.interface.ts`
  - Methods: `upsert()`, `search()`, `delete()`, `deleteByUser()`
  - Implementations: pgvector, Pinecone

---

## Development Workflow

### Branching

Branch from `main`. Use descriptive prefixes:

```bash
git checkout -b feat/cohere-embedding-provider
git checkout -b fix/temporal-parser-handles-last-2-weeks
git checkout -b docs/langchain-integration-guide
git checkout -b test/consolidation-edge-cases
git checkout -b refactor/extract-scoring-logic
```

### Making Changes

1. **Pick something** — Check [open issues](https://github.com/heybeaux/engram/issues) or scratch your own itch. Issues tagged [`good-first-issue`](https://github.com/heybeaux/engram/labels/good-first-issue) are scoped and well-described.

2. **Discuss big changes first** — If it's a new feature, architecture change, or could be controversial, open an issue to discuss the approach before writing code.

3. **Code** — Follow the style guide below. Add tests. Run the linter.

4. **Verify** — Run the full test suite and make sure everything passes:
   ```bash
   pnpm lint
   pnpm test
   pnpm test:e2e   # if you changed API behavior
   pnpm build       # make sure it compiles
   ```

### Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <description>

[optional body]

[optional footer(s)]
```

**Types:**

| Type | When |
|------|------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `chore` | Build, tooling, or dependency changes |
| `ci` | CI/CD pipeline changes |

**Examples:**

```
feat: add Cohere embedding provider
fix: temporal parser handles "last 2 weeks" correctly
docs: add LangChain integration guide
test: add consolidation edge case for overlapping clusters
refactor(memory): extract scoring logic into ImportanceScorerService
perf: batch entity upserts in extractAndEmbed
chore: upgrade Prisma to 6.x
```

### Pull Requests

1. **Fill out the PR template** — it's there for a reason.
2. **Link the issue** — `Fixes #123` or `Closes #123` in the PR description.
3. **Keep PRs focused** — One feature or fix per PR. Easier to review, easier to revert.
4. **Self-review** — Read your own diff before requesting review.
5. **Be responsive** — We review everything and may ask for changes.
6. **Tests are required** — New features need tests. Bug fixes need regression tests.

**PR checklist (from the template):**

- [ ] Code follows the project's style guidelines
- [ ] Self-reviewed my own code
- [ ] Complex areas are commented
- [ ] Documentation updated (if needed)
- [ ] No new warnings introduced
- [ ] Tests added for new functionality
- [ ] All tests pass

---

## Code Style & Conventions

### TypeScript

- **Strict null checks are enabled** (`strictNullChecks: true` in tsconfig)
- **Target ES2023** — Use modern JS features (optional chaining, nullish coalescing, etc.)
- **Module system**: `nodenext` (CommonJS-compatible in NestJS context)
- **Decorators**: NestJS uses experimental decorators (`emitDecoratorMetadata: true`)
- **Avoid `any`** — The ESLint rule is set to `off` (not `error`) for pragmatic reasons, but prefer proper types. Use `any` only when interfacing with untyped APIs.
- **Use DTOs with class-validator** for all request/response types

### Formatting

We use **Prettier** with the following config (`.prettierrc`):

```json
{
  "singleQuote": true,
  "trailingComma": "all"
}
```

Run the formatter:

```bash
pnpm format          # Auto-format src/ and test/
pnpm lint            # ESLint with auto-fix
```

**ESLint** is configured with:
- `@typescript-eslint/recommended` (type-checked)
- `eslint-plugin-prettier` (Prettier integration)
- `@typescript-eslint/no-floating-promises: warn` — don't forget to `await` promises
- `@typescript-eslint/no-unsafe-argument: warn`

### Naming Conventions

| Thing | Convention | Example |
|-------|-----------|---------|
| Files | `kebab-case` | `temporal-parser.service.ts` |
| Classes | `PascalCase` | `TemporalParserService` |
| Interfaces | `PascalCase` | `LLMProvider`, `VectorSearchResult` |
| Methods | `camelCase` | `detectSafetyCritical()` |
| Constants | `UPPER_SNAKE_CASE` | `DEDUP_SIMILARITY_THRESHOLD` |
| Test files | `*.spec.ts` (unit), `*.e2e-spec.ts` (e2e) | `memory.service.spec.ts` |
| DTOs | `PascalCase` with `Dto` suffix | `CreateMemoryDto` |
| Modules | `PascalCase` with `Module` suffix | `MemoryModule` |
| Controllers | `PascalCase` with `Controller` suffix | `MemoryController` |
| Services | `PascalCase` with `Service` suffix | `ExtractionService` |
| Guards | `PascalCase` with `Guard` suffix | `ApiKeyGuard` |

### Logging

Use the `[Module] Action: { context }` format for structured, searchable logs:

```typescript
// Good
console.log('[Memory] Extraction result:', { memoryId, memoryType, topicCount: topics.length });
console.log('[Memory] Smart layer classification:', { rawPreview: raw.substring(0, 50), layer });
console.error('[Memory] Re-extraction failed for', memoryId, ':', err);

// Bad
console.log('done');
console.log(memory);
```

### Error Handling

- **Fail open for non-critical paths** (e.g., duplicate check failure → allow creation)
- **Throw for critical paths** (e.g., missing required fields, auth failures)
- **Use NestJS exceptions** (`UnauthorizedException`, `NotFoundException`, etc.)
- **Log errors with context** — include the memory ID, user ID, or operation name
- **Don't swallow errors silently** — at minimum, `console.error()` with context

### General Principles

- Prefer clarity over cleverness
- Keep functions focused — if it's doing too much, split it
- Document non-obvious decisions with comments (the *why*, not the *what*)
- Use descriptive variable names (`constraintReserve` not `cr`)

---

## Testing

### Unit Tests

Unit tests live alongside the source files as `*.spec.ts`:

```bash
# Run all unit tests
pnpm test

# Run a specific test file
pnpm test -- extraction.service.spec
pnpm test -- safety-detector.service.spec
pnpm test -- temporal-parser.service.spec

# Run with coverage
pnpm test:cov

# Run in watch mode (great during development)
pnpm test:watch

# Debug tests
pnpm test:debug
```

**Existing test files** (good examples to follow):

| Test | Covers |
|------|--------|
| `memory.service.spec.ts` | Core memory CRUD, dedup, reinforcement |
| `extraction.service.spec.ts` | 5W1H extraction pipeline |
| `embedding.service.spec.ts` | Vector embedding generation |
| `importance.service.spec.ts` | Importance score calculation |
| `consolidation.service.spec.ts` | Sleep consolidation logic |
| `backfill.service.spec.ts` | Backfill processing |
| `safety-detector.service.spec.ts` | Safety-critical pattern matching |
| `importance-scorer.service.spec.ts` | effectiveScore computation |
| `temporal-parser.service.spec.ts` | Temporal expression parsing |
| `api-key.guard.spec.ts` | API key authentication |
| `llm.service.spec.ts` | LLM provider routing |
| `vector.service.spec.ts` | Vector storage routing |
| `pgvector.provider.spec.ts` | pgvector implementation |
| `date-parser.spec.ts` | Date parsing utilities |
| `agent.service.spec.ts` | Agent self-reflection |

### End-to-End Tests

E2E tests live in `test/` and test the full HTTP request pipeline:

```bash
# Run e2e tests
pnpm test:e2e
```

E2E tests use `@nestjs/testing` to bootstrap the full application and `supertest` for HTTP assertions. The e2e config is in `test/jest-e2e.json`.

**Existing e2e tests:**
- `app.e2e-spec.ts` — Basic app health checks
- `memory.e2e-spec.ts` — Full memory CRUD + search pipeline
- `agent-self-memory.e2e-spec.ts` — Agent self-reflection flow

### Writing Good Tests

```typescript
// Use descriptive test names
describe('SafetyDetectorService', () => {
  describe('detectSafetyCritical', () => {
    it('should detect allergy mentions as safety-critical', () => { ... });
    it('should not flag non-medical content', () => { ... });
    it('should return multiple indicators for combined safety info', () => { ... });
  });
});

// Test edge cases
it('should handle empty strings gracefully', () => { ... });
it('should handle unicode characters in memory content', () => { ... });

// Mock external dependencies (LLM calls, database)
const mockLlmService = {
  json: jest.fn().mockResolvedValue({ who: 'Beaux', what: 'prefers dark mode' }),
};
```

**Guidelines:**
- Every new feature needs tests
- Bug fixes need regression tests (prove the bug existed, prove it's fixed)
- Mock LLM calls — don't make real API calls in tests
- Test the public API of services, not internal implementation details
- Use `beforeEach` for test setup, keep individual tests focused

---

## Database & Migrations

The database schema is defined in `prisma/schema.prisma`. This is the source of truth.

```bash
# Create a new migration after modifying schema.prisma
pnpm prisma migrate dev --name describe_your_change

# Apply migrations (production)
pnpm prisma migrate deploy

# Reset database (WARNING: destroys data)
pnpm prisma migrate reset

# Open Prisma Studio (database browser)
pnpm prisma studio

# Regenerate the Prisma client
pnpm prisma generate
```

**Key models in the schema:**

| Model | Purpose |
|-------|---------|
| `Agent` | API consumer (the AI agent application) |
| `User` | End-user whose memories are stored |
| `Memory` | A single memory record |
| `MemoryExtraction` | 5W1H structured extraction for a memory |
| `Entity` | Named entity (person, place, tool, etc.) |
| `MemoryEntity` | Many-to-many link between memories and entities |
| `MemoryChainLink` | Links between memories (RELATED, CONTRADICTS, etc.) |
| `Session` | Conversation session grouping |
| `Project` | Workstream/context bucket |

**When modifying the schema:**
- Always create a migration (don't modify production DBs manually)
- Keep migrations backward-compatible when possible
- Update relevant DTOs and service code
- Add or update tests for schema changes

---

## Adding New Providers

### LLM Providers

To add a new LLM provider (e.g., Cohere, Mistral):

1. **Create the provider** in `src/llm/providers/`:

```typescript
// src/llm/providers/cohere.provider.ts
import { LLMProvider, LLMMessage, LLMResponse, LLMConfig, EmbeddingResponse } from '../llm.interface';

export class CohereProvider implements LLMProvider {
  readonly name = 'cohere';

  async chat(messages: LLMMessage[], options?: Partial<LLMConfig>): Promise<LLMResponse> {
    // Implement Cohere chat API
  }

  async json<T>(messages: LLMMessage[], schema?: object, options?: Partial<LLMConfig>): Promise<T> {
    // Implement structured JSON output
  }

  async embed(text: string): Promise<EmbeddingResponse> {
    // Implement Cohere embeddings
  }

  supportsEmbeddings(): boolean {
    return true;
  }
}
```

2. **Register it** in `src/llm/llm.module.ts` and `src/llm/llm.service.ts`
3. **Add the config** to `.env.example` (API key, base URL, etc.)
4. **Update docs** — add to the LLM providers table in README.md and `docs/PROVIDERS.md`
5. **Write tests** in `src/llm/providers/cohere.provider.spec.ts`
6. **Update the type union** in `LLMConfig` interface if needed

### Vector Providers

To add a new vector provider (e.g., Qdrant, Weaviate):

1. **Create the provider** in `src/vector/providers/`:

```typescript
// src/vector/providers/qdrant.provider.ts
import { VectorProvider, VectorRecord, VectorSearchResult, VectorSearchOptions } from '../vector.interface';

export class QdrantProvider implements VectorProvider {
  readonly name = 'qdrant';

  async upsert(record: VectorRecord): Promise<void> { ... }
  async upsertMany(records: VectorRecord[]): Promise<void> { ... }
  async search(embedding: number[], options: VectorSearchOptions): Promise<VectorSearchResult[]> { ... }
  async delete(id: string): Promise<void> { ... }
  async deleteByUser(userId: string): Promise<void> { ... }
  isConfigured(): boolean { ... }
}
```

2. **Register it** in `src/vector/vector.module.ts` and `src/vector/vector.service.ts`
3. **Add config** to `.env.example`
4. **Write tests** — follow `pgvector.provider.spec.ts` as an example
5. **Update docs**

---

## Reporting Issues

### Bug Reports

Use the [Bug Report template](https://github.com/heybeaux/engram/issues/new?template=bug_report.md). Include:

- **Clear description** of what's broken
- **Steps to reproduce** — minimal and reliable
- **Expected vs. actual behavior**
- **Environment** — Engram version, Node.js version, PostgreSQL version, OS, LLM/vector provider

**Good bug report example:**

> **Title:** Temporal parser fails on "last 2 weeks"
>
> **Steps:** Call `POST /v1/memories/query` with `{"query": "what happened in the last 2 weeks?"}`
>
> **Expected:** Returns memories from the past 14 days
>
> **Actual:** Returns an empty result set. Temporal filter start date is `Invalid Date`.
>
> **Environment:** Engram 0.0.1, Node 20.11, macOS 14.2

### Feature Requests

Use the [Feature Request template](https://github.com/heybeaux/engram/issues/new?template=feature_request.md). Describe:

- The problem you're trying to solve
- Your proposed solution
- Alternatives you've considered

### Security Vulnerabilities

**Do NOT open a public GitHub issue.** Email [security@engram.ai](mailto:security@engram.ai) with details. See [SECURITY.md](./SECURITY.md) for our full security policy, response timeline, and what qualifies.

---

## What We're Looking For

### Good First Issues

Look for issues tagged [`good-first-issue`](https://github.com/heybeaux/engram/labels/good-first-issue). These are scoped, well-described, and don't require deep context.

### High-Impact Areas

| Area | Description | Difficulty |
|------|-------------|-----------|
| **Python SDK** | We only have TypeScript. A Python client would unlock a huge audience. | Medium |
| **Integration guides** | LangChain, AutoGen, CrewAI, Haystack | Easy–Medium |
| **New LLM providers** | Cohere, Mistral, Google Gemini | Medium |
| **New vector providers** | Qdrant, Weaviate, Milvus | Medium |
| **Extraction improvements** | Better prompts, multi-language support, confidence calibration | Medium–Hard |
| **Documentation** | Always welcome. Typo fixes to full guides. | Easy |
| **Tests** | We have good coverage but always want more edge cases. | Easy |
| **Performance** | Optimization for large memory sets (10k+) | Hard |
| **Benchmarking** | Extraction quality across different LLMs | Medium |
| **Dashboard UI** | The dashboard lives in a [separate repo](https://github.com/heybeaux/engram-dashboard) | Medium |

### Things We'd Especially Love

- Memory deduplication edge cases
- Multi-language extraction prompts
- Webhook event system (memory created, contradiction detected)
- Batch import/export tools

---

## License

By contributing to Engram, you agree that your contributions will be licensed under the [Apache License 2.0](./LICENSE).

---

*Questions? Open an issue or reach out to [@heybeaux](https://github.com/heybeaux).*

*Every agent deserves to remember.*

---

## ⚠️ Database Safety

> **On 2026-02-05, a sub-agent ran `prisma migrate dev` and wiped 543 memories from the production Engram database. The data was unrecoverable — no backups existed.**

### Rules

1. **NEVER run `prisma migrate dev` on a database with real data.** It resets the database, dropping all tables and recreating them from scratch. All data is lost.

2. **Use `prisma migrate deploy`** to apply migrations to existing databases with real data. This applies pending migrations without resetting.

3. **Always run `scripts/pre-migrate.sh` before any migration** to create a safety backup:
   ```bash
   ./scripts/pre-migrate.sh && npx prisma migrate deploy
   ```

4. **`prisma migrate dev` is ONLY safe** on:
   - A fresh, empty database
   - A local development database you're willing to lose
   - Never on staging, production, or any database with real memories

### Backup & Restore

```bash
# Manual backup
./scripts/backup.sh

# Restore from backup
gunzip -c backups/engram_backup_YYYY-MM-DD_HHMMSS.sql.gz | psql -U clawdbot -h localhost engram
```

Backups are stored in `backups/` and retained for 30 days.
