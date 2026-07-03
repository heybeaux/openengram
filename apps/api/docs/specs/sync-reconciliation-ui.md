# Engram Sync & Reconciliation UI — Spec

**Author:** Claude (subagent) · **Date:** 2025-02-20 · **Status:** Draft

---

## 1. Overview

### Purpose

Provide a UI for Engram users to:
1. **Connect** a local (self-hosted) instance to OpenEngram Cloud
2. **Manage** bidirectional sync (push/pull) between local and cloud stores
3. **Reconcile** diverged memory stores when a local instance is linked to a cloud account that already has data (different user/agent IDs, overlapping content)

### Target Users

- **Self-hosted operators**: running Engram locally, wanting cloud backup/sync
- **Multi-device users**: running Engram on multiple machines, needing a unified memory store
- **Re-linking users**: reconnecting after a disconnect, needing to reconcile diverged stores

### Context

Today, the existing `/settings/cloud` page (at `(dashboard)/settings/cloud/page.tsx`) already handles:
- Cloud link/unlink flow
- Push/pull sync with progress
- Auto-sync toggle
- Sync history
- Cloud instance listing (cloud edition)

This spec extends the existing page and adds two new pages: **Sync Status** and **Reconciliation**.

---

## 2. Architecture: Existing API Surface

From `cloud-sync.controller.ts` and `cloud-link.controller.ts`:

| Endpoint | Method | Purpose |
|---|---|---|
| `POST /v1/cloud/link` | Link instance to cloud (accepts `apiKey`) |
| `DELETE /v1/cloud/link` | Unlink instance |
| `GET /v1/cloud/status` | Cloud link status (`linked`, `plan`, `email`) |
| `POST /v1/cloud/refresh` | Re-validate cloud API key |
| `POST /v1/cloud/sync` | Trigger push sync |
| `DELETE /v1/cloud/sync` | Cancel in-progress sync |
| `GET /v1/cloud/sync/status` | Sync status (`pendingCount`, `syncing`, `progress`) |
| `PUT /v1/cloud/sync/auto-sync` | Toggle auto-sync |
| `GET /v1/cloud/sync/history` | Last N sync events |
| `POST /v1/cloud/sync/pull` | Pull memories from cloud |
| `GET /v1/sync/instances` | List connected instances (cloud-side) |

### New Endpoints Needed

| Endpoint | Method | Purpose |
|---|---|---|
| `GET /v1/cloud/reconcile/preview` | Preview reconciliation (counts) |
| `POST /v1/cloud/reconcile` | Execute reconciliation |
| `GET /v1/cloud/reconcile/status` | Poll reconciliation progress |
| `GET /v1/cloud/identity-map` | Get agent/user identity mappings |
| `GET /v1/cloud/sync/errors` | Get recent sync errors (detailed) |

---

## 3. Pages & Components

### 3.1 Settings: Cloud Connection (`/settings/cloud`)

> **Status: Mostly exists.** Enhancements needed for sync key display, better wizard UX, and linking to new sub-pages.

#### 3.1.1 User Stories

- **US-1**: As a self-hosted user, I can enter my cloud API key and link my instance in under 30 seconds.
- **US-2**: As a linked user, I can see my connection status (account email, plan, last verified, sync key status) at a glance.
- **US-3**: As a linked user, I can unlink my instance with a confirmation dialog that explains consequences.
- **US-4**: As a linked user, I can toggle auto-sync on/off.
- **US-5**: As a linked user, I can navigate to Sync Status and Reconciliation pages.

#### 3.1.2 Wireframe Description

