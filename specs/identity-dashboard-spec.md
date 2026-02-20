# Identity Framework — Dashboard UI & Documentation Spec

**Date:** 2026-02-20
**Authors:** Kit 🦊 + Rook ♜
**Status:** Draft — awaiting Beaux review

---

## Context

Today's sprint built 48+ backend features across identity, delegation, trust, awareness, and sync reconciliation. All are API-only — no dashboard UI, no user documentation, no migration to production. This spec defines the work to make these features visible, usable, and documented.

## Scope

1. **Dashboard UI** — New pages and components for identity features
2. **Documentation** — API reference, user guides, architecture docs
3. **Production Deployment** — Migration plan for new Prisma models + deploy

---

## 1. Dashboard UI

### 1.1 Agent Identity Page (`/agents/:id/identity`)

**Description:** Central profile page for an agent's identity — who they are, what they can do, how much they're trusted.

**Data source:** `GET /v1/agents/:id/identity`

**Sections:**
- **Header:** Agent name, description, created date, avatar placeholder
- **Capabilities card:** List of capabilities with confidence scores (progress bars), evidence count
- **Preferences card:** Grouped by category (communication, tools, workflow), with strength indicators
- **Trust Score card:** Overall score (gauge/ring chart), trend sparkline (last 30 days), domain breakdown
- **Behavioral Patterns card:** Topic frequency chart, memory type distribution (last 30 days)
- **Recent Activity:** Latest 10 memories with type badges

**Components needed:**
- `AgentIdentityPage` (page)
- `CapabilityCard` (list with progress bars)
- `TrustGauge` (ring chart with score)
- `PreferenceList` (grouped list with strength dots)
- `BehavioralChart` (bar chart for topics)

**Definition of Done:**
- [ ] Page renders with real data from identity endpoint
- [ ] All 5 sections display correctly
- [ ] Empty states for agents with no data yet
- [ ] Responsive (mobile-friendly)
- [ ] Loading skeletons while data fetches
- [ ] TypeScript clean, no `any` types

---

### 1.2 Agent List Page (`/agents`)

**Description:** Overview of all agents in the account with summary cards.

**Data source:** `GET /v1/agents` (existing), `GET /v1/agents/:id/identity` (per agent)

**Layout:**
- Grid of agent cards, each showing: name, memory count, trust score badge, top 3 capabilities, last active date
- Click card → navigate to `/agents/:id/identity`
- "Export Identity" button per card (calls `GET /v1/agents/:id/export`)

**Definition of Done:**
- [ ] Lists all agents for the account
- [ ] Cards show summary data
- [ ] Navigation to detail page works
- [ ] Export downloads JSON file
- [ ] Empty state for no agents

---

### 1.3 Delegation & Tasks Page (`/tasks`)

**Description:** View and manage delegated tasks, contracts, and templates.

**Data sources:**
- `GET /v1/tasks` (task list with filters)
- `GET /v1/delegation-contracts` (contracts)
- `GET /v1/delegation-templates` (templates)

**Tabs:**
1. **Active Tasks** — Filterable table: task description, assigned to, status (badge), deadline, created date. Status filter (ASSIGNED/IN_PROGRESS/COMPLETED/FAILED).
2. **Contracts** — List of delegation contracts with state badges (PROPOSED → ACCEPTED → COMPLETED → VERIFIED). Click to expand details.
3. **Templates** — CRUD interface for delegation templates. Each shows: name, task type, required capabilities, typical duration.

**Definition of Done:**
- [ ] All 3 tabs functional with real data
- [ ] Task status filters work
- [ ] Contract state displayed with color-coded badges
- [ ] Template CRUD (create/edit/delete) works
- [ ] Pagination on task list (default 20 per page)

---

### 1.4 Teams Page (`/teams`)

**Description:** Manage multi-agent teams, view collaboration history.

