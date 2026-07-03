# @openengram/client

Lightweight TypeScript client for the [Engram](https://github.com/heybeaux/engram) memory API. Zero dependencies, uses native `fetch` (Node 18+).

## Install

```bash
npm install @openengram/client
```

## Quick Start

```typescript
import { EngramClient } from '@openengram/client';

const engram = new EngramClient({
  baseUrl: 'http://localhost:3001',
  apiKey: '<api-key-from-register-response>',
  userId: 'my-agent',
});

// Store a memory
const memory = await engram.remember('User prefers dark mode');

// Recall memories
const memories = await engram.recall('UI preferences');
```

## Configuration

```typescript
new EngramClient({
  baseUrl: string;       // Engram API URL (required)
  apiKey: string;        // API key — sent as X-AM-API-Key (required)
  userId: string;        // User ID — sent as X-AM-User-ID (required)
  timeout?: number;      // Request timeout in ms (default: 30000)
  retries?: number;      // Retry count for 5xx errors (default: 2)
  onError?: (err) => void; // Error callback
})
```

## API Reference

### Core Methods

**`remember(text, options?)`** — Store a memory
```typescript
await engram.remember('fact', { layer: 'CORE', tags: ['important'] });
```

**`recall(query, options?)`** — Semantic search
```typescript
const results = await engram.recall('auth decisions', {
  limit: 10,
  layers: ['CORE', 'SEMANTIC'],
  minImportance: 0.7,
});
```

### CRUD

| Method | Description |
|--------|-------------|
| `get(id)` | Get memory by ID |
| `update(id, data)` | Update a memory |
| `forget(id)` | Delete a memory |

### Bulk

**`rememberMany(items)`** — Store multiple memories at once
```typescript
await engram.rememberMany([
  { text: 'fact one' },
  { text: 'fact two', options: { tags: ['x'] } },
]);
```

### Context & Operations

| Method | Description |
|--------|-------------|
| `generateContext(options?)` | Generate context string for agent prompts |
| `dreamCycle(options?)` | Trigger memory consolidation |
| `dedupScan()` | Scan and merge duplicate memories |
| `health()` | API health check |
| `stats()` | Memory statistics |

### Webhooks

```typescript
const webhook = await engram.webhooks.create({
  url: 'https://example.com/hook',
  events: ['memory.created'],
});

await engram.webhooks.list();
await engram.webhooks.get(id);
await engram.webhooks.update(id, { active: false });
await engram.webhooks.delete(id);
await engram.webhooks.test(id);
await engram.webhooks.deliveries(id);
```

## Error Handling

```typescript
import { AuthError, NotFoundError, TimeoutError, EngramError } from '@openengram/client';

try {
  await engram.get('nonexistent');
} catch (err) {
  if (err instanceof NotFoundError) { /* 404 */ }
  if (err instanceof AuthError) { /* 401 */ }
  if (err instanceof TimeoutError) { /* request timed out */ }
  if (err instanceof EngramError) { /* any API error */ }
}
```

## License

MIT
