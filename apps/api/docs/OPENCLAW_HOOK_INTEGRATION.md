# OpenClaw Hook Integration

*Documentation for Engram's OpenClaw memory capture integration*

**Status**: Working (requires OpenClaw fork until PR merged)  
**Last Updated**: 2026-02-04

---

## Overview

Engram integrates with OpenClaw via internal hooks to provide:
1. **Memory Injection** - Load relevant memories into agent context at session start
2. **Auto-Capture** - Capture both user and assistant messages for memory extraction

## The Problem

OpenClaw's mainline release only supports these internal hook events:
- `agent:bootstrap` - When agent session starts
- `command:new`, `command:reset` - Command lifecycle
- `gateway:startup` - Gateway initialization

**Missing**: Message lifecycle events (`message:received`, `message:sent`)

Without message events, Engram can inject memories but cannot capture new ones from conversations.

## Current Solution

### Fork Requirement

Using OpenClaw fork at `~/projects/openclaw-fork` (branch: `feat/message-lifecycle-hooks`)

This fork adds:
- `message:received` - Fires when user message arrives (before processing)
- `message:sent` - Fires when assistant message is delivered

**Upstream PR**: Pending (#6384)

### Hook Location

```
~/clawd/hooks/engram/
├── HOOK.md      # Hook metadata and event registration
└── handler.ts   # Event handlers
```

### Event Registration (HOOK.md)

```yaml
metadata:
  openclaw:
    events: ["agent:bootstrap", "message:received", "message:sent"]
```

### Handler Logic

**`message:received`** (user messages):
- Skips messages < 20 chars
- Skips commands (starting with `/`)
- Sends to Engram `/v1/observe` with `role: 'user'`

**`message:sent`** (assistant messages):
- Skips messages < 50 chars
- Skips `NO_REPLY`, `HEARTBEAT_OK`, tool results
- Sends to Engram `/v1/observe` with `role: 'assistant'`

**`agent:bootstrap`**:
- Calls Engram `/v1/context` to load memories
- Injects as `MEMORY_CONTEXT.md` bootstrap file

## Configuration

In `~/.openclaw/openclaw.json`:

```json
{
  "hooks": {
    "internal": {
      "enabled": true,
      "entries": {
        "engram": {
          "enabled": true,
          "env": {
            "ENGRAM_API_URL": "http://localhost:3001",
            "ENGRAM_API_KEY": "your-api-key",
            "ENGRAM_USER_ID": "Beaux",
            "ENGRAM_AGENT_ID": "rook",
            "ENGRAM_AGENT_API_KEY": "agent-api-key",
            "ENGRAM_MAX_TOKENS": "2000",
            "ENGRAM_AUTO_CAPTURE": "true"
          }
        }
      }
    }
  }
}
```

## v0.9: Sub-Agent Auto-Capture (Pool-Scoped)

*Added: 2026-02-11*

### Overview

When OpenClaw spawns a sub-agent, the hook automatically:
1. **Registers** the session with Engram (creates task pool + grants)
2. **Injects** scoped context (task-relevant + global memories)
3. **Captures** messages with pool attribution (memories land in task pool)
4. **Promotes** high-scoring memories to global pool on session completion

### Flow

```
Sub-agent spawns
  └─ agent:bootstrap (sessionKey contains "subagent")
       ├─ POST /v1/agent-sessions  →  register session, auto-create task pool
       └─ POST /v1/context/scoped  →  get task-scoped context, inject into prompt

Sub-agent sends/receives messages
  └─ message:sent / message:received
       └─ POST /v1/observe { poolId, agentSessionKey }  →  memories scoped to task pool

Sub-agent session ends
  └─ session:end
       └─ PATCH /v1/agent-sessions/:key { status: "COMPLETED" }
            └─ Server-side: promote memories with effectiveScore ≥ 0.7 to GLOBAL pool
```

### Session Registration

```
POST /v1/agent-sessions
{
  "sessionKey": "agent:main:subagent:abc-123",
  "parentKey": "agent:main:main",
  "label": "abc-123",
  "taskDescription": "...",
  "userId": "Beaux"
}
→ { "id": "...", "poolId": "pool_xyz", ... }
```

The server auto-creates a `task:<label>` pool with:
- WRITE grant for the sub-agent
- READ grant for the parent session
- READ grant for the sub-agent on GLOBAL pool

### Scoped Context

```
POST /v1/context/scoped
{
  "userId": "Beaux",
  "agentSessionKey": "agent:main:subagent:abc-123",
  "taskDescription": "...",
  "maxTokens": 2000,
  "includeGlobal": true
}
→ { "context": "...", "tokenCount": 1200, "memoriesIncluded": 42, ... }
```

Falls back to main `/v1/context` if scoped context endpoint fails.

### Pool-Scoped Observe

Sub-agent messages include `poolId` and `agentSessionKey`:
```
POST /v1/observe
{
  "turns": [{ "role": "assistant", "content": "..." }],
  "sessionId": "agent:main:subagent:abc-123",
  "poolId": "pool_xyz",
  "agentSessionKey": "agent:main:subagent:abc-123"
}
```

### Session Completion & Memory Promotion

On `session:end`, the hook calls:
```
PATCH /v1/agent-sessions/agent:main:subagent:abc-123
{ "status": "COMPLETED" }
```

Server-side promotion logic:
- Finds the `task:<label>` pool
- Memories with `effectiveScore >= 0.7` → added to GLOBAL pool
- Lower-scored memories stay in task pool only

### Hook Events

The hook now registers: `agent:bootstrap`, `message:received`, `message:sent`, `session:end`

### Notes

- Sub-agent detection: sessionKey contains `"subagent"`
- Session cache is in-memory (poolId mapping) — survives within a gateway lifecycle
- If `session:end` event is not available in your OpenClaw version, call the completion endpoint manually from the sub-agent's final message handler

---

## What to Watch For

### 1. Fork Freshness
The fork may drift from upstream. Periodically:
```bash
cd ~/projects/openclaw-fork
git fetch upstream
git rebase upstream/main
```

### 2. Log File Buffering
After gateway restart, logs may not immediately appear in `~/.openclaw/logs/gateway.log` due to launchd buffering. Verify functionality by checking database directly:
```bash
cd ~/projects/agent-memory/engram
npx ts-node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.memory.findMany({
  orderBy: { createdAt: 'desc' },
  take: 5,
  select: { raw: true, createdAt: true }
}).then(console.log);
"
```

### 3. Hook Event Format
The fork passes event context differently than expected:
- `event.context.text` - Message content
- `event.context.channel` - Channel name (whatsapp, telegram, etc.)
- `event.context.cfg` - Full OpenClaw config (for extracting env vars)

**Important**: Hook env vars come through `event.context.cfg.hooks.internal.entries.engram.env`, NOT `process.env` directly.

### 4. Restart Behavior
- `gateway restart` (SIGUSR1) - Hot reload, may not fully reload hooks
- `gateway stop && gateway start` - Full restart, recommended after hook changes

### 5. Bidirectional Capture
Previous bug: Handler only captured assistant messages. Now captures both:
- User messages via `message:received`
- Assistant messages via `message:sent`

Both sides needed for meaningful memory extraction.

## When PR Merges

Once upstream PR #6384 merges:
1. Switch back to mainline OpenClaw: `npm install -g openclaw`
2. Restart gateway
3. Remove fork symlink if present
4. Hook should work identically

## Debugging

Check if hooks registered:
```bash
grep -i "registered hook\|engram" ~/.openclaw/logs/gateway.log | tail -20
```

Check recent captures:
```bash
curl -s http://localhost:3001/v1/memories \
  -H "X-AM-API-Key: your-key" \
  -H "X-AM-User-ID: Beaux" | jq '.memories[:3]'
```

---

*This integration is fragile until the upstream PR merges. Document any issues encountered.*
