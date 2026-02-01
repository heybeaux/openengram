# Engram

**Memory infrastructure for AI agents.**

> An **engram** is a hypothetical permanent change in the brain accounting for the existence of memory — a memory trace.

Engram solves the fundamental problem that AI agents wake up blank every session, losing context, decisions, and continuity.

---

## Features

- **Simple API** — `engram.remember()` and `engram.recall()`
- **Semantic search** — Find memories by meaning, not keywords
- **Automatic extraction** — 5W1H (who, what, when, where, why, how)
- **Memory layers** — Identity, Project, Session, Task
- **Importance scoring** — Critical memories surface first
- **Reasoning chains** — Track how decisions led to conclusions
- **Consolidation** — Memories strengthen over time
- **Proactive surfacing** — Relevant context pushed via webhooks

---

## Quick Start

```typescript
import { Engram } from '@engram/sdk';

const engram = new Engram({
  apiKey: 'eg_sk_...',
  userId: 'user_123',
});

// Remember
await engram.remember("User prefers dark mode");
await engram.remember("Never deploy on Fridays", { 
  importance: 'critical',
  layer: 'identity'
});

// Recall
const memories = await engram.recall("user preferences");

// Load context for a session
const context = await engram.loadContext({ maxTokens: 4000 });
// Returns formatted string ready for system prompt injection
```

---

## Installation

```bash
npm install @engram/sdk
# or
pnpm add @engram/sdk
```

---

## API Reference

### Memory Operations

| Method | Description |
|--------|-------------|
| `engram.remember(text, options?)` | Store a memory |
| `engram.rememberAll(memories)` | Batch import |
| `engram.recall(query, options?)` | Semantic search |
| `engram.loadContext(options?)` | Get formatted context |

### Feedback

| Method | Description |
|--------|-------------|
| `engram.used(memoryId)` | Mark memory as used |
| `engram.helpful(memoryId)` | Mark as helpful |
| `engram.correct(memoryId, correction)` | Correct a memory |

### Sessions

| Method | Description |
|--------|-------------|
| `engram.startSession(options?)` | Start a session |
| `session.end()` | End session, trigger consolidation |

---

## REST API

```bash
# Create memory
POST /v1/memories
X-AM-API-Key: eg_sk_...
X-AM-User-ID: user_123

{
  "raw": "User prefers dark mode",
  "layer": "identity",
  "importance_hint": "high"
}

# Query memories
POST /v1/memories/query

{
  "query": "user preferences",
  "limit": 10
}

# Load context
POST /v1/context

{
  "maxTokens": 4000
}
```

---

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│   Engram    │────▶│  PostgreSQL │
│   (Agent)   │     │   Server    │     │  (metadata) │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
                           │
                    ┌──────▼──────┐
                    │  Pinecone   │
                    │ (embeddings)│
                    └─────────────┘
```

---

## Memory Layers

| Layer | Purpose | Lifespan |
|-------|---------|----------|
| **Identity** | Who is this user? Core facts. | Permanent |
| **Project** | Active workstreams, goals, decisions | Weeks/months |
| **Session** | Recent conversations, current context | Days |
| **Task** | Immediate work | Hours |

---

## Development

```bash
# Install dependencies
pnpm install

# Set up database
cp .env.example .env
# Edit .env with your database URL

# Run migrations
pnpm prisma migrate dev

# Start server
pnpm start:dev
```

---

## Tech Stack

- **NestJS** — API framework
- **Prisma** — Database ORM
- **PostgreSQL** — Metadata storage
- **Pinecone** — Vector embeddings
- **TypeScript** — Type safety

---

## License

MIT

---

## Authors

- Beaux Walton
- Rook ♜

---

*Built with late-night coffee and good vibes.*
