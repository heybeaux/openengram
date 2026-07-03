# Context Contamination: Cross-Project Memory Bleed

**Status:** Open — Design Proposal  
**Priority:** HIGH  
**Date:** 2026-02-05  
**Related:** Brain Fog risk (memory/2026-02-04.md), Deduplication (P2-001)

---

## Problem Statement

Engram injects memories into agent context based on semantic similarity alone. When a user works across multiple projects, memories from Project A can bleed into sessions focused on Project B, causing the agent to take actions in the wrong context.

This is distinct from the "Brain Fog" problem (too many/stale memories degrading quality). Cross-contamination actively **misleads** the agent into incorrect actions.

## Real-World Incident (2026-02-05)

While working on community standards for the Engram repo, the agent's injected context included WhaleHawk memories (Salesforce schemas, healthcare compliance, etc.). The agent, confused by the mixed context, committed WhaleHawk-related content to the Engram repository. The session had to be wiped and the commit reverted.

**Chain of failure:**
1. User asks agent to create community standards docs for Engram
2. Engram hook fires at bootstrap, queries `/v1/context` for relevant memories
3. Semantic search returns memories about "schemas," "architecture," "standards" — many from WhaleHawk
4. Agent receives mixed context: Engram project files + WhaleHawk memories
5. Agent conflates the two, includes WhaleHawk content in Engram deliverables
6. Wrong content pushed to public repo

## Why Semantic Search Alone Is Insufficient

Semantic similarity is context-blind. Consider these queries and what they'd match:

| Query | Intended Project | Also Matches |
|-------|-----------------|--------------|
| "database schema design" | Engram | WhaleHawk Prisma schemas |
| "API architecture" | Engram | WhaleHawk NestJS controllers |
| "security policy" | Engram | WhaleHawk HIPAA compliance |
| "testing patterns" | UltraEdge | WhaleHawk test suites |

The more projects a user works on, the worse this gets.

## Proposed Solutions

### Option 1: Project Namespacing (Recommended)

Add a `projectId` or `namespace` field to memories. Filter by namespace during retrieval.

**Memory creation:**
```typescript
// At extraction time, tag the memory with its project context
{
  content: "Prisma schema uses SfConnection model for Salesforce integration",
  namespace: "whalehawk",  // derived from repo, cwd, or explicit tag
  layer: "PROJECT",
  // ...
}
```

**Memory retrieval:**
```typescript
// At query time, filter by current project
POST /v1/context
{
  "query": "database schema",
  "agentId": "rook",
  "namespace": "engram",        // only return engram memories
  "includeGlobal": true         // still include IDENTITY/PREFERENCE layers
}
```

**Namespace detection strategies:**
- Git repo name from `cwd` (most reliable for coding tasks)
- Explicit tag from agent (e.g., "working on Engram today")
- Hook config: map session patterns to namespaces
- Fallback: unnamespaced memories treated as global

**Which layers should be namespaced?**
- `PROJECT` — always namespaced
- `SESSION` — namespaced (session context is project-specific)
- `TASK` — namespaced (tasks belong to projects)
- `IDENTITY` — never namespaced (user preferences are global)
- `PREFERENCE` — rarely namespaced (some prefs are project-specific)
- `FACT` — case-by-case (some facts are global, some project-specific)
- `CONSTRAINT` — never namespaced (constraints like "never deploy on Friday" are universal)

### Option 2: Retrieval-Time Project Boost/Penalty

Don't change the schema — instead, boost memories tagged with the current project and penalize others at retrieval time.

```typescript
// Adjust effective scores during retrieval
const adjustedScore = memory.namespace === currentProject
  ? memory.effectiveScore * 1.5   // boost same-project
  : memory.effectiveScore * 0.3;  // penalize cross-project
```

**Pros:** No migration needed, soft boundary (cross-project memories still available if highly relevant)  
**Cons:** Doesn't prevent contamination, just reduces likelihood

### Option 3: Agent-Side Filtering (Cheapest)

Include project context in the injected memory block header so the agent can self-filter:

```markdown
## Memory Context
**Current project: engram (~/projects/agent-memory/engram)**
**Note: Some memories below may reference other projects. Only use memories relevant to the current task.**

- [engram] Memory Intelligence uses effectiveScore for ranking
- [whalehawk] Prisma schema has SfConnection for Salesforce  ← agent should ignore
- [global] Beaux prefers specs before code
```

**Pros:** Zero backend changes  
**Cons:** Uses tokens on irrelevant memories, relies on agent judgment (which already failed)

## Recommendation

**Start with Option 3 (immediate) + build toward Option 1 (proper fix).**

Option 3 can ship today — just add project labels to injected memories and a header telling the agent what project it's in. This buys time while Option 1 (namespace field + filtered retrieval) is built properly.

Option 2 is a middle ground if Option 1 is too much work, but it doesn't solve the root cause.

## Implementation Plan

### Phase 1: Agent-Side Labels (This Week)
- [ ] Add `namespace` field to memory extraction prompt
- [ ] Include project labels in injected context block
- [ ] Add header with current project context to bootstrap injection

### Phase 2: Schema + Retrieval (Next Sprint)
- [ ] Add `namespace` column to Memory model (nullable, for backward compat)
- [ ] Backfill existing memories with namespace (LLM-assisted classification)
- [ ] Add `namespace` filter to `/v1/context` and `/v1/memories/query`
- [ ] Update OpenClaw hook to pass current project namespace
- [ ] Update layer budget logic: global layers unaffected, project layers filtered

### Phase 3: Namespace Detection (Future)
- [ ] Auto-detect namespace from git repo in cwd
- [ ] Session-level namespace pinning ("working on X today")
- [ ] Namespace management API (list, merge, rename)

## Success Criteria

- Agent working on Engram receives zero WhaleHawk-specific memories
- Global memories (preferences, identity, constraints) still injected regardless of project
- No increase in retrieval latency (namespace filter should be indexed)
- Backfill correctly classifies >90% of existing memories

## Risk: Over-Isolation

Don't make namespaces too rigid. Cross-project knowledge IS sometimes valuable:
- "We used this pattern in WhaleHawk, let's do the same in Engram"
- Shared infrastructure decisions
- User preferences that span projects

The `includeGlobal` flag and layer-based namespacing rules handle this — IDENTITY/CONSTRAINT/PREFERENCE layers are always available.

---

*Created: 2026-02-05 by Rook*  
*Triggered by: WhaleHawk→Engram cross-contamination incident*
