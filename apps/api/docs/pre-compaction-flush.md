# Pre-Compaction Memory Flush Pattern (HEY-327)

## Problem

When an AI agent's context window fills up and gets compacted (truncated), important context is lost. Key memories, decisions, and summaries from the conversation may be permanently forgotten.

## Solution

The **flush endpoint** (`POST /v1/memories/flush`) allows agents to batch-store critical memories before context compaction occurs.

### How It Works

1. Agent detects context window is nearing capacity (e.g., 80% full)
2. Agent summarizes key context into discrete memory items
3. Agent calls `POST /v1/memories/flush` with the batch
4. Memories are stored with `[pre-compaction]` prefix and HIGH importance
5. Context window is safely compacted — memories survive in Engram

### API

#### POST /v1/memories/flush

```json
{
  "memories": [
    {
      "content": "User's project deadline is March 1st, 2026",
      "layer": "PROJECT",
      "importance": "HIGH"
    },
    {
      "content": "We decided to use PostgreSQL instead of MongoDB",
      "importance": "CRITICAL"
    },
    {
      "content": "User prefers concise responses without preamble",
      "layer": "IDENTITY"
    }
  ],
  "sessionId": "optional-session-id",
  "agentId": "optional-agent-id",
  "reason": "pre_compaction"
}
```

**Response:**
```json
{
  "flushed": 3,
  "failed": 0,
  "memoryIds": ["clx...", "clx...", "clx..."],
  "reason": "pre_compaction"
}
```

### Integration Example (OpenClaw/Claude)

```
# In your agent's system prompt or compaction handler:
When context exceeds 80% capacity, before compaction:
1. Identify key facts, decisions, and user preferences from this conversation
2. POST /v1/memories/flush with those items
3. Proceed with compaction
```

### Fields

| Field | Default | Description |
|-------|---------|-------------|
| `content` | required | The memory text |
| `layer` | SESSION | Memory layer (SESSION, PROJECT, IDENTITY, TASK) |
| `importance` | HIGH | Importance hint (LOW, MEDIUM, HIGH, CRITICAL) |
| `sessionId` | — | Link to a session |
| `agentId` | — | Agent attribution |
| `reason` | pre_compaction | Why this flush occurred |

### Design Decisions

- **HIGH importance default**: Pre-compaction memories are inherently valuable — the agent chose to preserve them
- **`[pre-compaction]` prefix**: Makes these memories identifiable in search results and during consolidation
- **Uses existing pipeline**: Goes through the standard `remember()` path, getting dedup, extraction, and embedding for free
- **Graceful failure**: Individual memory failures don't block the rest of the batch
