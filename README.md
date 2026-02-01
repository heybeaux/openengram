# Engram

**Memory infrastructure for AI agents.**

> An **engram** is a hypothetical permanent change in the brain accounting for the existence of memory — a memory trace.

Engram solves the fundamental problem that AI agents wake up blank every session, losing context, decisions, and continuity.

---

## Why Engram?

AI agents are stateless by nature. Every conversation starts fresh. Engram gives your agent:

- **Persistent memory** — Facts, preferences, and context survive across sessions
- **Semantic recall** — Find relevant memories by meaning, not keywords
- **Automatic structure** — 5W1H extraction (who, what, when, where, why, how)
- **Importance scoring** — Critical memories surface first
- **Memory layers** — Identity, Project, Session, Task lifespans
- **Provider flexibility** — Bring your own LLM and vector store

---

## Quick Start

### 1. Install the SDK

```bash
npm install @engram/sdk
# or
pnpm add @engram/sdk
```

### 2. Initialize the client

```typescript
import { Engram } from '@engram/sdk';

const engram = new Engram({
  apiKey: 'eg_sk_...',      // Your API key
  userId: 'user_123',        // The end-user you're storing memories for
  baseUrl: 'http://localhost:3000',  // Self-hosted or cloud
});
```

### 3. Store memories

```typescript
// Simple memory
await engram.remember("User prefers dark mode");

// With options
await engram.remember("Never deploy on Fridays", { 
  importance: 'critical',
  layer: 'identity'
});

// Batch import (e.g., from conversation history)
await engram.rememberAll([
  { raw: "Working on the dashboard redesign" },
  { raw: "Meeting with design team tomorrow at 2pm" },
]);
```

### 4. Recall memories

```typescript
// Semantic search
const memories = await engram.recall("user preferences");
// Returns memories about dark mode, UI preferences, etc.

// Load context for session start
const context = await engram.loadContext({ maxTokens: 4000 });
// Returns formatted string ready for system prompt injection
```

### 5. Provide feedback

```typescript
// Mark memory as used (implicit signal)
await engram.used(memoryId);

// Mark as helpful (explicit signal)
await engram.helpful(memoryId);

// Correct a memory
await engram.correct(memoryId, "Actually prefers light mode");
```

---

## Self-Hosting

Engram is designed to run anywhere:

```bash
# Clone the repo
git clone https://github.com/your-org/engram
cd engram

# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your database URL and API keys

# Run database migrations
pnpm prisma migrate dev

# Start the server
pnpm start:dev
```

See [Self-Hosting Guide](./docs/SELF_HOSTING.md) for detailed setup instructions.

---

## Documentation

| Document | Description |
|----------|-------------|
| [API Reference](./docs/API.md) | Full REST API documentation |
| [Configuration](./docs/CONFIGURATION.md) | Environment variables and options |
| [Providers](./docs/PROVIDERS.md) | LLM and vector provider options |
| [Self-Hosting](./docs/SELF_HOSTING.md) | Deployment guide |
| [SDK Guide](./docs/SDK.md) | TypeScript SDK usage |

---

## Core Concepts

### Memory Layers

Engram organizes memories into layers with different lifespans:

| Layer | Purpose | Lifespan | Example |
|-------|---------|----------|---------|
| **Identity** | Core user facts | Permanent | "Prefers dark mode" |
| **Project** | Workstream context | Weeks/months | "Working on v2 redesign" |
| **Session** | Conversation context | Days | "Just discussed auth flow" |
| **Task** | Immediate work | Hours | "Debugging login issue" |

### Importance Scoring

Memories have importance scores (0-1) that determine retrieval priority:

- **Explicit hints** — API can flag memories as `low`, `medium`, `high`, or `critical`
- **Usage signals** — Memories used more often gain importance
- **Layer weight** — Identity > Project > Session > Task
- **Time decay** — Unused memories fade (except Identity layer)

### 5W1H Extraction

Every memory is automatically analyzed to extract:

- **Who** — People, organizations, entities
- **What** — Core fact or action
- **When** — Temporal context
- **Where** — Location or setting
- **Why** — Reasoning or motivation
- **How** — Method or process

### Auto-Mode (Conversation Observation)

Engram can passively observe conversations and automatically extract memories based on importance signals:

| Signal Type | Triggers | Example |
|-------------|----------|---------|
| **Explicit** | "remember this", "important", "never forget" | "Remember this: I'm allergic to shellfish" |
| **Correction** | "actually", "no that's wrong", "I meant" | "Actually, my email is john@example.com" |
| **Preference** | "I prefer", "I always", "I never", "I like", "I hate" | "I always use dark mode" |
| **Repetition** | Same concept mentioned 2+ times | Mentioning "TypeScript" in multiple turns |

```typescript
// Observe a conversation and auto-extract memories
const result = await engram.observe([
  { role: 'user', content: 'I always use dark mode in my editors' },
  { role: 'assistant', content: 'Got it! I\'ll remember that.' },
  { role: 'user', content: 'Remember this: never deploy on Fridays' },
], { minImportance: 0.5 });

console.log(result.created);  // 2 memories created
console.log(result.signals);  // Detected preference + explicit signals
```

---

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│   Engram    │────▶│  PostgreSQL │
│   (Agent)   │     │   Server    │     │  (metadata) │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼──────┐  ┌──▼───┐  ┌─────▼─────┐
       │  pgvector   │  │ LLM  │  │ Pinecone  │
       │   (local)   │  │ APIs │  │  (cloud)  │
       └─────────────┘  └──────┘  └───────────┘
```

**Bring your own:**
- **LLM**: OpenAI, Anthropic, Ollama, LM Studio
- **Vector store**: pgvector (local) or Pinecone (cloud)
- **Database**: PostgreSQL

---

## API at a Glance

### REST Endpoints

```bash
# Create memory
POST /v1/memories
X-AM-API-Key: eg_sk_...
X-AM-User-ID: user_123

{
  "raw": "User prefers dark mode",
  "layer": "IDENTITY",
  "importanceHint": "HIGH"
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

# Observe conversation (auto-mode)
POST /v1/observe
{
  "turns": [
    { "role": "user", "content": "I prefer TypeScript over JavaScript" },
    { "role": "assistant", "content": "Noted!" },
    { "role": "user", "content": "Remember this: always use strict mode" }
  ],
  "minImportance": 0.4
}

# Analyze signals only (preview, no storage)
POST /v1/observe/analyze
{
  "turns": [...]
}
```

### TypeScript SDK

```typescript
// Remember
await engram.remember(text, options);
await engram.rememberAll(memories);

// Recall
const memories = await engram.recall(query, options);
const context = await engram.loadContext(options);

// Feedback
await engram.used(memoryId);
await engram.helpful(memoryId);
await engram.correct(memoryId, correction);

// Auto-mode
const result = await engram.observe(turns, options);
const analysis = await engram.analyzeSignals(turns);
```

---

## Tech Stack

- **NestJS** — API framework
- **Prisma** — Database ORM
- **PostgreSQL** — Metadata storage
- **pgvector / Pinecone** — Vector embeddings
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
