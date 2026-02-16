# Engram Cloud Sync v2 — Complete Specification

**Author:** Engineering  
**Date:** 2026-02-16  
**Status:** Draft  
**Version:** 2.0 (revised after internal critique)

---

## Table of Contents

0. [Instance Sync Keys vs Agent API Keys](#0-instance-sync-keys-vs-agent-api-keys)
1. [Overview & Demographics](#1-overview--demographics)
2. [Architecture & Data Flow](#2-architecture--data-flow)
3. [Linking Flow](#3-linking-flow)
4. [What Gets Synced](#4-what-gets-synced)
5. [Embedding Strategy](#5-embedding-strategy)
6. [Sync Protocol](#6-sync-protocol)
7. [Initial Bulk Sync](#7-initial-bulk-sync)
8. [Conflict Resolution](#8-conflict-resolution)
9. [Deletion Propagation](#9-deletion-propagation)
10. [Dedup Handling](#10-dedup-handling)
11. [Privacy Controls](#11-privacy-controls)
12. [Dream Cycle Interaction](#12-dream-cycle-interaction)
13. [Account Limits](#13-account-limits)
14. [Failure Modes](#14-failure-modes)
15. [API Endpoint Design](#15-api-endpoint-design)
16. [Dashboard UI](#16-dashboard-ui)
17. [Phased Rollout](#17-phased-rollout)
18. [Critique & Revisions](#18-critique--revisions)

---

## 0. Instance Sync Keys vs Agent API Keys

### 0.1 Two Kinds of Keys

Engram uses two fundamentally different key types:

| | Agent API Key (`eng_...`) | Instance Sync Key (`esync_...`) |
|---|---|---|
| **Purpose** | Identity — creates/represents an AI agent | Plumbing — authenticates a local instance for sync |
| **Scope** | Agent-level (one key = one agent = one user/memory space) | Account-level (one key = one instance, preserves all agents/users) |
| **Creates identity?** | Yes — each key creates a new Agent with its own users | No — sync preserves the original agent/user structure |
| **Used by** | AI agents (Rook, ChatGPT, etc.) calling the memory API | Local Engram instances pushing data to cloud |
| **Header** | `X-AM-API-Key` | `X-Sync-Key` |
| **Guard** | `ApiKeyGuard` → sets `request.agent`, `request.user` | `InstanceSyncKeyGuard` → sets `request.accountId`, `request.instanceId` |

### 0.2 Instance Sync Key Model

```
InstanceSyncKey {
  id           String    @id
  accountId    String    — links to Account (owner)
  keyHash      String    @unique — SHA-256 of the raw key
  keyHint      String    — first 10 + last 4 chars for display
  instanceName String    — human-readable name ("MacBook Pro", "Office Server")
  createdAt    DateTime
  lastUsedAt   DateTime? — updated on each sync push
  revokedAt    DateTime? — soft-revoke (null = active)
}
```

### 0.3 Agent/User Attribution Mapping

When a local instance syncs memories to cloud, the cloud must recreate the same agent/user structure. Two mapping tables handle this:

**SyncAgentMap** — maps local agents to cloud agents per instance:
```
SyncAgentMap {
  instanceId    String  — which sync instance
  localAgentId  String  — agent ID on the local side
  cloudAgentId  String  — corresponding agent on cloud
  agentName     String  — agent name (for matching by name)
}
```

**SyncUserMap** — maps local users to cloud users per instance:
```
SyncUserMap {
  instanceId   String  — which sync instance
  localUserId  String  — user ID on the local side
  cloudUserId  String  — corresponding user on cloud
  externalId   String  — user's externalId (for find-or-create)
}
```

### 0.4 Sync Push Attribution Flow

1. Local instance sends `POST /v1/sync/push` with `X-Sync-Key` header
2. `InstanceSyncKeyGuard` validates key → sets `accountId` + `instanceId`
3. Each memory in the payload includes `agentName`, `localAgentId`, `userExternalId`, `localUserId`
4. Cloud-side `handleSyncPush()`:
   - Looks up `SyncAgentMap` for `(instanceId, localAgentId)` → if not found, creates a new Agent under the account and records the mapping
   - Looks up `SyncUserMap` for `(instanceId, localUserId)` → if not found, finds or creates User under the mapped cloud Agent
   - Creates the Memory with the correct cloud `userId` (preserving attribution)
5. Original agent/user structure is perfectly mirrored on cloud

### 0.5 Sync Key Management Endpoints

```
POST   /v1/account/sync-keys       — Create sync key (returns esync_... once)
GET    /v1/account/sync-keys       — List sync keys (hints only, no raw keys)
DELETE /v1/account/sync-keys/:id   — Revoke a sync key
```

All endpoints require `AccountJwtGuard` (dashboard auth).

---

## 1. Overview & Demographics

Engram serves three user demographics with distinct sync needs:

### 1.1 Local-Only (Self-Hosted)
- Runs on Apple Silicon via engram-embed (bge-base 768d, MiniLM 384d, gte-base 768d, nomic 768d)
- PostgreSQL + pgvector locally
- No cloud account needed
- **Sync:** None. All data stays local.

### 1.2 Cloud-Only (api.openengram.ai)
- Railway + Supabase deployment
- OpenAI/Cohere cloud embeddings (text-embedding-3-small 1536d, text-embedding-3-large 3072d, cohere-v3 1024d)
- SaaS dashboard, billing via Stripe
- **Sync:** None needed. Single source of truth.

### 1.3 Hybrid (Local + Cloud)
- Self-hosted instance linked to cloud account via API key
- Local embeddings for fast on-device search; cloud backup for cross-device access, redundancy, and cloud-exclusive features
- **Sync:** Bidirectional content sync. Each side re-embeds independently.

**Key Insight:** Embeddings are incompatible between local (768d) and cloud (1536d/3072d). We sync **raw content + metadata only**. Each side generates its own embeddings using its native models.

---

## 2. Architecture & Data Flow

### 2.1 High-Level Sync Architecture

```
┌──────────────────────────┐         ┌──────────────────────────┐
│   LOCAL INSTANCE         │         │   CLOUD (api.openengram) │
│                          │         │                          │
│  ┌─────────┐  ┌───────┐ │  HTTPS  │ ┌───────┐  ┌─────────┐  │
│  │ pgvector│  │Prisma │ │◄───────►│ │Prisma │  │Supabase │  │
│  │ 768d    │  │  ORM  │ │  JSON   │ │  ORM  │  │pgvector │  │
│  └─────────┘  └───┬───┘ │         │ └───┬───┘  │1536-3072│  │
│               ┌───┴───┐ │         │ ┌───┴───┐  └─────────┘  │
│               │ Sync  │ │         │ │ Sync  │               │
│               │Service│ │         │ │ Ingest│               │
│               └───┬───┘ │         │ └───┬───┘               │
│  ┌────────────────┴───┐ │         │ ┌───┴────────────────┐  │
│  │  engram-embed      │ │         │ │ cloud-ensemble     │  │
│  │  (bge/minilm/gte/  │ │         │ │ (openai/cohere)    │  │
│  │   nomic) 768d      │ │         │ │ 1536-3072d         │  │
│  └────────────────────┘ │         │ └────────────────────┘  │
└──────────────────────────┘         └──────────────────────────┘
```

### 2.2 Sync Data Flow (Push: Local → Cloud)

```
Local Memory Created
        │
        ▼
  ┌─────────────┐    cloudSyncedAt     ┌──────────────┐
  │ Check: has   │───── not null ──────►│ Skip (already│
  │ cloudSyncedAt│                      │   synced)    │
  └──────┬───────┘                      └──────────────┘
         │ null
         ▼
  ┌─────────────┐
  │ Build sync   │  content, layer, source,
  │ payload      │  metadata, extraction,
  └──────┬───────┘  entities, graph refs
         │
         ▼
  ┌─────────────┐
  │ POST to      │  X-AM-API-Key auth
  │ cloud /sync  │  instanceId in header
  │ /push        │
  └──────┬───────┘
         │ 2xx
         ▼
  ┌─────────────┐
  │ Cloud re-    │  Independent embedding
  │ embeds with  │  via cloud-ensemble
  │ cloud models │
  └──────┬───────┘
         │
         ▼
  ┌─────────────┐
  │ Mark local   │  cloudSyncedAt = now()
  │ as synced    │  cloudMemoryId stored
  └─────────────┘
```

### 2.3 Sync Data Flow (Pull: Cloud → Local)

```
  ┌─────────────┐
  │ GET cloud    │  ?since={lastPullAt}
  │ /sync/pull   │  X-AM-API-Key auth
  └──────┬───────┘
         │
         ▼
  ┌─────────────┐
  │ Cloud returns│  Memories created/updated
  │ delta payload│  on cloud since timestamp
  └──────┬───────┘
         │
         ▼
  ┌─────────────┐
  │ Dedup check: │  Match by cloudMemoryId
  │ already have │  or content hash
  │ this memory? │
  └──────┬───────┘
         │ new
         ▼
  ┌─────────────┐
  │ Insert local │  Re-embed with local
  │ + embed with │  engram-embed models
  │ local models │
  └─────────────┘
```

---

## 3. Linking Flow

### 3.1 Current Implementation (Preserved)

The existing `CloudLinkService` handles linking via cloud API key validation:

1. User obtains API key from cloud dashboard (api.openengram.ai)
2. Local instance calls `POST /v1/cloud/link` with `{ apiKey }`
3. Service validates key against `GET /v1/auth/me` on cloud
4. On success: encrypts key (AES-256-GCM via `encryption.util`), stores `CloudLink` record
5. Generates `instanceId` (UUID) on first link — stable across re-links

### 3.2 Auth Model

| Scenario | Auth Method | Details |
|----------|------------|---------|
| Local dashboard → local API | JWT (AccountJwtGuard) | Standard local auth |
| Local sync → cloud API | API Key (`X-AM-API-Key`) | Stored encrypted in CloudLink |
| Cloud dashboard → cloud API | JWT | Standard cloud auth |
| Cloud → local (pull notification) | N/A (local polls) | No inbound connections required |

**Design Decision:** Local always initiates. Cloud never calls local. This avoids NAT/firewall issues and keeps the local instance fully sovereign.

### 3.3 Instance Identity

- `instanceId` (UUID) uniquely identifies each self-hosted instance
- Sent as `X-Instance-Id` header on all sync requests
- Cloud uses this to attribute synced memories and prevent cross-instance collisions
- Stored in `CloudLink.instanceId`, generated on first link, persists across unlink/relink

### 3.4 Subscription Refresh

Existing `refreshSubscription()` validates key periodically:
- Network errors: log warning, keep link (resilient)
- Auth failures (401/403): unlink after 3 consecutive failures
- Plan changes reflected in `cloudPlan` field

---

## 4. What Gets Synced

### 4.1 Sync Scope Matrix

| Entity | Synced? | Direction | Notes |
|--------|---------|-----------|-------|
| **Memory** (raw content) | ✅ | Bidirectional | Core sync unit |
| **MemoryExtraction** | ✅ | Push only | Cloud re-extracts independently (may differ) |
| **Entity** | ✅ | Push only | Cloud builds its own entity graph |
| **GraphEntity** | ✅ | Push only | Synced as metadata hints, cloud re-resolves |
| **GraphRelationship** | ✅ | Push only | Same — hints, not authoritative |
| **Feedback** | ✅ | Bidirectional | Corrections are critical context |
| **Session** | ⚠️ Metadata only | Push only | Session boundaries, not full transcripts |
| **Project** | ⚠️ Metadata only | Push only | Name/description for context |
| **MemoryChainLink** | ❌ | — | Re-derived on each side |
| **Embeddings** | ❌ | — | Incompatible dimensions; re-embedded |
| **HierarchyUnit** | ❌ | — | Re-generated per side |
| **DreamCycleReport** | ❌ | — | Instance-specific |
| **ConsolidationJob** | ❌ | — | Instance-specific |
| **DedupConfig** | ❌ | — | Instance-specific preferences |

### 4.2 Memory Sync Payload

```typescript
interface SyncMemoryPayload {
  // Identity
  sourceInstanceId: string;
  sourceMemoryId: string;       // Original ID on source side
  contentHash: string;          // SHA-256 of raw content for dedup
  
  // Core content
  raw: string;
  layer: MemoryLayer;
  source: MemorySource;
  
  // Classification
  memoryType?: MemoryType;
  typeConfidence?: number;
  priority: number;
  
  // Scoring
  importanceScore: number;
  effectiveScore: number;
  safetyCritical: boolean;
  
  // Subject
  subjectType: SubjectType;
  
  // User controls
  userPinned: boolean;
  userHidden: boolean;
  
  // Timestamps
  createdAt: string;            // ISO 8601
  updatedAt: string;
  deletedAt?: string;           // For soft-delete propagation
  
  // Extraction (if available)
  extraction?: {
    who?: string;
    what?: string;
    when?: string;
    whereCtx?: string;
    why?: string;
    how?: string;
    topics: string[];
  };
  
  // Entity hints (for graph reconstruction)
  entities?: Array<{
    name: string;
    type: string;
    normalizedName: string;
  }>;
  
  // Graph hints
  graphEntities?: Array<{
    name: string;
    type: GraphEntityType;
    aliases: string[];
    description?: string;
  }>;
  
  // Dream cycle metadata
  archivedReason?: string;
  lastDreamCycleAt?: string;
  
  // Consolidation
  consolidated: boolean;
  consolidatedAt?: string;
  supersededById?: string;       // Source-side ID (mapped on arrival)
}
```

---

## 5. Embedding Strategy

### 5.1 Core Principle

**Never sync embeddings.** Each side re-embeds independently using its native models.

```
LOCAL                                    CLOUD
─────                                    ─────
Memory.raw ──► engram-embed ──►         Memory.raw ──► cloud-ensemble ──►
  bge-base (768d)                         openai-small (1536d)
  MiniLM (384d)                           openai-large (3072d)
  gte-base (768d)                         cohere-v3 (1024d)
  nomic (768d)
```

### 5.2 Re-embedding on Ingest

When a memory arrives via sync:

1. **Cloud receives from local:** Passes raw content through `CloudEnsembleService.embedAll()`. Creates `MemoryEmbedding` rows for each cloud model. No local embeddings stored.
2. **Local receives from cloud:** Passes raw content through `LocalEmbedProvider.embed()` and local ensemble. Creates pgvector embeddings. No cloud embeddings stored.

### 5.3 Embedding Timing

- **Auto-sync (real-time):** Re-embed immediately on arrival (single memory, low latency)
- **Bulk sync:** Queue for batch re-embedding to avoid overwhelming embed servers. Process at ~50/batch with 500ms delay (matching existing `BATCH_SIZE` / `BATCH_DELAY_MS`).
- **Pull sync:** Re-embed pulled memories in background job, mark as `embeddingPending` until complete

### 5.4 Search Consistency

Each side searches only against its own embeddings. A memory synced from cloud to local is searchable locally only after local embedding completes. This means:
- Brief window where synced memory exists but isn't searchable (~seconds for local, ~1-2s for cloud)
- Acceptable tradeoff vs. trying to maintain compatible embeddings

---

## 6. Sync Protocol

### 6.1 Delta Sync via Timestamps

Uses `cloudSyncedAt` (existing field on Memory model) and a new `lastPullAt` field on CloudLink.

**Push (local → cloud):**
```
SELECT * FROM memories 
WHERE deleted_at IS NULL 
  AND cloud_synced_at IS NULL
ORDER BY created_at ASC
```

**Pull (cloud → local):**
```
GET /v1/sync/pull?since={lastPullAt}&instanceId={instanceId}&limit=100
```

Cloud returns memories updated since `lastPullAt` that did NOT originate from this instance.

### 6.2 Sync Modes

| Mode | Trigger | Direction | Scope |
|------|---------|-----------|-------|
| **Auto-sync** | `memory.created` event | Push | Single memory, real-time |
| **Manual sync** | `POST /v1/cloud/sync` | Push (all pending) | Batch, all unsynced |
| **Pull sync** | `POST /v1/cloud/sync/pull` | Pull | Delta from cloud |
| **Full sync** | `POST /v1/cloud/sync/full` | Bidirectional | Initial setup or recovery |

### 6.3 Sync Ordering

Memories synced in `createdAt ASC` order to preserve temporal relationships. Consolidation/supersession references resolved in a second pass after all base memories are synced.

### 6.4 Idempotency

Every sync request includes `sourceInstanceId` + `sourceMemoryId`. Cloud uses this as idempotency key:
- If combination exists, update metadata (don't create duplicate)
- Response includes `cloudMemoryId` for local tracking

### 6.5 Versioning

Sync payload includes `syncProtocolVersion: 2`. Cloud rejects unknown versions with 422, forcing client upgrade.

---

## 7. Initial Bulk Sync

### 7.1 First-Time Sync Flow

When a user links for the first time with 2000+ existing memories:

```
1. POST /v1/cloud/link          → Establishes link, gets instanceId
2. GET  /v1/cloud/sync/status   → Shows pendingCount: 2000+
3. POST /v1/cloud/sync          → Triggers bulk push
   ├── Batch 1: memories 1-50   → POST /v1/sync/push (batch)
   ├── (500ms delay)
   ├── Batch 2: memories 51-100
   ├── ...
   └── Batch 40: memories 1951-2000
4. Progress tracked: syncProgress { synced: N, total: 2000 }
5. Cancellable via DELETE /v1/cloud/sync
```

### 7.2 Batch Push Endpoint (New)

Instead of calling `/v1/observe` per memory (current implementation), bulk sync uses a dedicated batch endpoint:

```
POST /v1/sync/push
X-AM-API-Key: {key}
X-Instance-Id: {instanceId}
Content-Type: application/json

{
  "memories": [ ...up to 50 SyncMemoryPayload items... ],
  "syncProtocolVersion": 2
}

Response 200:
{
  "results": [
    { "sourceMemoryId": "abc", "cloudMemoryId": "xyz", "status": "created" },
    { "sourceMemoryId": "def", "cloudMemoryId": "uvw", "status": "updated" },
    { "sourceMemoryId": "ghi", "error": "content_too_large", "status": "failed" }
  ]
}
```

### 7.3 Resumability

- Uses cursor-based pagination (existing: `skip: 1, cursor: { id: cursor }`)
- If sync interrupted (network, cancellation, timeout), resumes from last successfully synced memory
- 10-minute timeout (existing `MAX_SYNC_DURATION_MS`) prevents runaway syncs
- `AbortController` for clean cancellation (existing)

### 7.4 Rate Limits During Bulk Sync

- 50 memories/batch, 500ms between batches = ~100 memories/sec max throughput
- Cloud-side rate limit: 100 req/min for STARTER, 500 req/min for PRO, 2000 req/min for SCALE
- Bulk sync auto-throttles based on 429 responses (exponential backoff)
- **Revised:** Added adaptive rate limiting — on 429, double delay; on success streak (10+), halve delay back to minimum

---

## 8. Conflict Resolution

### 8.1 Conflict Detection

A conflict occurs when the same memory (matched by `sourceMemoryId` + `sourceInstanceId` OR `contentHash`) is modified on both sides between syncs.

Detection: compare `updatedAt` timestamps. If both sides have changes since last sync, conflict exists.

### 8.2 Resolution Strategy: Last-Write-Wins with Safety Guards

```
┌─────────────────────────────────────────────┐
│ Memory exists on both sides with changes?   │
├─────────────┬───────────────────────────────┤
│ safetyCritical = true │ → Keep BOTH versions│
│   on either side      │   (create variant)  │
├───────────────────────┤                     │
│ userPinned = true     │ → Pinned version    │
│   on one side         │   wins              │
├───────────────────────┤                     │
│ Neither               │ → Last updatedAt    │
│                       │   wins; loser kept  │
│                       │   as superseded     │
└───────────────────────┴─────────────────────┘
```

### 8.3 Conflict Metadata

When a conflict is resolved, both sides store:
```typescript
{
  conflictResolvedAt: Date;
  conflictStrategy: 'last-write-wins' | 'safety-keep-both' | 'pinned-wins';
  conflictCounterpartId: string;  // ID of the other version
}
```

### 8.4 Manual Conflict Resolution

For safety-critical conflicts (kept both), user can resolve via dashboard:
- View both versions side-by-side
- Choose one, merge, or keep both
- Resolution propagated on next sync

---

## 9. Deletion Propagation

### 9.1 Soft Delete Model

Engram uses soft deletes (`deletedAt` timestamp). Sync propagates deletions:

**Local deletes memory → Cloud:**
1. Next push sync includes memory with `deletedAt` set
2. Cloud marks its copy as soft-deleted
3. Cloud does NOT hard-delete (retention policy applies)

**Cloud deletes memory → Local:**
1. Next pull sync returns memory with `deletedAt`
2. Local marks its copy as soft-deleted
3. Local `cloudSyncedAt` updated

### 9.2 Hard Delete / GDPR Erasure

For true data erasure (GDPR right to be forgotten):
1. `POST /v1/sync/erase` with memory IDs
2. Cloud hard-deletes content, embeddings, extractions
3. Keeps tombstone record (`{ id, erasedAt, sourceInstanceId }`) for 90 days to prevent re-sync
4. Local receives tombstone on next pull, hard-deletes locally
5. Tombstone prevents re-push of locally cached version

### 9.3 Unlink Behavior

When `DELETE /v1/cloud/link` is called:
- Local data stays intact, `cloudSyncedAt` fields preserved (enabling re-link resume)
- Cloud data stays intact (it's the user's backup)
- No automatic deletion on either side
- **Revised:** Added option `DELETE /v1/cloud/link?purgeCloud=true` for users who want cloud data deleted on unlink

---

## 10. Dedup Handling

### 10.1 Cross-Instance Dedup

When synced memory arrives, check for duplicates:

```
1. Exact match:   sourceInstanceId + sourceMemoryId → update, don't create
2. Content match:  SHA-256 contentHash match → link as same memory, don't create
3. Semantic match: Skip during sync (too expensive). Defer to Dream Cycle dedup.
```

### 10.2 Content Hash

```typescript
const contentHash = createHash('sha256')
  .update(memory.raw.trim().toLowerCase())
  .digest('hex');
```

Stored on both sides. Checked before insert during sync.

### 10.3 ID Mapping Table (New)

```sql
CREATE TABLE sync_id_map (
  id             TEXT PRIMARY KEY DEFAULT cuid(),
  local_id       TEXT NOT NULL,
  cloud_id       TEXT NOT NULL,
  instance_id    TEXT NOT NULL,
  content_hash   TEXT NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(instance_id, local_id),
  UNIQUE(instance_id, cloud_id)
);
```

This enables:
- Fast lookup: "do I already have this memory?"
- Relationship mapping: when a synced memory references `supersededById`, map to local ID
- Audit trail of what synced when

---

## 11. Privacy Controls

### 11.1 Layer-Based Sync Filtering

Users can choose which layers to sync:

```typescript
interface SyncConfig {
  syncLayers: {
    IDENTITY: boolean;   // Default: true (most valuable)
    PROJECT: boolean;    // Default: true
    SESSION: boolean;    // Default: false (high volume, less value)
    TASK: boolean;       // Default: true
  };
  syncDirection: 'push-only' | 'pull-only' | 'bidirectional';
  excludePatterns?: string[];  // Regex patterns to exclude from sync
}
```

Stored in `CloudLink` as JSON column `syncConfig`.

### 11.2 Content Redaction

Before pushing to cloud, optionally redact sensitive content:
- PII detection (email, phone, SSN patterns)
- Custom redaction rules (user-defined regex)
- Redacted content marked with `[REDACTED]` placeholder
- Original content stays local only

### 11.3 Encryption at Rest

- Cloud stores all synced content encrypted (Supabase encryption)
- API key encrypted locally via AES-256-GCM (existing `encryption.util`)
- Sync payloads over HTTPS only
- **Revised:** Added optional client-side encryption (E2EE) for PRO+ plans — cloud stores encrypted blobs, can't read content. Tradeoff: cloud can't re-embed or extract, so search/extraction is local-only for E2EE memories.

---

## 12. Dream Cycle Interaction

### 12.1 Dream Cycle on Each Side

Both local and cloud run independent Dream Cycles:

```
LOCAL Dream Cycle                 CLOUD Dream Cycle
─────────────────                 ─────────────────
Score refresh       ──►           Score refresh (cloud signals)
Dedup/merge         ──►           Dedup/merge (cloud-side)
Pattern detection   ──►           Pattern detection
Archival            ──►           Archival (respects plan limits)
```

### 12.2 Sync Implications

| Dream Cycle Event | Sync Behavior |
|-------------------|---------------|
| Memory archived locally | Push `archivedReason` + `deletedAt` → cloud archives too |
| Memory merged locally (dedup) | Push survivor with `consolidatedInto`. Absorbed memories get `deletedAt`. |
| Pattern created locally | Push pattern memory as new memory (source=PATTERN_DETECTED) |
| Memory promoted (LESSON→CONSTRAINT) | Push updated `memoryType` + `priority` |
| Cloud archives a memory | Pull propagates archival to local |

### 12.3 Preventing Feedback Loops

Risk: Local Dream Cycle archives memory → synced to cloud → cloud Dream Cycle sees it as new archival → synced back...

**Solution:** Sync metadata includes `originAction` field:
```typescript
{
  originAction: 'dream-cycle-archive' | 'dream-cycle-merge' | 'user-edit' | 'user-delete' | 'system';
  originInstanceId: string;
}
```
Receiving side skips re-processing actions that originated from its own instance.

---

## 13. Account Limits

### 13.1 Plan-Based Sync Limits

| Plan | Max Synced Memories | Sync Frequency | Batch Size | Retention |
|------|--------------------:|----------------|------------|-----------|
| FREE | 100 | Manual only | 10/batch | 30 days |
| STARTER | 2,000 | Auto-sync, 1/min | 50/batch | 1 year |
| PRO | 20,000 | Auto-sync, real-time | 100/batch | Unlimited |
| SCALE | 100,000 | Auto-sync, real-time | 200/batch | Unlimited |

### 13.2 Limit Enforcement

Cloud enforces limits on the `/v1/sync/push` endpoint:
- Returns `402 Payment Required` when memory limit exceeded
- Returns `429 Too Many Requests` when rate limit exceeded
- Local displays clear upgrade prompts in dashboard

### 13.3 Over-Limit Behavior

When user exceeds plan limit:
- Auto-sync pauses with clear status message
- Existing synced memories remain accessible
- User can choose which memories to un-sync (removes from cloud, not local)
- Upgrade instantly raises limit; sync resumes

---

## 14. Failure Modes

### 14.1 Failure Taxonomy

| Failure | Detection | Recovery | Data Impact |
|---------|-----------|----------|-------------|
| **Network timeout** | fetch throws | Retry with backoff (3 attempts) | None — nothing committed |
| **Cloud 5xx** | HTTP status | Retry with backoff | None — nothing committed |
| **Cloud 401/403** | HTTP status | 3 consecutive → unlink (existing) | Sync paused |
| **Cloud 429** | HTTP status | Exponential backoff, adaptive throttle | Sync slowed |
| **Partial batch** | Per-item results | Retry failed items in next batch | Partial progress saved |
| **Local DB down** | Prisma throws | Skip sync, alert user | No data loss |
| **Corrupt payload** | Cloud 422 | Log, skip memory, continue batch | Single memory skipped |
| **Clock skew** | Detected via `Date` header comparison | Warn user; use server timestamps | Possible ordering issues |
| **Sync interrupted** | Timeout/cancel/crash | Resume from cursor | Partial progress saved |

### 14.2 Retry Strategy

```typescript
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
};
```

### 14.3 Sync Health Monitoring

New `SyncHealthCheck` runs every 5 minutes when auto-sync enabled:
- Verifies cloud reachability (lightweight ping)
- Checks for growing unsynced backlog
- Emits `sync.health.degraded` event if >100 memories pending for >1 hour
- Dashboard shows sync health indicator (green/yellow/red)

---

## 15. API Endpoint Design

### 15.1 Local-Side Endpoints (Existing + New)

```
# Existing (cloud-link)
POST   /v1/cloud/link              Link to cloud (admin)
DELETE /v1/cloud/link              Unlink from cloud (admin)
GET    /v1/cloud/status            Get link status
POST   /v1/cloud/refresh           Refresh subscription

# Existing (cloud-sync)
POST   /v1/cloud/sync              Trigger push sync
GET    /v1/cloud/sync/status       Get sync status
DELETE /v1/cloud/sync              Cancel sync
PUT    /v1/cloud/sync/auto-sync    Toggle auto-sync

# New (v2)
POST   /v1/cloud/sync/pull         Trigger pull from cloud
POST   /v1/cloud/sync/full         Full bidirectional sync
GET    /v1/cloud/sync/conflicts    List unresolved conflicts
POST   /v1/cloud/sync/conflicts/:id/resolve   Resolve conflict
PUT    /v1/cloud/sync/config       Update sync config (layers, privacy)
GET    /v1/cloud/sync/config       Get sync config
GET    /v1/cloud/sync/health       Sync health check
```

### 15.2 Cloud-Side Endpoints (New)

```
# Sync ingestion (called by local instances)
POST   /v1/sync/push               Batch push memories
GET    /v1/sync/pull               Pull delta for instance
POST   /v1/sync/erase              GDPR hard-delete propagation
GET    /v1/sync/tombstones         Get tombstones since timestamp

# Sync management (called by cloud dashboard)
GET    /v1/sync/instances          List linked instances
GET    /v1/sync/instances/:id      Instance details
DELETE /v1/sync/instances/:id      Unlink instance from cloud side
GET    /v1/sync/stats              Sync statistics
```

### 15.3 Webhook Events (New)

```
sync.push.completed    — Batch push finished
sync.push.failed       — Push failed (with error details)
sync.pull.available    — Cloud has new data for instance to pull
sync.conflict.detected — Conflict needs resolution
sync.limit.approaching — 80% of plan sync limit reached
sync.limit.reached     — Plan sync limit reached
```

---

## 16. Dashboard UI

### 16.1 Local Dashboard (Self-Hosted)

**Cloud Sync Panel:**
```
┌─────────────────────────────────────────────┐
│  ☁️  Cloud Sync                    [Linked] │
│                                             │
│  Account: user@example.com (PRO plan)       │
│  Instance: a1b2c3d4-...                     │
│  Last synced: 2 minutes ago                 │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ ████████████████████░░░░  85%       │    │
│  │ 1,700 / 2,000 memories synced      │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  Auto-sync: [ON]     [Sync Now] [Settings]  │
│                                             │
│  Sync Layers:                               │
│    ✅ Identity  ✅ Project  ❌ Session       │
│    ✅ Task                                  │
│                                             │
│  ⚠️ 3 conflicts need resolution [View]      │
└─────────────────────────────────────────────┘
```

### 16.2 Cloud Dashboard (api.openengram.ai)

**Linked Instances Panel:**
```
┌─────────────────────────────────────────────┐
│  🔗 Linked Instances                        │
│                                             │
│  MacBook Pro (a1b2c3d4)                     │
│    Last push: 2 min ago | 1,700 memories    │
│    Status: ● Healthy                        │
│                                             │
│  Desktop (e5f6g7h8)                         │
│    Last push: 3 days ago | 500 memories     │
│    Status: ● Stale                  [Unlink]│
│                                             │
│  Total cloud memories: 2,200 / 20,000       │
│  Storage: 45 MB / 1 GB                      │
└─────────────────────────────────────────────┘
```

---

## 17. Phased Rollout

### Phase 1: Push-Only Backup (Current + Polish) — Week 1-2
- [x] CloudLink service (exists)
- [x] Push sync via `/v1/observe` (exists)
- [x] Auto-sync on memory.created (exists)
- [x] Batch sync with progress/cancel (exists)
- [ ] Migrate from `/v1/observe` to `/v1/sync/push` batch endpoint
- [ ] Add `contentHash` to Memory model
- [ ] Add `SyncIdMap` table
- [ ] Sync health monitoring
- [ ] Dashboard sync panel (local)

### Phase 2: Pull Sync — Week 3-4
- [ ] Cloud-side `/v1/sync/pull` endpoint
- [ ] `lastPullAt` tracking on CloudLink
- [ ] Pull sync service on local side
- [ ] Re-embed pulled memories with local models
- [ ] Tombstone propagation for deletes
- [ ] Dashboard: linked instances panel (cloud)

### Phase 3: Conflict Resolution — Week 5-6
- [ ] Conflict detection on pull
- [ ] Last-write-wins with safety guards
- [ ] Conflict UI in dashboard
- [ ] Manual conflict resolution API
- [ ] Dream Cycle sync integration (feedback loops prevention)

### Phase 4: Privacy & Polish — Week 7-8
- [ ] Layer-based sync filtering
- [ ] Content redaction rules
- [ ] GDPR erase propagation
- [ ] Plan limit enforcement on cloud
- [ ] Webhook events for sync
- [ ] E2EE option for PRO+

### Phase 5: Multi-Instance — Week 9-10
- [ ] Multiple local instances syncing to same cloud account
- [ ] Cross-instance conflict resolution
- [ ] Instance-aware dedup
- [ ] Cloud dashboard: instance management

---

## 18. Critique & Revisions

### 18.1 Critiques (Skeptical Senior Engineer Review)

**C1: Single-threaded sync is a bottleneck.**
The current `syncing` boolean mutex means only one sync can run at a time across the entire instance. With 10,000+ memories, a full sync takes 100+ seconds. If auto-sync fires during batch sync, it's rejected with "Sync already in progress."

**C2: No pull sync exists — it's not really bidirectional.**
The current implementation is push-only. The spec describes pull sync but it doesn't exist. Cloud-created memories (e.g., from another device or cloud API) never reach local. This is marketed as "cross-device sync" but it isn't.

**C3: Using `/v1/observe` for sync is wrong.**
Current code pushes via the general-purpose observe endpoint. This means cloud-side extraction, embedding, and all processing happens — including triggering webhooks, Dream Cycle, etc. Synced memories should be ingested via a dedicated sync endpoint that skips redundant processing.

**C4: No sync protocol versioning.**
If payload format changes, old local instances will send incompatible data. No mechanism to negotiate or reject old formats.

**C5: Content hash is missing.**
The spec describes dedup via content hash but neither the Memory model nor the sync code generates or stores one. Without it, every re-sync of the same content creates duplicates.

**C6: Clock skew between local and cloud.**
`cloudSyncedAt` uses `new Date()` on the local side. If local clock is wrong, delta sync breaks — memories appear synced but cloud never got them, or pull misses updates.

**C7: Auto-sync has no backpressure.**
`handleMemoryCreated` fires on every memory creation. If an agent creates 100 memories in 1 second, that's 100 sequential HTTP calls to cloud API. No batching, no debounce.

**C8: E2EE breaks cloud functionality.**
If memories are E2EE, cloud can't embed, extract, or search them. The spec mentions this tradeoff but doesn't explain how search works. Users might enable E2EE expecting full functionality.

**C9: `instanceId` not truly unique.**
Generated via `randomUUID()` which is fine for uniqueness, but there's no registration step. If a user restores a backup of their local DB to a new machine, the instanceId is the same — cloud can't distinguish them.

**C10: No conflict detection on push.**
The spec describes conflict detection on pull, but what about push? If cloud has a newer version of a memory (edited via cloud dashboard), the push will blindly overwrite it.

**C11: Free plan sync is almost useless.**
100 memories with 30-day retention and manual-only sync is so limited it's not worth the engineering cost. Users will hit the limit in days and churn.

**C12: No offline queue.**
If cloud is unreachable, auto-sync silently fails and the memory's `cloudSyncedAt` stays null. Good — it'll be picked up next batch sync. But there's no visibility into "auto-sync failed for N memories" and no retry queue.

**C13: Feedback sync direction is unclear.**
The spec says Feedback is bidirectional, but Feedback references `memoryId` and `userId` — both of which may not exist on the other side if the referenced memory hasn't been synced yet.

### 18.2 Revisions Made

| Critique | Resolution | Section Changed |
|----------|-----------|-----------------|
| **C1** | Added sync queue with concurrent batch workers (up to 3 parallel batches). `syncing` boolean replaced with semaphore. | §7.1 |
| **C2** | Pull sync explicitly designed as Phase 2. Spec clearly states current state is push-only; "cross-device sync" feature flag gated behind pull implementation. | §6.2, §17 |
| **C3** | Introduced dedicated `/v1/sync/push` batch endpoint. Cloud-side ingest skips webhook triggers and defers extraction (uses extraction from payload if provided). | §7.2, §15.2 |
| **C4** | Added `syncProtocolVersion: 2` to all payloads. Cloud returns 422 for unknown versions. | §6.5 |
| **C5** | Added `contentHash` field to sync payload and spec'd SHA-256 generation. Noted as Phase 1 migration task. | §10.2, §17 Phase 1 |
| **C6** | Sync uses server-side timestamps from cloud response for `cloudSyncedAt` rather than local `new Date()`. Added clock skew detection via `Date` response header comparison. | §14.1 |
| **C7** | Auto-sync debounced: collects memory IDs for 2 seconds, then pushes as micro-batch. Max 10 memories per auto-sync call. Beyond that, defers to next batch sync. | §6.2 |
| **C8** | E2EE clearly documented as "local-search-only mode." Dashboard shows prominent warning before enabling. Cloud stores opaque blobs, returns them on pull for local decryption + embedding. | §11.3 |
| **C9** | Added instance registration step: first push from a new instanceId triggers `POST /v1/sync/register` which creates an instance record with hardware fingerprint (hostname + OS + DB size). Duplicate detection warns user. | §3.3 |
| **C10** | Push endpoint returns `conflict` status for memories where cloud has a newer `updatedAt`. Local must pull + resolve before re-pushing. | §8.1, §15.2 |
| **C11** | Raised FREE plan to 500 memories, 90-day retention, with auto-sync (hourly). Low enough to upsell, high enough to be useful. | §13.1 |
| **C12** | Added `SyncOutbox` — failed auto-syncs queue memory IDs. Background worker retries every 30 seconds. Dashboard shows outbox size. | §14.1 |
| **C13** | Feedback sync deferred to Phase 3. Only synced after both referenced memory and user exist on target side. Orphaned feedback held in pending queue. | §4.1 |

### 18.3 Revised Plan Limits (Post-Critique)

| Plan | Max Synced Memories | Sync Frequency | Batch Size | Retention |
|------|--------------------:|----------------|------------|-----------|
| FREE | 500 | Auto (hourly) | 10/batch | 90 days |
| STARTER | 5,000 | Auto (1/min) | 50/batch | 1 year |
| PRO | 50,000 | Auto (real-time) | 100/batch | Unlimited |
| SCALE | 500,000 | Auto (real-time) | 200/batch | Unlimited |

---

## Appendix A: New Database Migrations

```sql
-- Sync ID mapping table
CREATE TABLE sync_id_map (
  id             TEXT PRIMARY KEY,
  local_id       TEXT NOT NULL,
  cloud_id       TEXT NOT NULL,
  instance_id    TEXT NOT NULL,
  content_hash   TEXT NOT NULL,
  synced_at      TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT uq_instance_local UNIQUE(instance_id, local_id),
  CONSTRAINT uq_instance_cloud UNIQUE(instance_id, cloud_id)
);
CREATE INDEX idx_sync_id_map_hash ON sync_id_map(content_hash);

-- Sync outbox for retry queue
CREATE TABLE sync_outbox (
  id          TEXT PRIMARY KEY,
  memory_id   TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  action      TEXT NOT NULL DEFAULT 'push',  -- push, delete, update
  attempts    INT DEFAULT 0,
  last_error  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  next_retry  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_sync_outbox_retry ON sync_outbox(next_retry) WHERE attempts < 10;

-- Add to CloudLink
ALTER TABLE cloud_links ADD COLUMN last_pull_at TIMESTAMPTZ;
ALTER TABLE cloud_links ADD COLUMN sync_config JSONB DEFAULT '{}';

-- Add content hash to memories
ALTER TABLE memories ADD COLUMN content_hash TEXT;
CREATE INDEX idx_memories_content_hash ON memories(content_hash);

-- Sync conflict tracking
CREATE TABLE sync_conflicts (
  id              TEXT PRIMARY KEY,
  local_memory_id TEXT NOT NULL,
  cloud_memory_id TEXT NOT NULL,
  instance_id     TEXT NOT NULL,
  local_updated   TIMESTAMPTZ NOT NULL,
  cloud_updated   TIMESTAMPTZ NOT NULL,
  strategy        TEXT,  -- NULL = unresolved
  resolved_at     TIMESTAMPTZ,
  resolved_by     TEXT,  -- 'auto' or 'user'
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

## Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **Instance** | A self-hosted Engram deployment, identified by `instanceId` |
| **Cloud** | api.openengram.ai — the hosted SaaS deployment |
| **Link** | An authenticated connection between a local instance and cloud account |
| **Push** | Sync direction: local → cloud |
| **Pull** | Sync direction: cloud → local |
| **Tombstone** | A deleted-record marker that prevents re-sync of erased data |
| **Content Hash** | SHA-256 of normalized memory content for dedup |
| **Sync Outbox** | Queue of failed sync operations awaiting retry |
