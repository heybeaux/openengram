# Delegation Task API — Spec

**Ticket**: HEY-333 (Dogfood Engram for agent coordination)
**Author**: Rook
**Date**: 2026-02-24
**Status**: Draft — awaiting Kit's feedback

---

## Problem

The engram-delegation plugin fires correctly on every sub-agent bootstrap and completion, but the backend has no endpoints to:
1. Store task completions when sub-agents finish
2. Query historical task data for context injection
3. Aggregate delegation context (contracts + tasks + patterns) into a single recall response

The plugin calls three endpoints that don't exist:
- `GET /v1/identity/delegation/recall` → aggregated context for sub-agent prompt injection
- `GET /v1/identity/delegation/tasks` → task completion history
- `POST /v1/identity/delegation/tasks` → log a task completion

## Existing Infrastructure

**What we have:**
- `DelegationContractService` — in-memory Map with file persistence (HEY-346), CRUD via `/v1/identity/contracts`
- `FailurePatternService` — in-memory array, detects patterns from contract outcomes, no API endpoint
- `ChallengeService` — in-memory Map with file persistence
- `FileStoreService` — generic JSON-to-disk persistence (from HEY-346)

**What's missing:**
- Task completion storage (separate from contracts — lightweight, high-volume)
- Recall aggregation endpoint
- Failure pattern query endpoint

## Proposed Endpoints

### 1. `POST /v1/identity/delegation/tasks`

Log a task completion. Called by the plugin's `subagent_ended` handler.

**Request:**
```json
{
  "sessionKey": "agent:main:subagent:uuid",
  "parentSessionKey": "agent:main:main",
  "agentId": "rook",
  "task": "Implement async batch endpoint for Engram backend",
  "status": "success" | "failure" | "timeout",
  "durationMs": 10353,
  "error": null,
  "metadata": {
    "model": "claude-sonnet-4-20250514",
    "tokensUsed": 4200,
    "toolCalls": 12
  }
}
```

**Response:** `201 Created`
```json
{
  "id": "task_uuid",
  "createdAt": "2026-02-24T23:16:28.000Z"
}
```

**Storage:** File-based via FileStoreService (`delegation-tasks.json`). Array of task records, capped at 1000 (FIFO eviction). No Prisma migration needed.

### 2. `GET /v1/identity/delegation/tasks`

Query task completion history.

**Query params:**
- `agentId` (optional) — filter by agent
- `status` (optional) — filter by outcome (success/failure/timeout)
- `limit` (optional, default 20, max 100)
- `since` (optional) — ISO timestamp, only tasks after this time

**Response:**
```json
{
  "tasks": [
    {
      "id": "task_uuid",
      "sessionKey": "agent:main:subagent:uuid",
      "agentId": "rook",
      "task": "Implement async batch endpoint",
      "status": "success",
      "durationMs": 10353,
      "error": null,
      "createdAt": "2026-02-24T23:16:28.000Z"
    }
  ],
  "total": 42
}
```

### 3. `GET /v1/identity/delegation/recall`

Aggregated delegation context for sub-agent prompt injection. This is the main endpoint the plugin calls during `agent:bootstrap`.

**Query params:**
- `agentId` (required) — which agent is being bootstrapped
- `task` (optional) — the sub-agent's task description, used for semantic matching
- `limit` (optional, default 5) — max items per category

**Response:**
```json
{
  "contracts": [
    {
      "id": "contract_uuid",
      "task": "Review PR #36",
      "status": "completed",
      "result": "success",
      "delegator": "beaux",
      "delegatee": "rook",
      "completedAt": "2026-02-24T20:00:00.000Z"
    }
  ],
  "tasks": [
    {
      "id": "task_uuid",
      "task": "Implement async batch endpoint",
      "status": "success",
      "durationMs": 10353,
      "createdAt": "2026-02-24T23:16:28.000Z"
    }
  ],
  "patterns": [
    {
      "pattern": "Sub-agents fail when modifying >5 files",
      "count": 3,
      "lastSeen": "2026-02-24T22:00:00.000Z",
      "suggestedFix": "Break into smaller tasks"
    }
  ],
  "summary": {
    "totalTasks": 42,
    "successRate": 0.85,
    "avgDurationMs": 8500,
    "commonFailures": ["context overflow", "test failures"]
  }
}
```

