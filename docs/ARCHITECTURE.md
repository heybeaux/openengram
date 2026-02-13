# Architecture

## Stack
- **Runtime**: NestJS (Node.js)
- **ORM**: Prisma
- **Database**: PostgreSQL + pgvector extension
- **Embeddings**: OpenAI, local models via ensemble system
- **Testing**: Jest

## Module Map

### Core
| Module | Purpose |
|---|---|
| `memory` | CRUD, embedding generation, recall, temporal parsing, search |
| `prisma` | PrismaService singleton (wraps @prisma/client) |
| `vector` | pgvector provider for similarity search |
| `llm` | LLM abstraction layer (OpenAI, structured output) |

### Intelligence
| Module | Purpose |
|---|---|
| `ensemble` | Multi-model RRF fusion, drift detection, nightly re-embed, model registry |
| `correction` | Contradiction detection, memory superseding chains |
| `consolidation` | Merge duplicate/related memories |
| `deduplication` | Exact/near-duplicate detection |
| `clustering` | Memory clustering |
| `hierarchy` | Hierarchical memory organization |
| `summarization` | Memory summarization |
| `fog-index` | Memory fog/decay scoring |
| `reembedding` | Re-embed memories with updated models |

### Access & Context
| Module | Purpose |
|---|---|
| `scoped-context` | Context scoping for recall |
| `multi-query` | Multi-query retrieval |
| `prefetch` | Predictive cache (⚠️ maxSize=0 bug) |
| `memory-access-log` | Track memory access patterns |
| `memory-pool` | Memory pooling |
| `graph` | Relationship graph between memories |

### Platform
| Module | Purpose |
|---|---|
| `agent` | Agent profiles and config |
| `agent-session` | Session management |
| `session` | Session utilities |
| `user` | User management |
| `project` | Multi-project support |
| `config` | App configuration |
| `common` | Shared decorators, pipes, guards |
| `utils` | Utility functions |

### Ops
| Module | Purpose |
|---|---|
| `analytics` | Usage analytics |
| `monitoring` | Health/perf monitoring snapshots |
| `health` | Health check endpoints |
| `dashboard` | Static dashboard UI |
| `webhook` | Webhook delivery |
| `rate-limit` | Rate limiting |
| `eval` | Evaluation framework |
| `feedback` | User feedback on recall quality |
| `auto` | Automated maintenance tasks |

## Layer Rules
1. **Controllers** handle HTTP, validate DTOs, delegate to services
2. **Services** contain business logic, call Prisma/providers
3. **Providers** wrap external systems (pgvector, OpenAI)
4. Controllers never call Prisma directly
5. Services don't import from other module's internals — use NestJS DI

## Entry Point
`src/main.ts` → `src/app.module.ts` imports all feature modules.