```
┌─────────────────────────────────────────────┐
│ Cloud Link                    [Connected ●]  │
├─────────────────────────────────────────────┤
│                                              │
│ ┌─ Connection Details ─────────────────────┐ │
│ │ Account: rook@example.com                │ │
│ │ Plan: pro          Last Verified: 2m ago │ │
│ │ Sync Key: esync_····a3f2   [Active ●]    │ │
│ │                                          │ │
│ │ [Refresh Status]  [Disconnect]           │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ┌─ Quick Sync ─────────────────────────────┐ │
│ │ 847 of 892 memories synced               │ │
│ │ ████████████████████░░░  95%             │ │
│ │ 45 pending · Last synced: 3h ago         │ │
│ │                                          │ │
│ │ [Push to Cloud] [Pull from Cloud]        │ │
│ │ Auto-sync: [ON/OFF toggle]               │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ┌─ Navigation ─────────────────────────────┐ │
│ │ → Sync Status & History                  │ │
│ │ → Reconciliation                         │ │
│ └──────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

**Unlinked state** (already implemented): Shows feature cards + API key input.

#### 3.1.3 Data Flow

**Load page:**
1. `GET /v1/cloud/status` → `{ linked, plan, email, lastVerified }`
2. If linked: `GET /v1/cloud/sync/status` → `{ lastSyncedAt, totalMemories, syncedCount, pendingCount, autoSync, syncing, progress? }`

**Link flow:**
1. User enters API key → `POST /v1/cloud/link { apiKey }` → validates against cloud, creates sync key, returns status
2. On success: refresh page state, show success toast

**Unlink flow:**
1. User clicks Disconnect → confirmation dialog
2. `DELETE /v1/cloud/link` → 204
3. Refresh state

**Auto-sync toggle:**
1. `PUT /v1/cloud/sync/auto-sync { enabled: true/false }` → `{ autoSync }`

#### 3.1.4 States

| State | Behavior |
|---|---|
| **Loading** | Skeleton card with spinner |
| **Unlinked** | Feature cards + API key input form |
| **Linked** | Connection details + sync overview + navigation |
| **Syncing** | Progress bar polls every 2s via `GET /v1/cloud/sync/status` |
| **Error** | Red banner with error message, retry button |
| **Link failed** | Error under input field ("Invalid cloud API key") |

#### 3.1.5 Mobile Responsiveness

- Cards stack vertically on `< sm` breakpoints
- Buttons wrap with `flex-wrap`
- API key input is full-width on mobile
- Already handled in existing implementation

#### 3.1.6 Accessibility

- `aria-live="polite"` on sync progress region
- Button disabled states with `aria-disabled`
- Focus management after dialog close (return to trigger)
- Password input for API key field (never displayed after entry)

---

### 3.2 Settings: Sync Status (`/settings/sync`)

> **Status: New page.**

#### 3.2.1 User Stories

- **US-6**: As a linked user, I can see detailed sync status: pending count, last push time, last pull time, any errors.
- **US-7**: As a linked user, I can trigger manual push or pull and see real-time progress.
- **US-8**: As a linked user, I can view sync history with per-operation breakdowns (new/updated/skipped/failed).
- **US-9**: As a linked user, I can see and clear recent sync errors.
- **US-10**: As a linked user, I can cancel an in-progress sync.

#### 3.2.2 Wireframe Description

```
┌─────────────────────────────────────────────┐
│ Sync Status                    [← Back]      │
├─────────────────────────────────────────────┤
│                                              │
│ ┌─ Overview ───────────────────────────────┐ │
│ │  ┌──────────┐ ┌──────────┐ ┌──────────┐ │ │
│ │  │ Pending  │ │ Last     │ │ Last     │ │ │
│ │  │   45     │ │ Push     │ │ Pull     │ │ │
│ │  │ memories │ │ 3h ago   │ │ 1d ago   │ │ │
│ │  └──────────┘ └──────────┘ └──────────┘ │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ┌─ Actions ────────────────────────────────┐ │
│ │ [▲ Push to Cloud]  [▼ Pull from Cloud]   │ │
│ │ [✕ Cancel Sync]  (shown only when active)│ │
│ │                                          │ │
│ │ ████████████████░░░░  72%  Syncing...    │ │
│ │ 36 of 50 memories pushed                 │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ┌─ Sync History ───────────────────────────┐ │
│ │ ● push · completed · 2h ago · 0.8s      │ │
│ │   50 synced (12 new, 30 skipped, 8 upd) │ │
│ │ ● pull · completed · 1d ago · 1.2s      │ │
│ │   22 pulled (15 new, 5 skipped, 2 del)  │ │
│ │ ✕ push · failed · 2d ago                │ │
│ │   Cloud API key is invalid or expired    │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ┌─ Errors (2) ─────────────────────────────┐ │
│ │ ⚠ 2025-02-20 08:14 — Rate limit         │ │
│ │ ⚠ 2025-02-19 23:01 — Network timeout    │ │
│ └──────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

