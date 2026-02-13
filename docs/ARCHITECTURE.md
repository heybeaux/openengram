# Architecture

## Overview
Engram is a NestJS monolith with ~30 domain modules. Each module follows the NestJS pattern: Module → Controller → Service → PrismaService. PostgreSQL with pgvector handles both relational data and vector similarity search.

## Domain Map

### Core Memory
- **memory** — CRUD, semantic search, extraction, embedding, importance scoring, temporal parsing
- **session** — Conversation session tracking
- **agent** / **agent-session** — Agent identity and session management
- **user** — User management

### Intelligence
- **ensemble** — Multi-model embeddings with RRF (Reciprocal Rank Fusion) for retrieval
- **graph** — Knowledge graph extraction from memories
- **hierarchy** — Memory consolidation across layers (session → core → archetype)
- **consolidation** — Merges redundant memories
- **deduplication** — Near-duplicate detection (MinHash, semantic similarity)
- **clustering** — Groups related memories

### Retrieval
- **vector** — pgvector operations, embedding storage
- **multi-query** — Query expansion for better recall
- **prefetch** — Predictive cache warming
- **scoped-context** — Context window management
- **memory-pool** — Shared memory pools across agents

### Operations
- **eval** — Recall and latency benchmarks
- **analytics** — Usage metrics
- **monitoring** — Health and performance
- **fog-index** — Readability scoring
- **reembedding** — Background re-embedding with new models

### Infrastructure
- **prisma** — Database client (shared singleton)
- **config** — Environment configuration
- **common** — Guards (ApiKeyGuard), shared utilities
- **llm** — LLM provider abstraction (OpenAI)
- **rate-limit** — Request throttling
- **webhook** — Event notifications
- **health** — Health check endpoints

## Layer Rules
```
Controller  →  Service  →  PrismaService
     ↓             ↓
   DTOs        Types/Interfaces
```

- **Controllers**: HTTP only. Validate input (DTOs + ValidationPipe), call service, return response.
- **Services**: All business logic. May call other services. Never import controllers.
- **PrismaService**: Data access only. Injected into services, never into controllers directly.
- **DTOs**: Request/response shapes with class-validator decorators. Always in `dto/` subdirectory.

## Dependency Direction
Dependencies flow downward only:
1. Types/Interfaces (no dependencies)
2. Config
3. Repository layer (PrismaService)
4. Service layer
5. Controller layer

Cross-module dependencies: Import the **module**, inject the **service**. Never reach into another module's internals.

## Database
- PostgreSQL 16 with pgvector extension
- Prisma ORM with raw SQL for vector operations
- Schema: `prisma/schema.prisma`
- Migrations: `prisma/migrations/` (must be idempotent)