**Data sources:**
- `GET /v1/teams` (team list)
- `GET /v1/teams/:id` (team detail with members)
- `GET /v1/teams/:id/collaborations` (collaboration history)

**Layout:**
- Team cards showing: name, member count, aggregate trust score
- Detail view: member list with roles, collaboration timeline, team capabilities (aggregated)
- Add/remove members UI

**Definition of Done:**
- [ ] Team list displays correctly
- [ ] Detail page shows members and collaborations
- [ ] Add/remove member functionality works
- [ ] Empty state for no teams

---

### 1.5 Awareness & Insights Page (`/insights`)

**Description:** View insights from the Waking Cycle, provide feedback, configure notifications.

**Data sources:**
- `GET /v1/awareness/status` (cycle status + insights)
- `PATCH /v1/insights/:id/feedback` (feedback)
- `GET/POST /v1/notifications/config` (notification settings)

**Sections:**
- **Insights feed:** List of insights with confidence scores, type badges, timestamps. Each has thumbs up/down/dismiss actions (triggers feedback endpoint).
- **Cycle status:** Last run time, next scheduled, health indicators
- **Notification settings:** Toggle enabled, set confidence threshold (slider), webhook URL input, test button

**Definition of Done:**
- [ ] Insights display with confidence and type
- [ ] Feedback actions (dismiss/helpful/acted_on) work and update UI
- [ ] Notification config saves and loads correctly
- [ ] Cycle status shows accurate last/next run times
- [ ] Manual "Run Cycle" button triggers `POST /v1/awareness/cycle`

---

### 1.6 Challenges Page (`/challenges`)

**Description:** View and resolve memory challenges between agents.

**Data sources:**
- `GET /v1/challenges` (list)
- `GET /v1/challenges/:id` (detail)
- `PATCH /v1/challenges/:id/resolve` (resolve)

**Layout:**
- Table: challenged memory preview, challenger, reason, status badge, created date
- Detail modal: full memory content, challenge evidence, resolution options (uphold/dismiss/resolve)
- Filter by status (OPEN/UPHELD/DISMISSED/RESOLVED)

**Definition of Done:**
- [ ] Challenge list with status filters
- [ ] Detail modal shows full context
- [ ] Resolution flow works (select method + submit)
- [ ] Status badges color-coded

---

### 1.7 Sync & Reconciliation UI (`/settings/sync`)

**Description:** Manage cloud sync, view reconciliation status, trigger sync operations.

**Data sources:**
- `GET /v1/cloud/status` (link status)
- `GET /v1/cloud/sync/status` (sync status)
- `POST /v1/cloud/reconcile/preview` (preview)
- `POST /v1/cloud/reconcile/execute` (execute)

**Sections:**
- **Link status:** Connected/disconnected, cloud email, plan, last verified
- **Sync status:** Total/synced/pending counts, progress bar during sync, last sync time
- **Reconciliation:** Preview button (shows local-only/cloud-only/shared counts), execute button with confirmation dialog
- **Sync history:** Table of recent sync events (push/pull, counts, duration, status)
- **Auto-sync toggle**

**Definition of Done:**
- [ ] Link status displays correctly
- [ ] Sync counts accurate
- [ ] Reconciliation preview renders before execute
- [ ] Confirmation dialog before reconciliation execute
- [ ] Sync history table with pagination
- [ ] Auto-sync toggle works

---

### 1.8 Navigation Updates

**New sidebar items** (under existing nav structure):
- **Agents** → `/agents` (agent list + identity)
- **Tasks** → `/tasks` (delegation, contracts, templates)
- **Teams** → `/teams`
- **Insights** → `/insights` (awareness + notifications)
- **Challenges** → `/challenges`
- Update existing **Settings** → add Sync tab

