# API Reference

Complete REST API documentation for Engram.

---

## Authentication

All API requests require two headers:

| Header | Description |
|--------|-------------|
| `X-AM-API-Key` | Your API key (starts with `eg_sk_`) |
| `X-AM-User-ID` | The end-user's identifier |

```bash
curl -X POST https://your-engram-server/v1/memories \
  -H "Content-Type: application/json" \
  -H "X-AM-API-Key: eg_sk_your_key_here" \
  -H "X-AM-User-ID: user_123" \
  -d '{"raw": "User prefers dark mode"}'
```

**Note:** Users are auto-created on first request. You don't need to create them explicitly.

---

## Memory Operations

### Create Memory

Store a single memory.

```
POST /v1/memories
```

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `raw` | string | ✓ | The memory text |
| `layer` | enum | | Memory layer: `IDENTITY`, `PROJECT`, `SESSION`, `TASK` |
| `importanceHint` | enum | | Importance: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `context.projectId` | string | | Associate with a project |
| `context.sessionId` | string | | Associate with a session |

**Example:**

```bash
POST /v1/memories

{
  "raw": "User prefers dark mode for all interfaces",
  "layer": "IDENTITY",
  "importanceHint": "HIGH"
}
```

**Response:**

```json
{
  "id": "clx1abc123",
  "userId": "user_123",
  "raw": "User prefers dark mode for all interfaces",
  "layer": "IDENTITY",
  "source": "EXPLICIT_STATEMENT",
  "importanceHint": "HIGH",
  "importanceScore": 0.83,
  "confidence": 1.0,
  "retrievalCount": 0,
  "usedCount": 0,
  "consolidated": false,
  "createdAt": "2026-02-01T15:30:00.000Z",
  "updatedAt": "2026-02-01T15:30:00.000Z"
}
```

---

### Batch Create Memories

Store multiple memories at once. Useful for importing conversation history.

```
POST /v1/memories/batch
```

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `memories` | array | ✓ | Array of memory objects |
| `memories[].raw` | string | ✓ | The memory text |
| `memories[].ts` | string | | ISO timestamp |
| `memories[].layer` | enum | | Memory layer |
| `memories[].importanceHint` | enum | | Importance hint |
| `context.projectId` | string | | Associate all with a project |
| `context.sessionId` | string | | Associate all with a session |

**Example:**

```bash
POST /v1/memories/batch

{
  "memories": [
    { "raw": "Working on the dashboard redesign" },
    { "raw": "Meeting with design team tomorrow at 2pm" },
    { "raw": "User wants to prioritize mobile experience" }
  ],
  "context": {
    "projectId": "project_dashboard_v2"
  }
}
```

**Response:**

```json
{
  "created": 3,
  "failed": 0
}
```

---

### Query Memories

Semantic search for relevant memories.

```
POST /v1/memories/query
```

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | ✓ | Search query (natural language) |
| `layers` | array | | Filter by layers: `["IDENTITY", "PROJECT"]` |
| `limit` | number | | Max results (default: 10) |
| `includeChains` | boolean | | Include reasoning chains |
| `projectId` | string | | Filter by project |

**Example:**

```bash
POST /v1/memories/query

{
  "query": "user interface preferences",
  "layers": ["IDENTITY", "PROJECT"],
  "limit": 5
}
```

**Response:**

```json
{
  "memories": [
    {
      "id": "clx1abc123",
      "raw": "User prefers dark mode for all interfaces",
      "layer": "IDENTITY",
      "importanceScore": 0.83,
      "extraction": {
        "who": "User",
        "what": "prefers dark mode",
        "when": null,
        "whereCtx": "all interfaces",
        "why": null,
        "how": null,
        "topics": ["preferences", "ui"]
      }
    },
    {
      "id": "clx2def456",
      "raw": "User wants to prioritize mobile experience",
      "layer": "PROJECT",
      "importanceScore": 0.67
    }
  ],
  "queryTokens": 3,
  "latencyMs": 142
}
```

---

### Get Memory

Retrieve a single memory by ID.