**Logic:**
1. Get recent contracts from `DelegationContractService.getContracts(agentId)` 
2. Get recent tasks from `DelegationTaskService.getTasks({ agentId, limit })`
3. Get detected patterns from `FailurePatternService.getPatterns()`
4. Compute summary stats from task history
5. If `task` param provided, optionally boost relevance of similar past tasks (future: semantic search)

### 4. `GET /v1/identity/delegation/patterns`

Query detected failure patterns. Exposes the existing `FailurePatternService` data.

**Response:**
```json
{
  "patterns": [
    {
      "pattern": "Sub-agents fail when modifying >5 files",
      "count": 3,
      "lastSeen": "2026-02-24T22:00:00.000Z",
      "suggestedFix": "Break into smaller tasks"
    }
  ]
}
```

## New Service: `DelegationTaskService`

**Location:** `src/identity/delegation-task.service.ts`

**Responsibilities:**
- Store task completions (file-based via FileStoreService)
- Query with filters (agentId, status, since, limit)
- Compute summary stats (success rate, avg duration, common failures)
- FIFO eviction at 1000 records
- Feed into FailurePatternService for pattern detection

**Interface:**
```typescript
interface TaskCompletion {
  id: string;
  sessionKey: string;
  parentSessionKey?: string;
  agentId: string;
  task: string;
  status: 'success' | 'failure' | 'timeout';
  durationMs: number;
  error?: string;
  metadata?: Record<string, any>;
  createdAt: string;
}
```

## New Controller: `DelegationController`

**Location:** `src/identity/delegation.controller.ts`

Separate from `IdentityController` to keep it focused. Routes under `/v1/identity/delegation/`.

**Guard:** `ApiKeyOrJwtGuard` (same as other identity endpoints)

## Plugin Updates

Once endpoints exist, update `~/clawd/.openclaw/extensions/engram-delegation/index.ts`:
1. Compile to `.js` so OpenClaw actually loads it (currently only `.ts` exists)
2. Or: update the built-in engram plugin in the OpenClaw fork to call these endpoints

**Note from diagnostic:** The `.ts` extension isn't loaded — the running code is the built-in engram plugin compiled into the OpenClaw fork (`dist/entry.js`). Need to decide: extend the built-in plugin, or fix the extension loading.

## Implementation Plan

1. Create `DelegationTaskService` with file persistence + FIFO eviction
2. Create `DelegationController` with all 4 endpoints
3. Wire into `IdentityModule`
4. Add tests (task CRUD, recall aggregation, pattern query, FIFO eviction)
5. Update plugin to call correct endpoints + compile to `.js`
6. Test end-to-end: spawn sub-agent → check DELEGATION_CONTEXT.md injected

**Estimated effort:** ~2 hours (service + controller + tests + plugin fix)

## Open Questions

1. **File-based vs Prisma?** File persistence avoids migrations but doesn't survive across Railway deploys (ephemeral filesystem). For cloud, tasks should eventually go to Prisma. Start with file for local, plan Prisma migration later.
2. **Pattern detection trigger:** Should `DelegationTaskService.logTask()` automatically call `FailurePatternService.analyze()` on every failure? Or batch-analyze periodically?
3. **Semantic task matching:** The `recall` endpoint could use Engram's semantic search to find similar past tasks. Worth it now or future enhancement?
4. **Extension vs built-in plugin:** Which approach for the OpenClaw hook — fix extension loading or update the fork's built-in plugin?

---

*Spec by Rook. Awaiting Kit's review before implementation.*
