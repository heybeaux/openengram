# Engram Identity & Awareness — Master Specification v2

**Version:** 2.0  
**Date:** 2026-02-20  
**Authors:** Kit 🦊, Rook ♜, Claude (consolidation)  
**Status:** Approved  
**Source Specs:** identity-dashboard-ui.md, sync-reconciliation-ui.md, Kit's identity-dashboard-spec.md, awareness-signals-ui-spec.md, api-documentation-spec.md

---

## 1. Executive Summary

### What
A comprehensive dashboard UI, API documentation, and production deployment plan for Engram's identity framework, awareness system, and cloud sync/reconciliation features. This covers **48+ backend features** built across identity, delegation, trust, awareness, and sync — all currently API-only with no UI, no docs, and no production migration.

### Why
- **Identity framework is Engram's moat** — no other agent memory system has emergent identity, trust profiles, or delegation contracts
- Features are useless without visibility — operators need dashboards, developers need docs
- Backend is complete but not deployed to production — migrations pending

### Timeline
| Phase | Scope | Estimated Effort |
|-------|-------|-----------------|
| Phase 0 | Backend completion — missing REST endpoints | ~1 week |
| Phase 1 | Documentation — API reference + concept pages | ~2.5 weeks |
| Phase 2 | Dashboard UI — all pages | ~4 weeks |
| Phase 3 | Production deployment — migrations + verify | ~1 week |

**Total: ~8.5 weeks** (can parallelize Phases 0+1, then 2, then 3)

---

## 2. Phase 0: Backend Completion

Several identity services are implemented but lack REST endpoint wiring in `IdentityController`. These must be added before UI work begins.

### P0.1: Contract & Challenge REST Endpoints
Wire `DelegationContractService` and `ChallengeService` to REST:
- `GET /v1/identity/contracts` — list contracts (filterable by status, agent, date)
- `GET /v1/identity/contracts/:id` — get single contract
- `POST /v1/identity/contracts` — create contract
- `POST /v1/identity/contracts/:id/complete` — complete contract
- `GET /v1/identity/challenges` — list challenges (filterable by contractId)
- `POST /v1/identity/challenges` — create challenge
- `POST /v1/identity/challenges/:id/resolve` — resolve challenge
- `GET /v1/identity/failure-patterns?agentId=:id` — failure patterns

### P0.2: Team List & Collaboration Endpoints
- `GET /v1/identity/teams` — list all teams
- `GET /v1/identity/teams/:id/collaboration` — collaboration pairs

### P0.3: Bulk Trust Profile Endpoint
- `GET /v1/identity/trust-profiles?agentIds=a,b,c` — multiple trust profiles in one call (eliminates N+1)

### P0.4: Trust History Endpoint
- `GET /v1/identity/agents/:id/trust-history?days=30` — daily trust snapshots
- Requires periodic snapshot storage or on-the-fly calculation from task completions

### P0.5: Reconciliation Endpoints
- `GET /v1/cloud/reconcile/preview` — counts local-only, cloud-only, shared
- `POST /v1/cloud/reconcile` — execute reconciliation (strategy: push-all/pull-all/bidirectional)
- `GET /v1/cloud/reconcile/status` — poll progress
- `DELETE /v1/cloud/reconcile` — cancel in-progress
- `GET /v1/cloud/identity-map` — agent/user identity mappings across instances

### P0.6: Awareness Source Endpoints
- `GET /v1/awareness/sources` — list configured signal sources
- `POST /v1/awareness/sources` — connect a source
- `PATCH /v1/awareness/sources/:id` — toggle enable/disable
- `DELETE /v1/awareness/sources/:id` — disconnect

---

## 3. Phase 1: Documentation

Documentation clarifies requirements and unblocks developers. Do this before or in parallel with UI work.

### 3.1 API Reference (`/docs/api`)

Document all **44+ new endpoints** organized by feature area:

