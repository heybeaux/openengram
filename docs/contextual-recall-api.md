# Contextual Recall API

## `POST /v1/recall/contextual`

Mid-conversation memory recall with automatic topic shift detection. Only returns memories when the current message represents a significant topic change from recent conversation.

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `x-user-id` or `Authorization` | Yes | User identifier |
| `x-api-key` | Yes | API key |

### Request Body

```json
{
  "text": "string",           // Required. The current message text
  "sessionKey": "string",     // Required. Unique session identifier (for tracking state)
  "excludeIds": ["string"],   // Optional. Memory IDs already in context (won't be returned)
  "maxResults": 5,            // Optional. Max memories to return (default: 5)
  "maxTokens": 500,           // Optional. Approximate token budget for results (default: 500)
  "minScore": 0.75            // Optional. Minimum similarity score threshold (default: 0.75)
}
```

### Response

```json
{
  "memories": [
    {
      "id": "mem_abc123",
      "raw": "Beaux prefers dark mode in all IDEs",
      "layer": "IDENTITY",
      "score": 0.87,
      "topics": ["preferences", "IDE"]
    }
  ],
  "topicShift": true,         // Whether a topic shift was detected
  "tokenCount": 42,           // Approximate tokens in returned memories
  "latencyMs": 156            // Server-side latency
}
```

### Behavior

1. **First call per session** — always treated as a topic shift (seeds context)
2. **Subsequent calls** — compares the embedding of `text` against recent message embeddings
3. **Topic shift detected** (cosine distance > 0.4) → performs semantic search, returns relevant memories
4. **No topic shift** → returns `{ memories: [], topicShift: false }` immediately
5. **Previously recalled memories** are automatically excluded within the same session
6. **Session state** is tracked in-memory by `sessionKey`

### Example: curl

```bash
# First message (always triggers recall)
curl -X POST http://localhost:3100/v1/recall/contextual \
  -H "Content-Type: application/json" \
  -H "x-api-key: $ENGRAM_API_KEY" \
  -H "x-user-id: user_123" \
  -d '{
    "text": "Let me tell you about the Salesforce project",
    "sessionKey": "session_abc",
    "excludeIds": ["mem_already_loaded_1", "mem_already_loaded_2"]
  }'

# Follow-up on same topic (no recall)
curl -X POST http://localhost:3100/v1/recall/contextual \
  -H "Content-Type: application/json" \
  -H "x-api-key: $ENGRAM_API_KEY" \
  -H "x-user-id: user_123" \
  -d '{
    "text": "The Apex tests are failing on deployment",
    "sessionKey": "session_abc"
  }'

# Topic shift! (triggers recall)
curl -X POST http://localhost:3100/v1/recall/contextual \
  -H "Content-Type: application/json" \
  -H "x-api-key: $ENGRAM_API_KEY" \
  -H "x-user-id: user_123" \
  -d '{
    "text": "Hey what was that restaurant we talked about last week?",
    "sessionKey": "session_abc"
  }'
```

### Performance

| Scenario | Expected Latency |
|----------|-----------------|
| No topic shift (fast path) | < 50ms (embedding generation only) |
| Topic shift + recall | < 250ms (embedding + vector search + DB fetch) |

### Thresholds

| Parameter | Default | Description |
|-----------|---------|-------------|
| Topic shift distance | 0.4 | Cosine distance threshold (1 - similarity) |
| Min score | 0.75 | Minimum vector similarity to return |
| Max results | 5 | Maximum memories per recall |
| Token budget | 500 | Approximate max tokens in response |
