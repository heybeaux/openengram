# OpenClaw Hook Integration Spec

> **Status:** Design Only — not yet implemented  
> **Date:** 2026-02-10  
> **Author:** Rook (sub-agent)

## Overview

This document specifies how OpenClaw hooks integrate with Engram for bidirectional agent memory. Two hooks currently exist:

1. **`engram`** — Full memory injection + auto-capture + agent self-reflection
2. **`engram-recall`** — Lightweight contextual recall on topic shifts

## Hook Architecture

### Event Types

| Event | When | Purpose |
|-------|------|---------|
| `agent:bootstrap` | Agent session starts | Inject memory context into system prompt |
| `message:received` | User sends a message | Capture user messages for memory extraction |
| `message:sent` | Agent responds | Capture agent responses for memory extraction |

### Event Flow

```
User Message → message:received → engram /v1/observe (extract memories)
                                → engram-recall /v1/recall/contextual (topic shift detection)
Agent Response → message:sent → engram /v1/observe (extract memories)
                              → maybeReflect() → /v1/agents/:id/reflect
New Session → agent:bootstrap → engram /v1/context (load memory context)
```

## Authentication Flow

1. Hook env vars are configured in `~/.openclaw/openclaw.json` under `hooks.internal.entries.engram.env`
2. On `agent:bootstrap`, the hook reads `event.context.cfg` to resolve env vars and caches them
3. On `message:received`/`message:sent`, cached env is used (these events don't include cfg)
4. All API calls use `X-AM-API-Key` header for authentication and `X-AM-User-ID` for user isolation

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "engram": {
          "enabled": true,
          "env": {
            "ENGRAM_API_URL": "http://localhost:3001",
            "ENGRAM_API_KEY": "eg_sk_test_key_12345",
            "ENGRAM_USER_ID": "user_beaux",
            "ENGRAM_AGENT_ID": "rook",
            "ENGRAM_MAX_TOKENS": "2000",
            "ENGRAM_AUTO_CAPTURE": "true"
          }
        }
      }
    }
  }
}
```

## Sub-Agent Memory Writing

Sub-agents should write memories via the `/v1/observe` endpoint:

```typescript
// In a sub-agent hook handler or direct API call
const response = await fetch(`${ENGRAM_API_URL}/v1/observe`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-AM-API-Key': ENGRAM_API_KEY,
    'X-AM-User-ID': ENGRAM_USER_ID,
  },
  body: JSON.stringify({
    turns: [
      { role: 'user', content: 'User said something memorable' },
      { role: 'assistant', content: 'Agent learned something important' },
    ],
    sessionId: event.sessionKey,
    metadata: {
      source: 'openclaw',
      channel: 'webchat',
      subAgent: true,
      taskLabel: 'engram-v08-wave2',
    },
  }),
});
```

### Important Considerations for Sub-Agents

- Sub-agents share the same `ENGRAM_USER_ID` as the main agent
- Use `sessionId` to correlate memories with the originating session
- The `metadata.subAgent: true` flag helps distinguish sub-agent observations
- Sub-agents are ephemeral — memories they create persist beyond their lifetime

## Agent Self-Reflection

The engram hook includes a self-reflection system:

1. Conversation turns are buffered (user + assistant messages)
2. After ~20 turns or 30-minute cooldown, triggers `/v1/agents/:agentId/reflect`
3. Creates memories with `subjectType=AGENT` about the agent's identity, lessons, and working style
4. These agent self-memories are included in bootstrap context

## Rate Limiting Considerations

Engram's rate limiter (v0.7+) applies to all hook API calls:

| Endpoint | Default Limit | Notes |
|----------|--------------|-------|
| `POST /v1/observe` | 100 req/min | Per API key |
| `POST /v1/context` | 30 req/min | Per API key |
| `POST /v1/recall/contextual` | 60 req/min | Per API key |
| `POST /v1/agents/:id/reflect` | 10 req/min | Per API key |

### Mitigation Strategies

- **engram-recall** uses a 30-second per-session cooldown to avoid spamming
- **engram** skips short messages (<20 chars user, <50 chars assistant)
- **engram** skips commands (starting with `/`), tool results, and ack messages
- Sub-agents should batch observations where possible
- Consider using the `@SkipRateLimit()` decorator for internal/trusted endpoints

## Example: Minimal Hook

```typescript
// hooks/my-engram-hook/handler.ts
const handler = async (event) => {
  if (event.type === 'agent' && event.action === 'bootstrap') {
    // Load memories into context
    const resp = await fetch(`${process.env.ENGRAM_API_URL}/v1/context`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AM-API-Key': process.env.ENGRAM_API_KEY,
        'X-AM-User-ID': process.env.ENGRAM_USER_ID,
      },
      body: JSON.stringify({ maxTokens: 2000 }),
    });
    const data = await resp.json();
    if (data.memoriesIncluded > 0) {
      event.context.bootstrapFiles = event.context.bootstrapFiles || [];
      event.context.bootstrapFiles.push({
        name: 'MEMORY_CONTEXT.md',
        path: 'MEMORY_CONTEXT.md',
        content: `# Memories\n\n${data.context}`,
      });
    }
  }

  if (event.type === 'message' && event.action === 'received') {
    const text = event.context.text;
    if (!text || text.length < 20) return;
    
    await fetch(`${process.env.ENGRAM_API_URL}/v1/observe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AM-API-Key': process.env.ENGRAM_API_KEY,
        'X-AM-User-ID': process.env.ENGRAM_USER_ID,
      },
      body: JSON.stringify({
        turns: [{ role: 'user', content: text }],
        sessionId: event.sessionKey,
      }),
    });
  }
};

export default handler;
```

## HOOK.md Metadata Format

```yaml
---
name: engram
description: "Memory injection and auto-capture for Engram"
metadata:
  openclaw:
    emoji: "🧠"
    events: ["agent:bootstrap", "message:received", "message:sent"]
    requires:
      env: ["ENGRAM_API_URL", "ENGRAM_API_KEY", "ENGRAM_USER_ID"]
---
```

## Future Considerations

- **Webhook mode**: Engram could push memory events to OpenClaw instead of polling
- **Memory pools**: Sub-agents could write to isolated memory pools for task-specific context
- **Agent-to-agent memory sharing**: Multiple agents could share a memory namespace
- **Streaming context**: Instead of loading all memories at bootstrap, stream relevant ones during conversation