| Section | Endpoint Count | Key Endpoints |
|---------|---------------|---------------|
| Authentication | 4 | login, register, me, auth headers |
| Identity | 11 | agent identity, capabilities, export/import, task-outcomes, self-assessments, trust recompute/narrative, failure-patterns |
| Delegation | 10 | tasks CRUD, templates CRUD, contracts CRUD |
| Teams | 8 | teams CRUD, member management, collaborations |
| Challenges | 4 | create, list, get, resolve |
| Awareness | 5 | status, cycle trigger, insight feedback, notification config |
| Cloud Sync | 6 | link/status, sync push/pull, reconcile preview/execute |

Each endpoint documented with: signature, description, auth requirements, request/response TypeScript schemas, curl examples, error responses.

### 3.2 Concept Pages

| Page | Route | Content |
|------|-------|---------|
| Identity | `/docs/concepts/identity` | What agent identity is, layers (capabilities, preferences, trust, work style), extraction pipeline, lifecycle, portability |
| Delegation | `/docs/concepts/delegation` | Task lifecycle, contracts, templates, trust feedback loop |
| Trust | `/docs/concepts/trust` | Trust signals (SUCCESS/FAILURE/CORRECTION), time-decayed scoring (30-day half-life), narrative trust, challenge protocol |
| Awareness | `/docs/concepts/awareness` | Waking Cycle (4h schedule), signal sources, insight types, feedback loop, proactive notifications |
| Sync | `/docs/operations/sync` | Cloud linking, push/pull, reconciliation, identity mapping, content hash dedup |

### 3.3 Architecture Diagrams (Mermaid)

- Identity data flow: Memory → Extraction → Signals → Profile
- Trust score computation with time decay
- Task/contract state machines
- Delegation → Trust feedback loop
- Sync architecture: local ↔ cloud with identity mapping
- Waking Cycle pipeline: observe → analyze → surface → notify
- Module dependency graph

---

## 4. Phase 2: Dashboard UI

### 4.1 Navigation & Information Architecture

**New sidebar items** (after "Pools", before "API Keys"):

| Nav Item | Route | Icon | Edition |
|----------|-------|------|---------|
| Identity | `/identity` | `Fingerprint` | All |
| Insights | `/insights` | `Lightbulb` | All |
| Sources | `/sources` | `Radio` | All |

**Identity sub-navigation** (horizontal tab bar):

| Tab | Route | Description |
|-----|-------|-------------|
| Overview | `/identity` | Agent profiles & capabilities |
| Contracts | `/identity/contracts` | Delegation contracts & challenges |
| Teams | `/identity/teams` | Team management |
| Trust | `/identity/trust` | Trust profiles & trends |
| Recall | `/identity/recall` | Delegation-aware recall search |
| Export/Import | `/identity/export` | Portable identity |

**Settings additions:**
- `/settings/sync` — Sync status & history (local edition only)
- `/settings/reconcile` — Reconciliation wizard (local edition only)

**Edition gating:** Identity/awareness features available in all editions. Sync/reconciliation only in local edition.

### 4.2 Identity Pages

#### 4.2.1 Agent Identity Overview (`/identity`)

Agent selector dropdown → profile card (name, ID, trust score, work style tags) + capability radar/bar chart (Recharts) + trust breakdown table (domain, score, tasks, trend) + recent task completions (last 10) + behavioral consistency indicators.

**Data:** `GET /v1/identity/agents/:id/trust-profile`, `GET /v1/identity/task-completions`

#### 4.2.2 Delegation Contracts (`/identity/contracts`)

Filterable table (status, agent, date) → contract detail panel (expected outputs, success criteria, constraints, result, challenges) → create contract dialog → raise/resolve challenge dialogs.

**Data:** `GET/POST /v1/identity/contracts`, `GET/POST /v1/identity/challenges`

#### 4.2.3 Teams (`/identity/teams`)

Team card grid (name, member count, collaboration score) → team detail (aggregated capability bar chart, member table, collaboration pairs) → create/edit team dialog with multi-select agent picker.

**Data:** `GET/POST /v1/identity/teams`, `GET /v1/identity/teams/:id/capabilities`, `GET /v1/identity/teams/:id/collaboration`

#### 4.2.4 Trust Profiles (`/identity/trust`)