#### 3.2.3 Data Flow

**Load page:**
1. `GET /v1/cloud/sync/status` → sync overview metrics
2. `GET /v1/cloud/sync/history` → last 10 sync events

**Push sync:**
1. `POST /v1/cloud/sync` → starts push, returns `SyncResult` when done
2. While syncing: poll `GET /v1/cloud/sync/status` every 2s for progress
3. On complete: refresh history

**Pull sync:**
1. `POST /v1/cloud/sync/pull` → returns pull result
2. On complete: refresh status + history

**Cancel sync:**
1. `DELETE /v1/cloud/sync` → `{ cancelled: true }`

**Sync errors (new endpoint):**
1. `GET /v1/cloud/sync/errors?limit=10` → `{ errors: [{ message, timestamp, direction }] }`
   - Can be derived from `syncHistory` where `status === 'failed'` — no new endpoint strictly needed.

#### 3.2.4 States

| State | Behavior |
|---|---|
| **Loading** | 3 skeleton stat cards + skeleton list |
| **Empty** (no history) | "No sync operations yet" message with CTA to sync |
| **Idle** | Stats + history displayed, push/pull buttons enabled |
| **Syncing** | Progress bar, cancel button visible, push/pull disabled |
| **Error** | Error banner, push/pull re-enabled for retry |
| **Not linked** | Redirect to `/settings/cloud` with message |

#### 3.2.5 Mobile Responsiveness

- Stat cards: 3-column grid → single column stack on mobile
- History items: full width, text wraps naturally
- Action buttons: stack vertically on mobile

#### 3.2.6 Accessibility

- Stat cards use `role="status"` with `aria-label`
- History list is `role="list"` with descriptive item text
- Progress bar has `aria-valuenow`, `aria-valuemin`, `aria-valuemax`
- Cancel button has `aria-label="Cancel sync operation"`

---

### 3.3 Settings: Reconciliation (`/settings/reconcile`)

> **Status: New page. New backend endpoints required.**

#### 3.3.1 User Stories

- **US-11**: As a user who just linked to a cloud account with existing data, I can preview what a reconciliation would do before executing it.
- **US-12**: As a user, I can choose a reconciliation strategy: push all local → cloud, pull all cloud → local, bidirectional merge, or selective.
- **US-13**: As a user, I can see real-time progress during reconciliation.
- **US-14**: As a user, I can see a results summary after reconciliation completes.
- **US-15**: As a user, I can view the identity mappings (which local agents/users map to which cloud agents/users).

#### 3.3.2 Reconciliation Wizard

**Step 1: Preview**

```
┌─────────────────────────────────────────────┐
│ Reconcile Memories          Step 1 of 4      │
├─────────────────────────────────────────────┤
│                                              │
│ We found differences between your local      │
│ and cloud memory stores.                     │
│                                              │
│ ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│ │ Local    │  │ Cloud    │  │ Shared   │   │
│ │ Only     │  │ Only     │  │ (by hash)│   │
│ │   312    │  │   187    │  │   540    │   │
│ └──────────┘  └──────────┘  └──────────┘   │
│                                              │
│ Identity Mappings:                           │
│ ┌──────────────────────────────────────────┐ │
│ │ Local Agent "clawd" → Cloud Agent "clawd"│ │
│ │ Local User "Beaux"  → Cloud User "Beaux" │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│                               [Next →]       │
└─────────────────────────────────────────────┘
```

**Step 2: Strategy Selection**

