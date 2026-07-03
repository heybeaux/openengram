<p align="center">
  <h1 align="center">engram-code</h1>
  <p align="center"><strong>Semantic code search for AI agents.</strong></p>
  <p align="center">
    <strong>Ecosystem:</strong>&nbsp;
    <a href="https://github.com/heybeaux/engram">Memory API</a> •
    <a href="https://github.com/heybeaux/engram-dashboard">Dashboard</a> •
    <a href="https://github.com/heybeaux/engram-embed">Local Embeddings</a> •
    <b>Code Search</b>
  </p>
</p>

Ingest your codebase, search it semantically. Built for AI agents that need to understand and navigate code.

---

## Why engram-code?

AI agents need to find relevant code — not by filename, but by meaning:

```
"where is CRUD/FLS checked"           → Apex classes with security checks
"authentication and authorization"     → Auth-related classes/methods
"trigger handlers for Account"         → Account trigger implementations
"DML operations without checks"        → Potential security issues
```

**Traditional search:** Grep, exact matches, regex patterns  
**engram-code:** Natural language queries, semantic understanding, multi-model ensemble

## Prerequisites

engram-code is a NestJS service that depends on two external components you need to provision before running it:

- **PostgreSQL 14+ with the [pgvector](https://github.com/pgvector/pgvector) extension** — stores code chunks and their embeddings.
- **[engram-embed](https://github.com/heybeaux/engram-embed) running on port 8080** — generates embeddings for ingestion and search. engram-code calls it over HTTP for every chunk and query.
- **Node.js 20+** and **pnpm**.

You do **not** need the [engram](https://github.com/heybeaux/engram) memory API to run engram-code — it's a sibling service in the ecosystem, not a dependency.

## Quick Start

```bash
# Clone
git clone https://github.com/heybeaux/engram-code
cd engram-code

# Install dependencies
pnpm install

# Configure
cp .env.example .env
# Edit DATABASE_URL and ENGRAM_EMBED_URL

# Database setup
pnpm prisma generate
pnpm prisma migrate dev

# Run
pnpm start:dev
```

Server starts at `http://localhost:3002`.

### Dashboard

A browsable UI for the v1 API lives in [`apps/dashboard/`](apps/dashboard) —
Next.js 15, App Router, runs on port `3001`.

```bash
pnpm --filter dashboard dev      # http://localhost:3001
```

See [`apps/dashboard/README.md`](apps/dashboard/README.md) for `EC_API_URL`
config and the Vercel deploy steps.

### Register a Project

```bash
curl -X POST http://localhost:3002/v1/projects \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-salesforce-app",
    "rootPath": "/Users/dev/salesforce/my-app",
    "languages": ["apex", "lwc", "typescript"]
  }'
```

### Ingest Code

```bash
# Ingest all files in the project
curl -X POST http://localhost:3002/v1/projects/{projectId}/ingest

# Response
{
  "success": true,
  "stats": {
    "filesProcessed": 142,
    "chunksCreated": 856,
    "chunksStored": 856,
    "duration": 12340
  }
}
```

### Search

```bash
# Basic semantic search
curl -X POST http://localhost:3002/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query": "where is CRUD/FLS checked"}'

# Ensemble search (multi-model, better recall)
curl -X POST http://localhost:3002/v1/search/ensemble \
  -H "Content-Type: application/json" \
  -d '{
    "query": "authentication logic",
    "models": ["bge-base", "nomic"]
  }'
```

## Architecture

```
                                    ┌─────────────────┐
                                    │  engram-embed   │
                                    │  (Rust, local)  │
                                    │                 │
                                    │  bge-base (768) │
                                    │  nomic (768)    │
                                    │  minilm (384)   │
                                    └────────▲────────┘
                                             │ embeddings
┌──────────────┐     ┌───────────────────────┴──────────────────────┐
│   AI Agent   │────▶│                 engram-code                   │
│  (OpenClaw,  │     │  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│   Cursor,    │     │  │Discovery │  │ Parsers  │  │  Chunker   │  │
│   etc.)      │     │  │ Service  │──│Apex, LWC │──│  Service   │  │
└──────────────┘     │  └──────────┘  └──────────┘  └────────────┘  │
       │             │                                      │        │
       │             │  ┌──────────┐  ┌──────────┐         │        │
       │             │  │  Search  │  │ Vectors  │◀────────┘        │
       │             │  │ Service  │──│ Service  │                  │
       └────────────▶│  └──────────┘  └──────────┘                  │
      search query   │       │              │                       │
                     └───────┼──────────────┼───────────────────────┘
                             │              │
                             ▼              ▼
                     ┌──────────────────────────┐
                     │   PostgreSQL + pgvector   │
                     │                          │
                     │  projects                │
                     │  code_chunks             │
                     │    embedding_bge (768)   │
                     │    embedding_nomic (768) │
                     │    embedding_minilm(384) │
                     └──────────────────────────┘
```

## Language Support

### TypeScript (.ts, .tsx)

The TypeScript parser extracts semantic chunks using the TypeScript compiler API:

| Chunk Type | What's Extracted |
|------------|------------------|
| `class` | Classes with decorators, extends/implements |
| `method` | Methods with access modifiers, parameters, return type |
| `function` | Exported and top-level functions |
| `interface` | Interface declarations with properties |
| `type` | Type alias declarations |

**Metadata extracted:**
- Decorators (`@Injectable`, `@Controller`, etc.)
- Export visibility (exported vs internal)
- Import dependencies
- JSDoc comments

Better chunking than line-based splitting — classes and their methods are individually searchable while preserving parent-child relationships.

### Apex (.cls, .trigger)

The Apex parser extracts:

| Chunk Type | What's Extracted |
|------------|------------------|
| `class` | Classes with annotations, sharing mode, extends/implements |
| `method` | Methods with access modifiers, parameters, return type |
| `trigger` | Triggers with sObject and events |
| `test` | Test classes and @IsTest methods |

**Metadata extracted:**
- Sharing mode (`with sharing`, `without sharing`, `inherited sharing`)
- Annotations (`@AuraEnabled`, `@InvocableMethod`, `@IsTest`, etc.)
- SOQL queries (inline and dynamic)
- DML operations (`insert`, `update`, `delete`, `upsert`)

```apex
// Example: This becomes a searchable chunk with rich metadata
@AuraEnabled
public with sharing class AccountService {
    public static List<Account> getAccounts() {
        return [SELECT Id, Name FROM Account];
    }
}
```

### LWC (.js in lwc/ folders)

The LWC parser extracts:

| Chunk Type | What's Extracted |
|------------|------------------|
| `component` | LWC component classes extending LightningElement |
| `method` | Class methods (including event handlers) |
| `function` | Arrow function properties |

**Metadata extracted:**
- `@api` properties (public API)
- `@track` properties (reactive)
- `@wire` decorators (data binding)
- Event handlers (methods starting with `handle`)
- Dispatched custom events
- Imports and dependencies

```javascript
// Example: Fully parsed with decorators and methods
import { LightningElement, api, wire } from 'lwc';
import getAccounts from '@salesforce/apex/AccountService.getAccounts';

export default class AccountList extends LightningElement {
    @api recordId;
    @wire(getAccounts) accounts;
    
    handleRefresh() {
        // ...
    }
}
```

## API Reference

### Projects

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/projects` | POST | Register a new project |
| `/v1/projects` | GET | List all projects |
| `/v1/projects/:id` | GET | Get project details |
| `/v1/projects/:id` | DELETE | Delete project and all chunks |
| `/v1/projects/:id/stats` | GET | Get project statistics |
| `/v1/projects/:id/ingest` | POST | Ingest/re-ingest project code |

### Search

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/search` | POST | Semantic search (single model) |
| `/v1/search/ensemble` | POST | Multi-model ensemble search with RRF fusion |
| `/v1/search/similar/:chunkId` | GET | Find similar code to a chunk |
| `/v1/search/models` | GET | List available embedding models |
| `/v1/search/examples` | GET | Get example search queries |
| `/v1/search/health` | GET | Health check |

### Ingestion Request

```json
POST /v1/projects/:id/ingest
{
  "clearExisting": false,  // true to re-ingest from scratch
  "skipEmbeddings": false  // true to skip embedding generation (for testing)
}
```

### Search Request

```json
POST /v1/search
{
  "query": "authentication logic",
  "projectId": "uuid",     // optional: filter by project
  "language": "apex",      // optional: filter by language
  "chunkType": "class",    // optional: filter by chunk type
  "limit": 10              // max results (1-100)
}
```

### Ensemble Search Request

```json
POST /v1/search/ensemble
{
  "query": "where is CRUD/FLS checked",
  "models": ["bge-base", "nomic"],  // models to use
  "limit": 10
}
```

### Search Response

```json
{
  "query": "authentication logic",
  "results": [
    {
      "chunk": {
        "id": "uuid",
        "filePath": "force-app/main/classes/AuthService.cls",
        "lineStart": 1,
        "lineEnd": 45,
        "content": "public class AuthService { ... }",
        "language": "apex",
        "chunkType": "class",
        "name": "AuthService",
        "parentName": null,
        "dependencies": []
      },
      "score": 0.89,
      "highlights": ["isAccessible()", "CRUD"]
    }
  ],
  "totalFound": 5,
  "searchTimeMs": 42
}
```

## Database Schema

```sql
-- Projects table
CREATE TABLE projects (
  id UUID PRIMARY KEY,
  name VARCHAR UNIQUE,
  root_path VARCHAR,
  languages TEXT[],
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  last_ingested_at TIMESTAMP
);

-- Code chunks with multi-model embeddings
CREATE TABLE code_chunks (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  
  -- Location
  file_path VARCHAR,
  line_start INT,
  line_end INT,
  
  -- Content
  content TEXT,
  language VARCHAR,
  chunk_type VARCHAR,
  name VARCHAR,
  parent_name VARCHAR,
  dependencies TEXT[],
  
  -- Multi-model embeddings (pgvector)
  embedding_bge VECTOR(768),
  embedding_nomic VECTOR(768),
  embedding_gte VECTOR(768),
  embedding_minilm VECTOR(384),
  
  -- Change detection
  checksum VARCHAR,
  created_at TIMESTAMP
);

-- Indexes for fast filtering
CREATE INDEX idx_chunks_project ON code_chunks(project_id);
CREATE INDEX idx_chunks_language ON code_chunks(language);
CREATE INDEX idx_chunks_type ON code_chunks(chunk_type);
CREATE INDEX idx_chunks_file ON code_chunks(file_path);
```

## Chunking Strategy

Code is chunked by **semantic units**, not arbitrary line counts:

```
┌─────────────────────────────────────────────────────┐
│  AccountService.cls                                  │
│  ┌───────────────────────────────────────────────┐  │
│  │ Chunk 1: file_header                          │  │
│  │ (imports, top comments)                       │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │ Chunk 2: class AccountService                 │  │
│  │ (entire class with annotations)               │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │ Chunk 3: method getAccounts                   │  │
│  │ (method with annotations, linked to class)    │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │ Chunk 4: method createAccount                 │  │
│  │ (method with annotations, linked to class)    │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**Why semantic chunking?**
- Methods are searchable independently AND as part of their class
- Class-level search returns the whole class context
- Parent-child relationships are preserved (`parentName` field)
- Metadata (annotations, sharing mode) is attached to each chunk

## Ensemble Search (RRF Fusion)

Multi-model search uses **Reciprocal Rank Fusion** for better recall:

```
┌─────────────────────────────────────────────────────────┐
│  Query: "authentication logic"                          │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │  bge-base   │  │    nomic    │  │    minilm       │ │
│  │  768-dim    │  │    768-dim  │  │    384-dim      │ │
│  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘ │
│         │                │                   │          │
│    AuthService      AuthService        AuthService      │
│    LoginController  UserManager        LoginController  │
│    UserManager      LoginController    AuthHelper       │
│         │                │                   │          │
│         └────────────────┼───────────────────┘          │
│                          ▼                              │
│              ┌───────────────────────┐                  │
│              │     RRF Fusion        │                  │
│              │  score = Σ 1/(k+rank) │                  │
│              └───────────────────────┘                  │
│                          │                              │
│            1. AuthService     (found by 3/3 models)     │
│            2. LoginController (found by 3/3 models)     │
│            3. UserManager     (found by 2/3 models)     │
│            4. AuthHelper      (found by 1/3 models)     │
└─────────────────────────────────────────────────────────┘
```

**Benefits:**
- Chunks found by multiple models score higher (consensus)
- Different models catch different semantic aspects
- Reduces single-model blind spots
- Response includes per-model rankings for debugging

## Environment Variables

```env
# Database (PostgreSQL with pgvector)
DATABASE_URL=postgresql://user:pass@localhost:5432/engram_code

# Embedding server (engram-embed)
ENGRAM_EMBED_URL=http://127.0.0.1:8080

# Server
PORT=3002
```

## Integration with Engram Ecosystem

engram-code is designed to work alongside [Engram](https://github.com/heybeaux/engram) (memory) and share infrastructure:

| Component | Port | Purpose |
|-----------|------|---------|
| engram | 3001 | Agent memory (facts, preferences, events) |
| engram-code | 3002 | Code search (classes, methods, components) |
| engram-embed | 8080 | Local embeddings (shared by both) |
| engram-dashboard | 3000 | Web UI (visualizes both) |

All components use the same embedding server for consistent vector representations.

## Example Queries

```bash
# Security-focused
"where is CRUD/FLS checked"
"classes using without sharing"
"DML operations without security"
"SOQL injection vulnerabilities"

# Architecture
"trigger handlers"
"service layer methods"
"batch job implementations"
"API integration methods"

# LWC
"wire service usage"
"components with API properties"
"event handling methods"

# General
"authentication and authorization"
"error handling patterns"
"utility functions"
"test classes"
```

## Performance

On M2 MacBook Pro:

| Operation | Time |
|-----------|------|
| Ingest 100 Apex files | ~5s |
| Generate embeddings (bge-base) | ~10ms/chunk |
| Single-model search | ~40ms |
| Ensemble search (3 models) | ~80ms |

## Running tests

```bash
pnpm test          # unit + parser + eval suites (no DB required)
pnpm run smoke     # EC-20 HTTP smoke for /v1/cards/:path
pnpm run test:e2e  # full e2e suite (requires Postgres)
```

### Smoke test (EC-20)

`pnpm run smoke` runs `test/cards-api.smoke.e2e-spec.ts` end-to-end:

1. Runs `engram-code index` against `test/fixtures/smoke-repo/`
2. Boots Nest with `ENGRAM_ARTIFACTS_ROOT` pointed at the indexed output
3. Issues `GET /v1/cards` and `GET /v1/cards/:path?lod=summary` via supertest
4. Asserts 200 + the response body matches the on-disk card byte-for-byte

No database is required — the smoke mounts only `CardsModule` so the
filesystem read path (`src/v2/api/cards.controller.ts`,
`src/v2/api/services/cards-fs.service.ts`) is exercised in isolation.

## License

MIT

---

<p align="center">
  <em>Let AI agents understand your code.</em>
</p>