Trust overview table (all agents × domains with trend indicators) + trust history line chart (multi-agent selection, time range picker).

**Data:** `GET /v1/identity/trust-profiles`, `GET /v1/identity/agents/:id/trust-history`

#### 4.2.5 Delegation Recall (`/identity/recall`)

Search input → recommended agent card → similar past tasks table (with outcome badges) → known failure patterns list.

**Data:** `GET /v1/identity/delegation-recall?task={query}`

#### 4.2.6 Portable Identity (`/identity/export`)

Export panel (agent selector → preview → download JSON) + Import panel (file drop zone → hash verification → schema check → target agent → import).

**Data:** `GET /v1/identity/agents/:id/export`, `POST /v1/identity/agents/import`

### 4.3 Awareness Pages

#### 4.3.1 Insights (`/insights`)

Insight feed with cards (type badge, confidence score, summary, timestamp) + feedback actions (👍 helpful, 👎 dismiss, ✅ acted on) with optimistic UI + filters (status, type, confidence slider) persisted in URL + cycle status bar (last run, next scheduled, health) + manual "Run Cycle" button + feedback summary stats.

**Data:** `GET /v1/awareness/status`, `PATCH /v1/insights/:id/feedback`, `POST /v1/awareness/cycle`

Notification badge on sidebar nav item showing unacknowledged insight count.

#### 4.3.2 Notification Settings (`/insights/notifications`)

Toggle enable/disable + confidence threshold slider (0.5-1.0) + webhook URL input (HTTPS required) + HMAC secret + test notification button + recent notification history (delivered/failed).

**Data:** `GET/POST /v1/notifications/config`

#### 4.3.3 Signal Sources (`/sources`)

Source cards (Linear: connected, GitHub/Slack: coming soon) with status dots + configure modal per source + enable/disable toggle + disconnect with confirmation + signal activity sparkline.

**Data:** `GET/POST/PATCH/DELETE /v1/awareness/sources`

### 4.4 Sync & Reconciliation Pages

#### 4.4.1 Sync Status (`/settings/sync`)

Overview stat cards (pending count, last push, last pull) + push/pull action buttons with progress bar + cancel sync + sync history list (direction, status, counts, duration) + error display.

**Data:** `GET /v1/cloud/sync/status`, `GET /v1/cloud/sync/history`, `POST /v1/cloud/sync`, `POST /v1/cloud/sync/pull`

#### 4.4.2 Reconciliation Wizard (`/settings/reconcile`)

4-step wizard:
1. **Preview** — local-only/cloud-only/shared counts + identity mappings
2. **Strategy** — push-all / pull-all / bidirectional merge (recommended) + skip duplicates
3. **Progress** — dual progress bars for push/pull, cancel button
4. **Results** — summary with new/skipped/error counts

**Data:** `GET /v1/cloud/reconcile/preview`, `POST /v1/cloud/reconcile`, `GET /v1/cloud/reconcile/status`

#### 4.4.3 Cloud Settings Enhancement (`/settings/cloud`)

Add navigation links to Sync Status and Reconciliation pages. Add sync key status display. Post-link reconciliation prompt when cloud has existing data.

---

## 5. Phase 3: Production Deployment

### 5.1 Prisma Migrations

New models requiring migration:

| Model | Purpose |
|-------|---------|
| `TrustSignal` | Behavioral trust signals |
| `TrustScore` | Computed trust scores |
| `CapabilityCheckpoint` | Capability snapshots |
| `ExperienceWeight` | Experience-weighted recall |
| `IdentitySnapshot` | Dream cycle identity consolidation |
| `AgentCapabilityProfile` | Persistent capability profiles |
| `AgentWorkStyle` | Work style tracking |
| `DelegatedTask` | Task completion tracking |
| `DelegationTemplate` | Reusable delegation patterns |
| `DelegationContract` | Formal delegation contracts |

Schema changes:
- `visibility` field on Memory (PRIVATE/TEAM/PUBLIC enum)
- `TASK_OUTCOME` and `SELF_ASSESSMENT` added to MemoryType enum
- `PREFERENCE` added to MemoryLayer enum