```
┌─────────────────────────────────────────────┐
│ Reconcile Memories          Step 2 of 4      │
├─────────────────────────────────────────────┤
│                                              │
│ Choose reconciliation strategy:              │
│                                              │
│ ○ Push All — Send 312 local-only memories   │
│   to cloud. Cloud-only memories unchanged.   │
│                                              │
│ ○ Pull All — Download 187 cloud-only        │
│   memories to local. Local-only unchanged.   │
│                                              │
│ ● Bidirectional Merge (recommended)          │
│   Push 312 to cloud + pull 187 to local.    │
│   Duplicates skipped via content hash.       │
│                                              │
│ ☑ Skip duplicates (same content hash)        │
│                                              │
│                     [← Back]  [Reconcile →]  │
└─────────────────────────────────────────────┘
```

**Step 3: Progress**

```
┌─────────────────────────────────────────────┐
│ Reconcile Memories          Step 3 of 4      │
├─────────────────────────────────────────────┤
│                                              │
│ Reconciling...                               │
│                                              │
│ Push: ████████████████████░░  312/312  ✓    │
│ Pull: ████████████░░░░░░░░░   98/187       │
│                                              │
│ Elapsed: 12s                                 │
│                                              │
│                              [Cancel]        │
└─────────────────────────────────────────────┘
```

**Step 4: Results**

```
┌─────────────────────────────────────────────┐
│ Reconcile Memories          Step 4 of 4      │
├─────────────────────────────────────────────┤
│                                              │
│ ✓ Reconciliation Complete (18.4s)            │
│                                              │
│ Pushed to cloud:  312 (298 new, 14 skipped) │
│ Pulled to local:  187 (180 new, 7 skipped)  │
│ Errors:           0                          │
│                                              │
│ Your local and cloud stores are now in sync. │
│                                              │
│                                    [Done]    │
└─────────────────────────────────────────────┘
```

#### 3.3.3 Identity Mapping Display

Shown in Step 1 and also accessible as a standalone section below the wizard:

```
┌─ Identity Mappings ────────────────────────┐
│                                            │
│ Agents:                                    │
│ ┌────────────────┐    ┌────────────────┐  │
│ │ Local          │ →  │ Cloud          │  │
│ │ clawd (abc123) │    │ clawd (def456) │  │
│ └────────────────┘    └────────────────┘  │
│                                            │
│ Users:                                     │
│ ┌────────────────┐    ┌────────────────┐  │
│ │ Local          │ →  │ Cloud          │  │
│ │ Beaux (usr_1)  │    │ Beaux (usr_7)  │  │
│ └────────────────┘    └────────────────┘  │
└────────────────────────────────────────────┘
```

#### 3.3.4 Data Flow

**New API endpoints:**

**`GET /v1/cloud/reconcile/preview`**
```typescript
// Request: (no body, uses account from auth)
// Response:
{
  localOnly: number;       // memories with no matching contentHash in cloud
  cloudOnly: number;       // cloud memories with no matching contentHash locally
  shared: number;          // matching contentHash count
  totalLocal: number;
  totalCloud: number;
  identityMappings: {
    agents: Array<{
      localAgentId: string;
      localAgentName: string;
      cloudAgentId: string;
      cloudAgentName: string;
    }>;
    users: Array<{
      localUserId: string;
      localExternalId: string;
      cloudUserId: string;
      cloudExternalId: string;
    }>;
  };
}
```

Implementation: The local instance calls `GET /v1/sync/pull?since=1970-01-01&limit=0` (or a dedicated preview endpoint) on the cloud to get counts, then compares locally.

**`POST /v1/cloud/reconcile`**
```typescript
// Request:
{
  strategy: 'push-all' | 'pull-all' | 'bidirectional';
  skipDuplicates: boolean;  // default true
}
// Response:
{
  reconcileId: string;
  status: 'started';
}
```

Implementation: Triggers `triggerSync()` and/or `triggerPull()` based on strategy, wrapped in a reconciliation context that tracks combined progress.

**`GET /v1/cloud/reconcile/status`**
```typescript
// Response:
{
  reconcileId: string;
  status: 'in-progress' | 'completed' | 'failed' | 'cancelled';
  push?: { synced: number; total: number; newCount: number; skippedCount: number; errorCount: number };
  pull?: { pulled: number; total: number; newCount: number; skippedCount: number; deletedCount: number };
  durationMs: number;
  error?: string;
}
```

