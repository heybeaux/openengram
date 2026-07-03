# Engram Active Recall — Design Doc

**Author:** Rook ♜  
**Date:** 2026-02-04  
**Status:** Draft

## Problem

Currently, Engram injects memory context at session bootstrap via the `agent:bootstrap` hook. This works well for providing background context, but has limitations:

1. **Token budget constraints** — Only ~2000 tokens of memories are injected
2. **No query-specific recall** — The injected context is generic, not tailored to the current question
3. **No uncertainty handling** — If the agent is unsure about something, it can't actively search memories

**Example failure case:**
- User asks: "What's my favorite coffee?"
- Engram injected 35 memories at bootstrap, but coffee preference wasn't in the top results
- Agent says "I don't have that information" even though the memory exists

## Solution

Add an **Active Recall** mechanism that allows the agent to query Engram on-demand during a conversation.

## Design Options

### Option 1: OpenClaw Core Tool (Recommended for long-term)

Add a new tool `engram_recall` to OpenClaw core, similar to `memory_search`:

```typescript
// src/agents/tools/engram-tool.ts
export function createEngramRecallTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const engramConfig = options.config?.hooks?.internal?.entries?.engram?.env;
  if (!engramConfig?.ENGRAM_API_URL) {
    return null;
  }
  
  return {
    name: "engram_recall",
    description: "Query Engram memory database for specific information. Use when you need to recall facts about the user that may not be in your current context.",
    parameters: EngramRecallSchema,
    execute: async (_toolCallId, params) => {
      // Call Engram /v1/memories/query
    },
  };
}
```

**Pros:**
- Native integration
- Proper tool semantics
- Efficient token usage

**Cons:**
- Requires PR to OpenClaw core
- Longer timeline

### Option 2: Skill-based Recall (Recommended for now)

Create a skill that provides the recall capability:

```
skills/engram-recall/
├── SKILL.md
└── scripts/
    └── recall.sh
```

The skill would use the existing exec tool to call Engram:

```bash
# recall.sh
curl -s -X POST "$ENGRAM_API_URL/v1/memories/query" \
  -H "Content-Type: application/json" \
  -H "X-AM-API-Key: $ENGRAM_API_KEY" \
  -H "X-AM-User-ID: $ENGRAM_USER_ID" \
  -d "{\"query\": \"$1\", \"limit\": ${2:-5}}"
```

**Pros:**
- Works today, no core changes
- Fast iteration
- Self-contained

**Cons:**
- Slightly more verbose (exec overhead)
- Not as clean as native tool

### Option 3: Extend Engram Hook (Future consideration)

Hooks could potentially register tools, but this isn't currently supported by OpenClaw.

## Recommended Implementation

### Phase 1: Skill (Immediate)

1. Create `~/clawd/skills/engram-recall/SKILL.md` with usage instructions
2. Agent uses exec to call the skill's recall script
3. Works immediately, no external dependencies

### Phase 2: OpenClaw Tool (PR)

1. Propose `engram_recall` tool to OpenClaw
2. Tool reads config from `hooks.internal.entries.engram.env`
3. Returns structured memory results

## API Design

### Input
```json
{
  "query": "Beaux's coffee preference",
  "limit": 5,
  "layers": ["IDENTITY", "PROJECT"]  // optional filter
}
```

### Output
```json
{
  "memories": [
    {
      "id": "clx123",
      "raw": "Beaux cannot start the day without coffee. He absolutely must have coffee otherwise he will be in a bad mood.",
      "layer": "IDENTITY",
      "importance": 0.85,
      "extraction": {
        "who": "Beaux",
        "what": "must have coffee to start day",
        "why": "will be in bad mood without it"
      }
    }
  ],
  "count": 1,
  "queryTokens": 4
}
```

## Usage Guidelines

The agent should use recall when:
1. Asked about specific facts not in current context
2. Uncertain about user preferences
3. Need to verify something before acting
4. Cross-referencing prior decisions

The agent should NOT use recall for:
1. General conversation (context injection handles this)
2. Every single question (expensive)
3. Information already in injected context

## Implementation Plan

### Today
- [x] Research existing tool patterns (memory-tool.ts)
- [x] Design API interface
- [ ] Create skill for immediate use

### This Week
- [ ] Test skill-based recall
- [ ] Evaluate token efficiency
- [ ] Document trigger heuristics

### Future
- [ ] Propose OpenClaw core tool PR
- [ ] Add recall metrics to dashboard
- [ ] Explore auto-recall on low-confidence responses

## Questions to Resolve

1. **When to auto-recall vs explicit?** — Start with explicit (agent decides), consider auto later
2. **Rate limiting?** — Engram has internal limits, skill should respect them
3. **Caching?** — Same query in same session shouldn't re-fetch
4. **Feedback loop?** — Mark used memories after recall?

---

*This design enables Rook to actively search memories rather than only relying on bootstrap injection.*