### 5.2 Deployment Steps

1. Generate consolidated migration: `prisma migrate dev --name identity-framework`
2. Deploy to **staging** first: `prisma migrate deploy`
3. **Staging smoke tests**: identity endpoints, sync, awareness cycle, all new UI pages
4. Merge main → production branch
5. Deploy to **production**: `prisma migrate deploy`
6. Set new env vars (JWT_SECRET, etc.)
7. **Production verification**: smoke test critical paths

### 5.3 Rollback Plan

- Keep production branch at previous commit until staging verified
- Document rollback SQL per migration
- Feature flags on new UI pages — can hide behind edition guard if issues found
- Unlink does NOT delete cloud data — safe to roll back sync changes

---

## 6. Design Guidelines

### Visual System

- **Theme:** Dark theme (`bg-background`, `bg-card`) with **green brand accents** (`text-brand-500`)
- **Component library:** **shadcn/ui** exclusively — Card, Button, Badge, Dialog, Switch, Progress, Input, Table, Tabs, Skeleton, Tooltip, Avatar, DropdownMenu, Separator
- **Icons:** Lucide React
- **Charts:** Recharts 3.7 (already installed) — LineChart, BarChart, RadarChart. Use `src/lib/analytics-colors.ts` palette
- **Toasts:** sonner
- **Framework:** Next.js App Router with `"use client"` pages

### Shared Components to Build

| Component | Description |
|-----------|-------------|
| `EmptyState` | Generic empty state: icon + message + CTA (reusable across all pages) |
| `DynamicArrayInput` | Add/remove string items (for contract outputs, criteria) |
| `FileDropZone` | Drag-and-drop file upload (identity import) |
| `ContractStatusBadge` | Color-coded: pending, in_progress, completed, failed, timed_out |
| `ChallengeTypeBadge` | unsafe, underspecified, capability_mismatch, resource_constraint |
| `ConfidenceBadge` | Green (≥0.8), amber (0.6-0.8), red (<0.6) |
| `InsightTypeBadge` | PATTERN (blue), ANOMALY (yellow), TREND (purple), SUGGESTION (green) |
| `StatusDot` | Green/amber/red/gray dot for connection/health states |
| `FeedbackActions` | 👍/👎/✅ button group with optimistic updates |
| `IdentityTabNav` | Horizontal tab navigation for identity sub-pages |

### Accessibility Requirements

- WCAG AA color contrast on all elements
- All interactive elements keyboard accessible
- Trend/status indicators use text AND color (never color alone)
- Charts have `aria-label` summaries and data table alternatives for screen readers
- Forms: all inputs labeled, validation errors linked via `aria-describedby`
- Dynamic content uses `aria-live` regions
- Touch targets ≥ 44px on mobile

### Mobile Responsiveness

- Test at 375px, 768px, 1024px, 1440px
- Tables → horizontal scroll with sticky first column, or card layout on mobile
- Multi-column layouts → stack vertically
- Dialogs → full-screen on mobile
- Filters → collapse/stack vertically

---

## 7. Full Task List

All tasks deduplicated and consolidated from all 5 source specs.

### Phase 0: Backend Completion

| ID | Task | Effort | Dependencies | DoD |
|----|------|--------|-------------|-----|
| P0.1 | Contract & challenge REST endpoints | M | — | All 8 endpoints wired, Swagger docs, integration tests |
| P0.2 | Team list & collaboration endpoints | S | — | 2 endpoints, Swagger docs |
| P0.3 | Bulk trust profile endpoint | S | — | Returns array of TrustProfile, works with empty filter |
| P0.4 | Trust history endpoint | L | P0.1 | Daily snapshots for 30/60/90 day ranges, tested |
| P0.5 | Reconciliation endpoints (preview, execute, status, cancel, identity-map) | L | — | All 5 endpoints functional, handles unlinked state |
| P0.6 | Awareness source endpoints (CRUD) | M | — | List/create/update/delete sources |

### Phase 1: Documentation