**Edition gating:** Identity features should be available in both `local` and `cloud` editions. Sync/reconciliation only in `local` edition (cloud doesn't sync to itself).

---

## 2. Documentation

### 2.1 API Reference Updates (`/docs/api`)

Update the existing API docs page to include all new endpoints:

**Identity endpoints:**
- `GET /v1/agents/:id/identity` — Full agent identity profile
- `GET /v1/agents/:id/capabilities` — Capability profile
- `GET /v1/agents/:id/export` — Export portable identity
- `POST /v1/agents/:id/import` — Import identity
- `POST /v1/agents/:agentId/task-outcomes` — Record task outcome
- `GET /v1/agents/:agentId/task-outcomes` — List outcomes
- `POST /v1/agents/:agentId/self-assessments` — Record self-assessment
- `GET /v1/agents/:agentId/self-assessments` — List assessments
- `POST /v1/agents/:agentId/trust/recompute` — Recompute trust
- `GET /v1/agents/:agentId/trust/narrative` — Trust narrative
- `GET /v1/agents/:agentId/failure-patterns` — Failure analysis

**Delegation endpoints:**
- `POST/GET/PATCH /v1/tasks` — Task CRUD
- `POST/GET/PATCH/DELETE /v1/delegation-templates` — Template CRUD
- `POST/GET/PATCH /v1/delegation-contracts` — Contract CRUD

**Team endpoints:**
- `POST/GET/PATCH/DELETE /v1/teams` — Team CRUD
- `POST/DELETE /v1/teams/:id/members` — Member management
- `POST/GET /v1/teams/:id/collaborations` — Collaboration history

**Challenge endpoints:**
- `POST /v1/memories/:id/challenge` — Create challenge
- `GET /v1/challenges` — List challenges
- `PATCH /v1/challenges/:id/resolve` — Resolve challenge

**Awareness endpoints:**
- `GET /v1/awareness/status` — Cycle status
- `POST /v1/awareness/cycle` — Trigger cycle
- `PATCH /v1/insights/:id/feedback` — Insight feedback
- `POST/GET /v1/notifications/configure` — Notification config

**Sync endpoints:**
- `POST /v1/cloud/reconcile/preview` — Preview reconciliation
- `POST /v1/cloud/reconcile/execute` — Execute reconciliation

Each endpoint needs: description, auth requirements, request body schema, response schema, example curl.

**Definition of Done:**
- [ ] All endpoints documented with schemas and examples
- [ ] Organized by feature area
- [ ] Authentication requirements clear

---

### 2.2 New Docs Pages

**`/docs/concepts/identity`** — What agent identity is, how it's built from memories, capabilities, preferences, trust signals.

**`/docs/concepts/delegation`** — Task lifecycle, delegation contracts, templates, how agents work together.

**`/docs/concepts/trust`** — Trust signal extraction, time-decayed scoring, trust as living memory, challenge protocol.

**`/docs/concepts/awareness`** — Waking Cycle, insight surfacing, feedback loops, proactive notifications.

**`/docs/operations/sync`** — Cloud linking, push/pull sync, reconciliation flow, auto-sync configuration.

**Definition of Done:**
- [ ] Each page has clear explanation with diagrams where helpful
- [ ] Cross-linked between related concepts
- [ ] Code examples for MCP/API integration
- [ ] Accessible to non-technical users (dashboard guides) and developers (API guides)

---

### 2.3 Architecture Doc (`/docs/architecture`)

Update existing architecture page to include:
- Identity module diagram (how capabilities, trust, preferences flow from memories)
- Delegation flow diagram (task assignment → execution → outcome → trust update)
- Sync architecture diagram (local ↔ cloud, reconciliation flow)
- Module dependency graph

**Definition of Done:**
- [ ] Diagrams render correctly (use Mermaid or inline SVG)
- [ ] Module relationships clear
- [ ] Data flow paths documented

---

## 3. Production Deployment

### 3.1 Prisma Migrations

New models that need migration (none have been run yet):

**From identity framework:**
- `TrustSignal` — behavioral trust signals
- `TrustScore` — computed trust scores
- `CapabilityCheckpoint` — capability snapshots
- `ExperienceWeight` — experience-weighted recall data
- `IdentitySnapshot` — dream cycle identity consolidation
- `AgentCapabilityProfile` — persistent capability profiles
- `AgentWorkStyle` — work style tracking
- `DelegatedTask` — task completion tracking
- `DelegationTemplate` — reusable delegation patterns
- `DelegationContract` — formal delegation contracts

**From memory enhancements:**
- `visibility` field on Memory (PRIVATE/TEAM/PUBLIC enum)
- `TASK_OUTCOME` and `SELF_ASSESSMENT` added to MemoryType enum
- `PREFERENCE` added to MemoryLayer enum (if not already)

### 3.2 Deployment Steps

1. **Merge main → production branch**
2. **Run `prisma migrate deploy`** on staging first
3. **Verify staging** — test identity endpoints, sync, awareness cycle
4. **Run `prisma migrate deploy`** on production
5. **Set new env vars** (JWT_SECRET already discussed)
6. **Verify production** — smoke test critical paths

### 3.3 Rollback Plan

- Keep production branch at previous commit until staging verified
- Migration rollback SQL documented per migration
- Feature flags for new UI pages (can hide behind edition guard if needed)

**Definition of Done:**
- [ ] All migrations run successfully on staging
- [ ] Staging smoke tests pass
- [ ] Production deployed and verified
- [ ] No regressions on existing features

---

## 4. Task Breakdown

### Phase 1: Documentation (do first — clarifies requirements)
| # | Task | Owner | Est |
|---|------|-------|-----|
| D1 | API reference for all new endpoints | TBD | 2h |
| D2 | Identity concepts page | TBD | 1h |
| D3 | Delegation concepts page | TBD | 1h |
| D4 | Trust concepts page | TBD | 1h |
| D5 | Awareness concepts page | TBD | 1h |
| D6 | Sync operations page | TBD | 1h |
| D7 | Architecture diagrams update | TBD | 1.5h |

### Phase 2: Dashboard UI
| # | Task | Owner | Est | Dependencies |
|---|------|-------|-----|--------------|
| U1 | Agent Identity page | TBD | 3h | — |
| U2 | Agent List page | TBD | 2h | U1 |
| U3 | Delegation & Tasks page | TBD | 3h | — |
| U4 | Teams page | TBD | 2h | — |
| U5 | Insights & Awareness page | TBD | 2.5h | — |
| U6 | Challenges page | TBD | 2h | — |
| U7 | Sync & Reconciliation UI | TBD | 2.5h | — |
| U8 | Navigation updates + edition gating | TBD | 1h | U1-U7 |
| U9 | Component tests (Vitest) for new pages | TBD | 2h | U1-U7 |

### Phase 3: Production Deployment
| # | Task | Owner | Est | Dependencies |
|---|------|-------|-----|--------------|
| P1 | Generate consolidated migration | TBD | 1h | — |
| P2 | Deploy + migrate staging | TBD | 1h | P1 |
| P3 | Staging smoke tests | TBD | 1h | P2 |
| P4 | Merge main → production | TBD | 0.5h | P3 |
| P5 | Deploy + migrate production | TBD | 1h | P4 |
| P6 | Production verification | TBD | 1h | P5 |

**Total estimated: ~32 hours of work**

---

## 5. Open Questions for Beaux

1. **Priority order:** Docs first (Phase 1) then UI (Phase 2) then deploy (Phase 3)? Or deploy first to get backend features live?
2. **Edition gating:** Should identity features be available to all users, or gated behind a plan tier?
3. **Agent avatars:** Do we want avatar upload support on the identity page, or just placeholder icons for now?
4. **Dashboard tests:** Vitest unit tests sufficient, or do you want Playwright E2E for the new pages too?
5. **Feature flags:** Should new pages be hidden behind a feature flag until fully tested, or ship incrementally?

---

*Spec authored by Kit 🦊, reviewed by Rook ♜. Ready for Beaux's review.*