**`GET /v1/cloud/identity-map`**
```typescript
// Response:
{
  agents: Array<{ instanceId, localAgentId, cloudAgentId, agentName }>;
  users: Array<{ instanceId, localUserId, cloudUserId, externalId }>;
}
```

Implementation: Query `SyncAgentMap` and `SyncUserMap` tables filtered by the current instance's `instanceId`.

#### 3.3.5 States

| State | Behavior |
|---|---|
| **Loading** | Spinner while preview fetches |
| **Preview loaded** | Show counts + identity mappings, Next button |
| **No differences** | "Your stores are already in sync!" with Done button |
| **Reconciling** | Progress bars for push/pull, Cancel button |
| **Complete** | Results summary, Done button |
| **Failed** | Error message, Retry button |
| **Not linked** | Redirect to `/settings/cloud` |
| **Already syncing** | "A sync is already in progress" with link to sync status page |

#### 3.3.6 Mobile Responsiveness

- Stat cards: 3-column → single column on mobile
- Wizard steps: full-width, buttons bottom-aligned
- Identity mapping: horizontal → vertical layout on mobile (local above, arrow down, cloud below)
- Strategy radio buttons: full-width touch targets

#### 3.3.7 Accessibility

- Wizard uses `aria-current="step"` on active step
- Radio group for strategy with `role="radiogroup"`, `aria-labelledby`
- Progress bars with `role="progressbar"`, `aria-valuenow/min/max`
- Results summary announced via `aria-live="assertive"`
- All buttons have descriptive labels, not just icons

---

## 4. Tasks Breakdown

### Phase 1: Backend — New Endpoints

| # | Task | Description | Effort | Dependencies | Definition of Done |
|---|---|---|---|---|---|
| B1 | Reconciliation preview endpoint | `GET /v1/cloud/reconcile/preview` — counts local-only, cloud-only, shared by comparing content hashes. Fetches cloud counts via existing sync pull endpoint. | M | — | Returns correct counts; handles unlinked state with 400 |
| B2 | Reconciliation execute endpoint | `POST /v1/cloud/reconcile` — accepts strategy, orchestrates push+pull. Stores reconcile event. | L | B1 | Push-all, pull-all, bidirectional strategies work. Creates SyncEvent records. |
| B3 | Reconciliation status endpoint | `GET /v1/cloud/reconcile/status` — returns progress of in-flight reconciliation. | S | B2 | Returns progress when active, last result when idle |
| B4 | Identity map endpoint | `GET /v1/cloud/identity-map` — queries SyncAgentMap + SyncUserMap for current instance | S | — | Returns mapped agents/users; empty array if no mappings |
| B5 | Reconcile cancel | `DELETE /v1/cloud/reconcile` — aborts in-progress reconciliation | S | B2 | Cancels cleanly, partial progress is preserved |

### Phase 2: Frontend — Sync Status Page

| # | Task | Description | Effort | Dependencies | Definition of Done |
|---|---|---|---|---|---|
| F1 | Sync status page scaffold | Create `/settings/sync` route with layout, back navigation, loading state | S | — | Page renders, accessible from cloud settings |
| F2 | Sync overview cards | Three stat cards: pending count, last push, last pull | S | F1 | Shows real data from `GET /v1/cloud/sync/status` |
| F3 | Push/pull actions with progress | Push/pull buttons, progress bar, cancel button, polling | M | F1 | Triggers sync, shows progress, handles cancel |
| F4 | Sync history list | Render sync events from `GET /v1/cloud/sync/history` with direction badges, status icons, counts | M | F1 | Shows last 10 events with all metadata |
| F5 | Error display | Show failed sync events with error messages | S | F4 | Errors visible, distinguishable from successes |

### Phase 3: Frontend — Reconciliation Page