| ID | Task | Effort | Dependencies | DoD |
|----|------|--------|-------------|-----|
| P1.1 | Auth documentation (methods, flows, scoping) | S | — | JWT, API key, sync key documented with examples |
| P1.2 | Identity API reference (11 endpoints) | L | — | All endpoints with schemas, curl examples, error responses |
| P1.3 | Delegation API reference (10 endpoints) | M | — | Tasks, templates, contracts fully documented |
| P1.4 | Teams API reference (8 endpoints) | M | — | CRUD + members + collaborations documented |
| P1.5 | Challenges API reference (4 endpoints) | S | — | Create, list, get, resolve documented |
| P1.6 | Awareness API reference (5 endpoints) | S | — | Status, cycle, feedback, notifications documented |
| P1.7 | Sync API reference (6 endpoints) | M | — | Existing + new reconciliation endpoints documented |
| P1.8 | Identity concepts page | M | — | Extraction pipeline, lifecycle, portability explained with diagrams |
| P1.9 | Delegation concepts page | M | — | Task/contract state machines, trust feedback loop |
| P1.10 | Trust concepts page | S | — | Signal types, time decay, challenge protocol |
| P1.11 | Awareness concepts page | S | — | Waking Cycle, insight types, feedback loop |
| P1.12 | Sync operations page | M | — | Linking, push/pull, reconciliation, identity mapping |
| P1.13 | Architecture diagrams (Mermaid) | M | P1.8-P1.12 | All diagrams render, module relationships clear |
| P1.14 | Cross-linking & review | S | P1.1-P1.13 | No broken links, all pages cross-referenced |

### Phase 2: Dashboard UI

| ID | Task | Effort | Dependencies | DoD |
|----|------|--------|-------------|-----|
| P2.1 | Identity TypeScript types | S | — | All interfaces match backend DTOs, no `any` |
| P2.2 | Identity API client methods | M | P0.1-P0.4 | All methods typed, error handling consistent |
| P2.3 | Sidebar navigation + Identity layout + tabs | S | — | Identity nav item, 6 tab routes, active state correct |
| P2.4 | Shared components (EmptyState, badges, DynamicArrayInput, FileDropZone, etc.) | M | — | All 10 shared components built, accessible, tested |
| P2.5 | Agent Identity Overview page | L | P2.1-P2.4 | Profile card, capability chart, trust table, completions, all states |
| P2.6 | Delegation Contracts page | XL | P2.1-P2.4 | List, detail, create, challenges, all states, responsive |
| P2.7 | Teams page | L | P2.1-P2.4 | Card grid, detail, capabilities chart, collaboration pairs, create |
| P2.8 | Trust Profiles page | L | P2.1-P2.4, P0.4 | Overview table, history chart, filters, all states |
| P2.9 | Delegation Recall page | M | P2.1-P2.4 | Search, recommendation, similar tasks, failure patterns |
| P2.10 | Portable Identity page | L | P2.1-P2.4 | Export/import, hash verification, schema check, all states |
| P2.11 | Insights page + feedback actions | L | P2.4 | Feed, filters, cycle status, manual trigger, optimistic UI |
| P2.12 | Notification settings page | M | — | Toggle, slider, webhook config, test, history |
| P2.13 | Signal Sources page | M | P0.6 | Source cards, configure modal, toggle, Linear wired |
| P2.14 | Sync Status page | M | — | Stat cards, push/pull with progress, history, errors |
| P2.15 | Reconciliation wizard | L | P0.5 | 4-step wizard, preview, strategy, progress, results |
| P2.16 | Cloud settings enhancements | S | P2.14-P2.15 | Nav links, sync key display, post-link prompt |
| P2.17 | Insight nav badge | S | P2.11 | Unacknowledged count on sidebar |
| P2.18 | Loading/error state audit | S | P2.5-P2.16 | Every component has loading/error/empty, no unhandled rejections |
| P2.19 | Accessibility audit | M | P2.5-P2.16 | Zero critical axe violations, keyboard accessible, chart alternatives |
| P2.20 | Mobile responsiveness audit | M | P2.5-P2.16 | All pages usable at all breakpoints, touch targets ≥ 44px |
| P2.21 | Component tests (Vitest) | M | P2.5-P2.16 | All new components tested, edge cases covered |