```
GET /v1/memories/:id
```

**Example:**

```bash
GET /v1/memories/clx1abc123
```

**Response:**

```json
{
  "id": "clx1abc123",
  "raw": "User prefers dark mode for all interfaces",
  "layer": "IDENTITY",
  "importanceScore": 0.83,
  "extraction": {
    "who": "User",
    "what": "prefers dark mode",
    "topics": ["preferences", "ui"]
  }
}
```

---

### Delete Memory

Soft-delete a memory.

```
DELETE /v1/memories/:id
```

**Response:** `204 No Content`

---

## Context

### Load Context

Get formatted context for session start. Returns a string ready for system prompt injection.

```
POST /v1/context
```

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `maxTokens` | number | | Token budget (default: 4000) |
| `projectId` | string | | Include project-specific memories |
| `sessionId` | string | | Include session-specific memories |

**Example:**

```bash
POST /v1/context

{
  "maxTokens": 4000,
  "projectId": "project_dashboard_v2"
}
```

**Response:**

```json
{
  "context": "## User Identity\n- User prefers dark mode for all interfaces\n- User is a software developer\n\n## Current Project\n- Working on the dashboard redesign\n- User wants to prioritize mobile experience\n\n## Recent Context\n- Meeting with design team tomorrow at 2pm",
  "tokenCount": 52,
  "memoriesIncluded": 5,
  "layers": {
    "identity": 2,
    "project": 2,
    "session": 1
  }
}
```

**Usage in system prompt:**

```typescript
const { context } = await engram.loadContext({ maxTokens: 4000 });

const systemPrompt = `You are a helpful assistant.

## Memory Context
${context}

Now assist the user with their request.`;
```

---

## Feedback

### Mark Used

Signal that a memory was used (implicit feedback).

```
POST /v1/memories/:id/used
```

**Response:** `204 No Content`

This increments the `usedCount` and updates `lastUsedAt`, which improves the memory's importance score over time.

---

### Mark Helpful

Signal that a memory was helpful (explicit feedback).

```
POST /v1/memories/:id/helpful
```

**Response:** `204 No Content`

---

### Correct Memory

Correct an inaccurate memory. Creates a new memory and marks the original as superseded.

```
POST /v1/memories/:id/correct
```

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `correction` | string | ✓ | The corrected information |

**Example:**

```bash
POST /v1/memories/clx1abc123/correct

{
  "correction": "User actually prefers light mode with high contrast"
}
```

**Response:** Returns the new corrected memory.

---

## Data Types

### Memory Layer

| Value | Description | Lifespan |
|-------|-------------|----------|
| `IDENTITY` | Core user facts | Permanent |
| `PROJECT` | Workstream context | Weeks/months |
| `SESSION` | Conversation context | Days |
| `TASK` | Immediate work | Hours |

### Importance Hint

| Value | Score Boost |
|-------|-------------|
| `LOW` | +0 |
| `MEDIUM` | +25 |
| `HIGH` | +50 |
| `CRITICAL` | +100 |

### Memory Source

| Value | Description |
|-------|-------------|
| `EXPLICIT_STATEMENT` | User directly stated |
| `AGENT_OBSERVATION` | Agent inferred |
| `CORRECTION` | Correction to prior memory |
| `PATTERN_DETECTED` | From consolidation |
| `SYSTEM` | System-generated |

---

## Error Responses

All errors follow this format:

```json
{
  "statusCode": 401,
  "message": "Missing X-AM-API-Key header",
  "error": "Unauthorized"
}
```

### Common Errors

| Code | Description |
|------|-------------|
| `400` | Invalid request body |
| `401` | Missing or invalid API key |
| `404` | Memory not found |
| `429` | Rate limit exceeded |
| `500` | Server error |

---

## Rate Limits

Default rate limits (configurable per agent):

| Endpoint | Limit |
|----------|-------|
| `POST /v1/memories` | 100/minute |
| `POST /v1/memories/query` | 60/minute |
| `POST /v1/context` | 30/minute |

Rate limit headers are included in responses:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1706803200
```