| # | Task | Description | Effort | Dependencies | Definition of Done |
|---|---|---|---|---|---|
| F6 | Reconciliation page scaffold | Create `/settings/reconcile` with multi-step wizard container | M | — | Wizard navigation (prev/next) works |
| F7 | Preview step | Fetch and display local-only/cloud-only/shared counts + identity mappings | M | B1, B4, F6 | Shows correct counts, handles loading/error |
| F8 | Strategy selection step | Radio group for push-all/pull-all/bidirectional + skip duplicates checkbox | S | F6 | Selection persists across back/next |
| F9 | Execute step with progress | Call reconcile endpoint, poll status, show dual progress bars | L | B2, B3, F6 | Progress updates in real-time, cancel works |
| F10 | Results step | Show summary with new/skipped/error counts for push and pull | S | F9 | Displays after reconciliation completes |
| F11 | Identity mapping component | Reusable component showing agent/user mappings in arrow layout | M | B4 | Used in preview step and as standalone section |

### Phase 4: Enhancements to Existing Cloud Page

| # | Task | Description | Effort | Dependencies | Definition of Done |
|---|---|---|---|---|---|
| F12 | Add navigation links | Add cards/links to Sync Status and Reconciliation pages | S | F1, F6 | Links visible when linked, disabled when unlinked |
| F13 | Sync key status display | Show sync key status (active/missing) in connection details | S | — | Shows masked sync key hint |
| F14 | Post-link reconciliation prompt | After linking, if cloud has data, show banner: "Cloud has existing data — reconcile?" | M | B1, F6 | Banner appears only when `cloudOnly > 0` |

### Phase 5: Testing

| # | Task | Description | Effort | Dependencies | Definition of Done |
|---|---|---|---|---|---|
| T1 | Backend unit tests | Test reconciliation preview, execute, status, identity map endpoints | M | B1-B5 | All new endpoints have tests, edge cases covered |
| T2 | Frontend component tests | Test wizard steps, loading/error states, progress polling | M | F1-F14 | Components render correctly in all states |
| T3 | E2E: link → reconcile → sync flow | Full flow test: link → preview → reconcile → verify data | L | All | Passes on CI |

---

## 5. Edge Cases

### 5.1 First-Time Link (No Existing Cloud Data)

- **Preview** returns `cloudOnly: 0`, `shared: 0`
- UI shows: "Cloud is empty. Push your local memories to start syncing."
- Skip reconciliation wizard, offer direct "Push All" CTA

### 5.2 Re-Linking After Disconnect

- `instanceId` is preserved in the `CloudLink` record even after unlink (existing behavior: `unlinkCloud` deletes the row)
- **Fix needed**: On re-link, if the cloud still has `SyncIdMap` entries for this instance, resume from where we left off
- If instanceId changed: treat as a fresh reconciliation
- UI should detect this via preview endpoint and guide accordingly

### 5.3 Same Content Hash, Different Metadata

- Current behavior: `handleSyncPush` skips if `contentHash` matches, creating `SyncIdMap` entry
- Reconciliation preview counts these as "shared" — they won't be pushed/pulled again
- **Metadata divergence** (e.g., different `effectiveScore`, `priority`): Currently not reconciled
- **Future enhancement**: Add "metadata-only sync" option to reconciliation

### 5.4 Large Reconciliation (10,000+ Memories)

- Existing sync uses `BATCH_SIZE = 50` with `BATCH_DELAY_MS = 500`
- 10,000 memories = 200 batches × 0.5s delay = ~100s minimum + API time
- `MAX_SYNC_DURATION_MS = 10 minutes` — sufficient for ~60,000 memories
- **UI must**:
  - Show estimated time remaining
  - Allow cancellation at any point (partial progress preserved via `cloudSyncedAt` timestamps)
  - Handle page navigation away (show "sync in progress" banner on return)
- **Backend consideration**: For very large reconciliations, consider increasing batch size or running push/pull in parallel

### 5.5 Network Failure During Sync

- Existing error handling: batch failures logged, `errorCount` incremented
- 401/403 breaks the sync loop immediately
- Other errors: batch is skipped, next batch attempted
- **UI**: Show error count in progress view, full error details in results
- **Recovery**: User can re-trigger sync; already-synced memories are skipped via `cloudSyncedAt` / `contentHash`