### Phase 3: Production Deployment

| ID | Task | Effort | Dependencies | DoD |
|----|------|--------|-------------|-----|
| P3.1 | Generate consolidated Prisma migration | S | — | Migration file created, reviewed |
| P3.2 | Deploy + migrate staging | S | P3.1 | All tables created, no errors |
| P3.3 | Staging smoke tests | M | P3.2 | Identity, sync, awareness, UI all functional |
| P3.4 | Merge main → production | S | P3.3 | Clean merge, CI passes |
| P3.5 | Deploy + migrate production | S | P3.4 | Migration succeeds, no downtime |
| P3.6 | Production verification | M | P3.5 | Critical paths verified, no regressions |

### Summary

| Phase | Tasks | Effort Range |
|-------|-------|-------------|
| Phase 0: Backend | 6 | 2S + 2M + 2L |
| Phase 1: Documentation | 14 | 5S + 5M + 1L + 3M |
| Phase 2: Dashboard UI | 21 | 4S + 8M + 6L + 1XL + 2M |
| Phase 3: Deployment | 6 | 3S + 2M + 1S |
| **Total** | **47 tasks** | |

---

## 8. Open Questions & Recommended Answers

### From Kit's Identity Dashboard Spec (5 questions)

| # | Question | Recommended Answer | Rationale |
|---|----------|-------------------|-----------|
| 1 | **Priority order:** Docs → UI → Deploy, or deploy first? | **Docs → UI → Deploy.** Phase 0 (backend) can run in parallel with Phase 1 (docs). Deploy last after everything is tested. | Staging before prod = always. Docs clarify requirements and catch API inconsistencies early. |
| 2 | **Edition gating:** Identity features for all users, or gated behind a plan tier? | **Free tier (local) gets all identity features. Premium (cloud) gets sync + reconciliation + multi-instance.** | Budget-conscious startup — maximize adoption on free tier, monetize cloud infrastructure. Identity framework = the moat; give it away to create lock-in. |
| 3 | **Agent avatars:** Upload support or placeholder icons? | **Placeholder icons for now** (Fingerprint from lucide-react). Add avatar upload as a future enhancement. | Ship fast, iterate later. Avatars are cosmetic. |
| 4 | **Dashboard tests:** Vitest only, or Playwright E2E too? | **Vitest unit tests for Phase 2. Playwright E2E as a Phase 3 stretch goal.** | Budget-conscious — unit tests give the best ROI. E2E is nice-to-have but expensive to maintain. |
| 5 | **Feature flags:** Hide behind flags or ship incrementally? | **Yes, use feature flags.** New pages behind `FEATURE_IDENTITY_DASHBOARD` flag. Enable on staging first, then production after verification. | Feature flags = always yes. They're cheap insurance. Roll out incrementally, roll back instantly. |

### From Kit's Awareness Spec (4 questions)

| # | Question | Recommended Answer | Rationale |
|---|----------|-------------------|-----------|
| 6 | **Notification channels:** Webhook only, or add Discord/email? | **Webhook only for v1.** Discord bot integration as v2 enhancement. | Budget-conscious — webhooks are universal. Users can pipe to Discord/Slack/email via Zapier or n8n. |
| 7 | **Insight retention:** How long to keep dismissed insights? | **90 days.** Auto-purge dismissed insights older than 90 days. Keep acted_on/helpful forever. | Balance storage costs with auditability. Dismissed = noise; acted_on = signal. |
| 8 | **Source polling:** Independent or aligned with Waking Cycle? | **Aligned with Waking Cycle schedule (4h default).** Sources feed into cycle analysis. | Simpler architecture, predictable resource usage, insights are contextual across all sources. |
| 9 | **Insight grouping:** Group related insights or show individually? | **Show individually for v1, add grouping in v2.** Tag related insights with a `clusterKey` for future grouping UI. | Ship simple, learn from usage. Add the `clusterKey` field now so we don't need a migration later. |

---

## 9. Risk Register

| # | Risk | Impact | Likelihood | Mitigation |
|---|------|--------|-----------|------------|
| R1 | **Prisma migration breaks production** | Critical | Low | Always deploy to staging first. Document rollback SQL. Keep production at previous commit until staging verified. |
| R2 | **N+1 API calls on trust profiles page** | Medium | High | P0.3 bulk trust endpoint eliminates this. Fall back to client-side batching if backend delayed. |
| R3 | **Large reconciliation timeout (10k+ memories)** | Medium | Medium | Existing `MAX_SYNC_DURATION_MS = 10min` handles ~60k memories. Show estimated time. Allow cancellation with preserved partial progress. |
| R4 | **Identity export file too large** | Low | Low | Stream download for large files. Show progress indicator. |
| R5 | **Feature scope creep** | High | High | Stick to this spec. Everything not in this doc is v2. Feature flags allow partial rollout. |
| R6 | **Backend services exist but behave differently than spec assumes** | Medium | Medium | Phase 1 docs + Phase 0 endpoint wiring will surface discrepancies early. Write integration tests. |
| R7 | **Chart performance with many agents/data points** | Low | Medium | Use virtualized lists for 100+ agents. Limit chart data points. Recharts handles this natively. |
| R8 | **Wrong cloud account linking pushes memories to wrong store** | High | Low | Show confirmation with account email before any sync/reconcile. Unlink does NOT delete cloud data. |
| R9 | **Sync key expiration during long operation** | Medium | Low | Falls back to full API key. Add "Regenerate Sync Key" button in UI. |
| R10 | **Team attrition — insufficient bandwidth** | High | Medium | Prioritize ruthlessly: Phase 0 → P1 (docs) → P2 core pages (overview, contracts, insights) → P2 remaining → P3. Ship incrementally behind feature flags. |

---

## Appendix A: File Structure

```
# Identity Dashboard
src/app/(dashboard)/identity/
├── layout.tsx
├── page.tsx                      # Overview
├── contracts/
│   ├── page.tsx
│   └── [id]/page.tsx
├── teams/
│   ├── page.tsx
│   └── [id]/page.tsx
├── trust/page.tsx
├── recall/page.tsx
├── export/page.tsx
└── components/
    ├── identity-tab-nav.tsx
    ├── agent-profile-card.tsx
    ├── agent-selector.tsx
    ├── capability-chart.tsx
    ├── trust-trend-chart.tsx
    ├── contract-status-badge.tsx
    ├── challenge-type-badge.tsx
    ├── contract-detail-panel.tsx
    ├── create-contract-dialog.tsx
    ├── raise-challenge-dialog.tsx
    ├── team-card.tsx
    ├── create-team-dialog.tsx
    ├── dynamic-array-input.tsx
    ├── file-drop-zone.tsx
    └── recall-search.tsx

# Awareness
src/app/(dashboard)/insights/
├── page.tsx                      # Insight feed
└── notifications/page.tsx        # Notification settings

src/app/(dashboard)/sources/
└── page.tsx                      # Signal sources

# Sync & Reconciliation
src/app/(dashboard)/settings/
├── cloud/page.tsx                # Existing, enhance
├── sync/page.tsx                 # NEW
└── reconcile/page.tsx            # NEW

# Shared
src/components/ui/
├── empty-state.tsx
├── confidence-badge.tsx
├── insight-type-badge.tsx
├── status-dot.tsx
└── feedback-actions.tsx
```

## Appendix B: API Endpoint Inventory

**Total new endpoints: 44+**

| Area | Count |
|------|-------|
| Identity (agents, capabilities, trust, export/import) | 11 |
| Delegation (tasks, templates, contracts) | 10 |
| Teams (CRUD, members, collaborations) | 8 |
| Challenges | 4 |
| Awareness (cycle, insights, notifications, sources) | 9 |
| Cloud Sync (reconcile, identity-map) | 6 |

---

*Consolidated by Claude from 5 source specifications authored by Kit 🦊 and Rook ♜.*