### 5.6 Invalid or Expired Cloud API Key

- `refreshSubscription()` tolerates up to 3 consecutive auth failures before unlinking
- During sync: 401/403 stops the sync immediately with error
- **UI**: Show "API key expired" error with CTA to re-enter key or unlink
- **During reconciliation**: Same behavior — stop and show error

### 5.7 Sync Key Rotation

- Sync keys (`esync_*`) are created during link and stored encrypted
- If cloud rotates or revokes the sync key: push/pull will fail with 401
- **Current behavior**: Falls back to `cloudApiKey` if `cloudSyncKey` is null
- **UI**: Show sync key status. If sync fails with auth error, offer "Regenerate Sync Key" button
- **New endpoint needed**: `POST /v1/cloud/sync-key/rotate` — creates new sync key on cloud, updates local encrypted storage

---

## 6. Security Considerations

### 6.1 Cloud API Key Storage

- **Never display in full** after initial entry — existing behavior uses `type="password"` on input
- Stored encrypted via `encrypt()` utility (AES-256 from `encryption.util.ts`)
- Only decrypted in memory for API calls, never returned to frontend
- Connection details show `email` and `plan`, not the key itself
- Sync key hint shown as `esync_····a3f2` (last 4 chars)

### 6.2 Sync Key Management

- Sync keys (`esync_*`) have narrower permissions than full API keys — can only push/pull memories
- Created automatically during link flow via `POST /v1/account/sync-keys`
- If sync key creation fails: falls back to full API key (logged as warning)
- **Rotation**: Should be possible without re-linking; add UI button

### 6.3 HTTPS Enforcement

- `CLOUD_API_BASE = 'https://api.openengram.ai'` — hardcoded to HTTPS
- Local dashboard communicates with local Engram over localhost (HTTP acceptable)
- All cloud-bound requests go through the backend — API keys never exposed to browser

### 6.4 Wrong Cloud Account Linking

- Link flow validates the API key via `GET /v1/auth/me` and shows the account email
- **Enhancement**: After validation, show confirmation: "Link to account **rook@example.com** (pro plan)?"
- If user links to wrong account: unlink and re-link with correct key
- **Data risk**: Pushing to wrong account sends memories to that account's cloud store
- **Mitigation**: Unlink does NOT delete cloud data — user must separately delete from wrong account
- **UI should clearly show** which cloud account is linked before any sync/reconcile action

---

## 7. Technical Notes

### Component Library

The dashboard uses:
- **shadcn/ui**: Card, Button, Badge, Dialog, Switch, Progress, Input
- **Lucide React** icons
- **sonner** for toasts
- **Next.js App Router** with `"use client"` pages under `(dashboard)/settings/`

### State Management

- Local `useState` hooks (no global state library)
- `useCallback` for fetch functions to avoid re-renders
- Polling via `setInterval` during sync operations
- `useInstance()` context for mode detection (cloud vs self-hosted)

### File Structure

```
engram-dashboard/src/app/(dashboard)/settings/
├── page.tsx                  # General settings (existing)
├── cloud/
│   └── page.tsx              # Cloud connection (existing, enhance)
├── sync/
│   └── page.tsx              # NEW: Sync status
└── reconcile/
    └── page.tsx              # NEW: Reconciliation wizard

engram/src/
├── cloud-sync/
│   ├── cloud-sync.controller.ts   # Add reconcile routes
│   ├── cloud-sync.service.ts      # Add reconcile logic
│   └── dto/
│       └── reconcile.dto.ts       # NEW: reconcile DTOs
├── cloud-link/
│   └── cloud-link.controller.ts   # Add identity-map route
```

### API Auth Pattern

All cloud-related endpoints use `ApiKeyOrJwtGuard`. Admin-only actions (link/unlink/auto-sync) additionally use `AdminGuard`. The frontend sends `Authorization: Bearer <jwt>` from `localStorage.engram_token` or `X-AM-API-Key` from env.
