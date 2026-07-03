# Identity Dashboard UI Specification

**Version**: 1.0  
**Date**: 2026-02-20  
**Status**: Draft  
**Backend Tickets**: HEY-182 through HEY-190 (completed)

---

## 1. Overview

### Purpose

The Identity Dashboard exposes Engram's agent identity framework to operators and developers. It provides visibility into agent capabilities, trust profiles, delegation contracts, team composition, delegation recall, and portable identity management — all built on the backend services completed in HEY-182 through HEY-190.

### Target Users

- **AI Agent Operators**: Monitor agent performance, trust trends, delegation outcomes, and failure patterns. Create and manage teams. Review challenges.
- **Developers**: Debug delegation flows, test recall queries, export/import agent identities across environments.

### Dashboard Integration

Identity is a new top-level section in the existing sidebar navigation, positioned after "Pools" and before "API Keys". It uses the same `(dashboard)` layout group (Sidebar + Header + ErrorBoundary).

---

## 2. Navigation & Information Architecture

### Sidebar Placement

Add to the `navigation` array in `src/components/layout/sidebar.tsx`:

```typescript
// After Pools, before API Keys
{ name: "Identity", href: "/identity", icon: Fingerprint },
```

Icon: `Fingerprint` from `lucide-react`.

### Sub-navigation

Identity uses a horizontal tab bar (consistent with Analytics page pattern) for sub-pages:

| Tab | Route | Description |
|-----|-------|-------------|
| Overview | `/identity` | Agent profiles & capabilities |
| Contracts | `/identity/contracts` | Delegation contracts & challenges |
| Teams | `/identity/teams` | Team management |
| Trust | `/identity/trust` | Trust profiles & trends |
| Recall | `/identity/recall` | Delegation-aware recall search |
| Export/Import | `/identity/export` | Portable identity |

### Breadcrumb Structure

```
Identity > [Sub-page]
Identity > Contracts > [Contract ID]
Identity > Teams > [Team Name]
```

### Relationship to Existing Pages

- **Sessions**: Sessions show conversation context; Identity shows agent capability/trust profiles derived from task completions across sessions.
- **Graph**: Graph visualizes memory relationships; Identity visualizes agent relationships (teams, collaboration pairs).
- **Analytics**: Analytics covers memory volume/type metrics; Identity covers agent performance metrics.
- **Pools**: Pools manage shared memory namespaces; Teams manage agent groupings for delegation.

---

## 3. Pages & Components

### 3.1 Agent Identity Overview (`/identity`)

#### User Stories

- As an operator, I want to see an agent's capability profile at a glance, so I can assess if it's suitable for a task domain.
- As a developer, I want to see behavioral consistency indicators, so I can detect agents drifting from expected behavior.
- As an operator, I want to browse all registered agents, so I can compare capabilities across my fleet.

#### Layout

```
┌─────────────────────────────────────────────────┐
│ [Agent Selector Dropdown]                       │
├──────────────────────┬──────────────────────────┤
│ Agent Profile Card   │ Capability Chart         │
│ - Name, ID           │ (Recharts RadarChart or  │
│ - Active since       │  BarChart of domain      │
│ - Total tasks        │  confidence scores)      │
│ - Overall trust      │                          │
│ - Work style tags    │                          │
├──────────────────────┴──────────────────────────┤
│ Trust Profile Breakdown                         │
│ ┌─────────┬───────┬──────────┬────────┬───────┐ │
│ │ Domain  │ Trust │ Tasks    │ Trend  │ Last  │ │
│ │ coding  │ 0.85  │ 47       │ ↑      │ 2h    │ │
│ │ analysis│ 0.72  │ 23       │ →      │ 1d    │ │
│ └─────────┴───────┴──────────┴────────┴───────┘ │
├─────────────────────────────────────────────────┤
│ Recent Task Completions (last 10)               │
│ ┌──────────────┬────────┬──────────┬──────────┐ │
│ │ Task         │ Outcome│ Duration │ Domain   │ │
│ └──────────────┴────────┴──────────┴──────────┘ │
├─────────────────────────────────────────────────┤
│ Behavioral Consistency                          │
│ - Success rate variance (last 7d vs all-time)   │
│ - Domain drift indicator                        │
│ - Avg response quality trend                    │
└─────────────────────────────────────────────────┘
```

#### Data Flow

| Section | Endpoint | Method |
|---------|----------|--------|
| Agent list (selector) | `GET /v1/users` (filtered to agents) | GET |
| Trust profile | `GET /v1/identity/agents/:id/trust-profile` | GET |
| Task completions | `GET /v1/identity/task-completions?agentId=:id&limit=10` | GET |
| Capability data | Derived from trust profile `domains` array | — |

**Request**: `GET /v1/identity/agents/{agentId}/trust-profile`

**Response** (`TrustProfile`):
```typescript
{
  agentId: string;
  overallTrust: number;        // 0.0-1.0
  domains: DomainTrust[];      // { domain, trustScore, totalTasks, successRate, avgDurationMs, lastTaskAt, trend }
  totalTasksCompleted: number;
  lastUpdatedAt: string;       // ISO date
}
```

**Request**: `GET /v1/identity/task-completions?agentId={id}&limit=10`

**Response**:
```typescript
{
  completions: TaskCompletion[];  // { taskId, delegatedTo, delegatedBy, taskDescription, domain, outcome, durationMs, qualitySignals, createdAt }
  total: number;
}
```

#### States

- **Loading**: Skeleton cards for profile, skeleton rows for tables, pulsing chart placeholder.
- **Empty (no agents)**: Illustration + "No agents have completed tasks yet. Task completions are recorded automatically when delegation contracts complete or via the API." + link to docs.
- **Empty (agent selected, no data)**: Profile card shows agent name/ID with "No task history" message. Chart shows empty radar with domain labels at 0. Tables show "No completions recorded."
- **Error**: Red alert banner: "Failed to load agent profile. [Retry]" — preserves last loaded data if available.

#### Mobile Responsiveness

- Agent selector: full-width dropdown.
- Profile card + chart: stack vertically (card on top, chart below).
- Tables: horizontal scroll with sticky first column.

#### Accessibility

- Agent selector: `aria-label="Select agent"`, keyboard navigable.
- Chart: `aria-label` with text summary of top capabilities. Screen reader fallback: data table below chart.
- Trend indicators: use both icon AND text ("improving", "declining", "stable") — not color alone.
- Trust score badges: sufficient contrast ratio (WCAG AA).

---

### 3.2 Delegation Contracts (`/identity/contracts`)

#### User Stories

- As an operator, I want to see all active delegation contracts, so I can monitor in-flight work.
- As an operator, I want to view contract details including success criteria and constraints, so I can understand what was expected.
- As a developer, I want to create delegation contracts through the UI, so I can test the contract flow.
- As an operator, I want to see challenges raised against contracts, so I can intervene when agents push back on tasks.

#### Layout

```
┌─────────────────────────────────────────────────┐
│ Contracts                          [+ Create]   │
│ ┌──────────────────────────────────────────────┐│
││ Filters: [Status ▼] [Agent ▼] [Date range]   ││
│└──────────────────────────────────────────────┘ │
│ ┌──────┬───────────────┬────────┬───────┬─────┐ │
│ │Status│ Task          │ Agent  │ Time  │ ⚠️   │ │
│ │ ● ⏳ │ Deploy v2.1   │ agent-a│ 5m ago│ 1   │ │
│ │ ● ✅ │ Run tests     │ agent-b│ 1h ago│ 0   │ │
│ │ ● ❌ │ Data migration│ agent-c│ 2h ago│ 2   │ │
│ └──────┴───────────────┴────────┴───────┴─────┘ │
└─────────────────────────────────────────────────┘
```

**Contract Detail View** (slide-out panel or `/identity/contracts/:id`):

```
┌─────────────────────────────────────────────────┐
│ ← Back    Contract: Deploy v2.1                 │
├─────────────────────────────────────────────────┤
│ Status: ✅ Completed   Agent: agent-a           │
│ Created: 2026-02-20 10:15   Completed: 10:22   │
├─────────────────────────────────────────────────┤
│ Expected Outputs:                               │
│ • Deployment artifact uploaded                  │
│ • Health check passing                          │
│                                                 │
│ Success Criteria:                               │
│ • All endpoints responding 200                  │
│ • No error logs in 5min window                  │
│                                                 │
│ Constraints:                                    │
│ • No database migrations                        │
│ • Max 10min execution time                      │
│                                                 │
│ Result:                                         │
│ "Deployed successfully to staging..."           │
├─────────────────────────────────────────────────┤
│ Challenges (1)                                  │
│ ┌─────────┬───────────────────────┬───────────┐ │
│ │ Type    │ Reasoning             │ Resolution│ │
│ │ cap_mis │ Low confidence in...  │ overridden│ │
│ └─────────┴───────────────────────┴───────────┘ │
│                        [Raise Challenge]        │
└─────────────────────────────────────────────────┘
```

**Create Contract Form** (Dialog):

```
┌─────────────────────────────────────────────────┐
│ Create Delegation Contract                      │
├─────────────────────────────────────────────────┤
│ Task Description:     [___________________]     │
│ Delegate To (Agent):  [___ dropdown ______]     │
│ Timeout (ms):         [30000_____________]      │
│                                                 │
│ Expected Outputs:     [________________] [+ Add]│
│ Success Criteria:     [________________] [+ Add]│
│ Constraints:          [________________] [+ Add]│
│                                                 │
│              [Cancel]  [Create Contract]        │
└─────────────────────────────────────────────────┘
```

**Raise Challenge Form** (Dialog):

```
┌─────────────────────────────────────────────────┐
│ Raise Challenge                                 │
├─────────────────────────────────────────────────┤
│ Type: [unsafe | underspecified |                 │
│        capability_mismatch | resource_constraint]│
│ Reasoning: [_______________________________]    │
│                                                 │
│              [Cancel]  [Submit Challenge]        │
└─────────────────────────────────────────────────┘
```

#### Data Flow

| Action | Endpoint | Method |
|--------|----------|--------|
| List contracts | `GET /v1/identity/contracts` | GET |
| Get contract | `GET /v1/identity/contracts/:id` | GET |
| Create contract | `POST /v1/identity/contracts` | POST |
| Complete contract | `POST /v1/identity/contracts/:id/complete` | POST |
| List challenges | `GET /v1/identity/challenges?contractId=:id` | GET |
| Create challenge | `POST /v1/identity/challenges` | POST |
| Resolve challenge | `POST /v1/identity/challenges/:id/resolve` | POST |
| Failure patterns | `GET /v1/identity/failure-patterns?agentId=:id` | GET |

> **Note**: The controller currently exposes contracts/challenges through in-memory services without REST endpoints for list/get/create/complete on contracts and challenges. **Backend work needed**: Add these REST endpoints to `IdentityController`. The services (`DelegationContractService`, `ChallengeService`) already support all operations — they just need controller wiring. See Task Breakdown §5.

**CreateContractDto** (request body):
```typescript
{
  taskDescription: string;
  expectedOutputs: string[];
  successCriteria: string[];
  timeout: number;
  constraints?: string[];
  delegatedTo: string;
}
```

**DelegationContract** (response):
```typescript
{
  id: string;
  taskDescription: string;
  expectedOutputs: string[];
  successCriteria: string[];
  timeout: number;
  constraints: string[];
  delegatedTo: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'timed_out';
  result?: string;
  createdAt: string;
  completedAt?: string;
}
```

**Challenge** (response):
```typescript
{
  id: string;
  contractId?: string;
  taskDescription: string;
  challengeType: 'unsafe' | 'underspecified' | 'capability_mismatch' | 'resource_constraint';
  reasoning: string;
  resolution?: 'accepted' | 'overridden' | 'modified';
  resolvedBy?: string;
  createdAt: string;
  resolvedAt?: string;
}
```

#### States

- **Loading**: Skeleton table rows (5 rows).
- **Empty**: "No delegation contracts yet. Contracts are created when tasks are delegated to agents." + [Create Contract] CTA.
- **Error**: Alert banner with retry. Table shows stale data if available.
- **Contract detail loading**: Skeleton blocks for each section.
- **No challenges on contract**: "No challenges raised" text in challenges section.

#### Mobile Responsiveness

- Contract list: card layout instead of table on `< md` breakpoint.
- Contract detail: full-page view (no slide-out).
- Create form: full-screen dialog on mobile.

#### Accessibility

- Status indicators: color + icon + `aria-label` (e.g., `aria-label="Status: completed"`).
- Challenge type selector: radio group with descriptions.
- Dynamic arrays (outputs, criteria): announce additions/removals via `aria-live="polite"`.
- Forms: all inputs labeled, validation errors linked via `aria-describedby`.

---

### 3.3 Teams (`/identity/teams`)

#### User Stories

- As an operator, I want to see all teams with their member counts and collaboration scores, so I can evaluate team health.
- As an operator, I want to view aggregated team capabilities, so I can identify capability gaps.
- As an operator, I want to see which agent pairs work well together, so I can optimize team composition.
- As a developer, I want to create and edit teams, so I can test multi-agent delegation.

#### Layout

**Team List**:

```
┌─────────────────────────────────────────────────┐
│ Teams                              [+ Create]   │
│ ┌──────────────────────────────────────────────┐│
││ ┌────────────────┐ ┌────────────────┐        ││
││ │ Backend Squad  │ │ QA Team        │        ││
││ │ 4 agents       │ │ 2 agents       │        ││
││ │ Collab: 0.82   │ │ Collab: 0.91   │        ││
││ │ Top: coding,   │ │ Top: testing,  │        ││
││ │ deployment     │ │ analysis       │        ││
││ └────────────────┘ └────────────────┘        ││
│└──────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

**Team Detail** (`/identity/teams/:id`):

```
┌─────────────────────────────────────────────────┐
│ ← Teams    Backend Squad            [Edit]      │
├──────────────────────┬──────────────────────────┤
│ Team Info            │ Aggregated Capabilities   │
│ 4 members            │ (BarChart)                │
│ Collab score: 0.82   │ coding ████████░░ 0.85   │
│ Created: Feb 18      │ deploy ██████░░░░ 0.62   │
│ Last active: 2h ago  │ analysis ████░░░░░ 0.41  │
├──────────────────────┴──────────────────────────┤
│ Members                                         │
│ ┌───────────┬────────────────┬─────────────────┐│
│ │ Agent     │ Capabilities   │ Trust Score     ││
│ │ agent-a   │ coding, deploy │ 0.88            ││
│ │ agent-b   │ coding, test   │ 0.79            ││
│ └───────────┴────────────────┴─────────────────┘│
├─────────────────────────────────────────────────┤
│ Collaboration Pairs                             │
│ ┌──────────────────┬───────┬──────────────────┐ │
│ │ Pair             │ Tasks │ Success Rate     │ │
│ │ agent-a ↔ agent-b│ 12    │ 92%              │ │
│ │ agent-a ↔ agent-c│ 5     │ 80%              │ │
│ └──────────────────┴───────┴──────────────────┘ │
└─────────────────────────────────────────────────┘
```

**Create/Edit Team** (Dialog):

```
┌─────────────────────────────────────────────────┐
│ Create Team                                     │
├─────────────────────────────────────────────────┤
│ Name:         [___________________]             │
│ Description:  [___________________]             │
│ Members:      [Multi-select agent dropdown]     │
│               agent-a ✕  agent-b ✕  [+ Add]    │
│                                                 │
│              [Cancel]  [Create Team]            │
└─────────────────────────────────────────────────┘
```

#### Data Flow

| Action | Endpoint | Method |
|--------|----------|--------|
| List teams | `GET /v1/identity/teams` | GET |
| Get team | `GET /v1/identity/teams/:id` | GET |
| Create team | `POST /v1/identity/teams` | POST |
| Team capabilities | `GET /v1/identity/teams/:id/capabilities` | GET |
| Collaboration pairs | `GET /v1/identity/teams/:id/collaboration` | GET |

> **Note**: `GET /v1/identity/teams` (list all) and `GET /v1/identity/teams/:id/collaboration` need backend endpoints added. See Task Breakdown §5.

**CreateTeamDto**:
```typescript
{ name: string; agentIds: string[]; description?: string; }
```

**TeamProfile** (response):
```typescript
{
  id: string;
  name: string;
  description?: string;
  agentIds: string[];
  capabilities: TeamCapability[];  // { name, score, contributors[] }
  collaborationScore: number;
  lastActive: string;
  createdAt: string;
  updatedAt: string;
}
```

**CollaborationPair** (response):
```typescript
{ agentA: string; agentB: string; taskCount: number; successRate: number; }
```

#### States

- **Loading**: Grid of skeleton cards (3).
- **Empty**: "No teams configured. Create a team to aggregate agent capabilities and track collaboration." + [Create Team] CTA.
- **Team detail loading**: Skeleton layout.
- **Team with 1 member**: Collaboration pairs section shows "Add more members to see collaboration data."
- **Error**: Alert banner with retry.

#### Mobile Responsiveness

- Team cards: single column stack on mobile.
- Team detail: sections stack vertically.
- Create dialog: full-screen on mobile.

#### Accessibility

- Team cards: `role="article"`, keyboard focusable.
- Multi-select: ARIA combobox pattern, selected items removable via keyboard.
- Collaboration chart: data table alternative.

---

### 3.4 Trust Profiles (`/identity/trust`)

#### User Stories

- As an operator, I want to see trust profiles per agent per domain, so I can make informed delegation decisions.
- As an operator, I want to see trust trends over time, so I can detect improving or degrading agents.
- As an operator, I want to compare trust across agents, so I can pick the best agent for a domain.

#### Layout

```
┌─────────────────────────────────────────────────┐
│ Trust Profiles                                  │
│ [Agent selector: All ▼]  [Domain filter ▼]      │
├─────────────────────────────────────────────────┤
│ Trust Overview Table                            │
│ ┌──────────┬────────┬───────┬──────┬────┬─────┐ │
│ │ Agent    │ Domain │ Trust │ Tasks│Rate│Trend│ │
│ │ agent-a  │ coding │ 0.91  │ 47   │96% │ ↑  │ │
│ │ agent-a  │ deploy │ 0.72  │ 12   │75% │ →  │ │
│ │ agent-b  │ testing│ 0.88  │ 31   │90% │ ↑  │ │
│ └──────────┴────────┴───────┴──────┴────┴─────┘ │
├─────────────────────────────────────────────────┤
│ Trust History Chart (Recharts LineChart)         │
│ [Select agent(s)] [Time range: 30d ▼]           │
│                                                 │
│  1.0 ─     ╱──────                              │
│  0.8 ─ ───╱                                     │
│  0.6 ─                                          │
│  0.4 ─                                          │
│       ├─────┼─────┼─────┼─────┼─────┤           │
│       Feb 1  Feb 5  Feb 10 Feb 15 Feb 20        │
└─────────────────────────────────────────────────┘
```

#### Data Flow

| Action | Endpoint | Method |
|--------|----------|--------|
| Trust profile | `GET /v1/identity/agents/:id/trust-profile` | GET |
| All agents trust | Loop `GET /v1/identity/agents/:id/trust-profile` per agent | GET |

> **Note**: A bulk endpoint `GET /v1/identity/trust-profiles` would be more efficient. Currently requires N+1 calls. **Recommended backend addition**: `GET /v1/identity/trust-profiles?agentIds=a,b,c`. Also, trust history over time requires a new endpoint `GET /v1/identity/agents/:id/trust-history?days=30` backed by persisted snapshots. See Task Breakdown §5.

#### States

- **Loading**: Skeleton table + placeholder chart.
- **Empty**: "No trust data yet. Trust profiles are built automatically from task completion records." + link to task completions docs.
- **Single agent, no domains**: Agent row with "No domain data" and overall trust = 0.
- **Error**: Alert banner with retry.

#### Mobile Responsiveness

- Table: horizontal scroll, sticky agent column.
- Chart: full-width, touch-friendly tooltips.
- Filters: stacked vertically.

#### Accessibility

- Trend indicators: text labels ("improving") in addition to arrows. `aria-label` on icon.
- Chart: `aria-label` summary. Data table shown below chart as screen-reader alternative.
- Trust scores: `aria-valuemin="0" aria-valuemax="1" aria-valuenow="0.91"` on progress indicators.

---

### 3.5 Delegation Recall (`/identity/recall`)

#### User Stories

- As a developer, I want to search for similar past tasks by description, so I can see historical outcomes before delegating.
- As an operator, I want to see the recommended agent for a task, so I can make data-driven delegation decisions.
- As an operator, I want to see known failure patterns for similar tasks, so I can anticipate pitfalls.

#### Layout

```
┌─────────────────────────────────────────────────┐
│ Delegation Recall                               │
├─────────────────────────────────────────────────┤
│ [Search: Describe the task...        ] [Search] │
├─────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────┐ │
│ │ 💡 Recommended Agent: agent-a               │ │
│ │ Reason: 92% success rate on 8 similar tasks │ │
│ └─────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────┤
│ Similar Past Tasks                              │
│ ┌───────────────────┬────────┬───────┬────────┐ │
│ │ Task              │ Agent  │Outcome│ Score  │ │
│ │ Deploy backend v2 │agent-a │success│ 0.89   │ │
│ │ Deploy frontend   │agent-b │partial│ 0.65   │ │
│ │ Deploy staging    │agent-a │success│ 0.82   │ │
│ └───────────────────┴────────┴───────┴────────┘ │
├─────────────────────────────────────────────────┤
│ ⚠️ Known Failure Patterns                       │
│ • Task failed to complete (freq: 2, last: 3d)  │
│ • Task only partially completed (freq: 1)      │
└─────────────────────────────────────────────────┘
```

#### Data Flow

| Action | Endpoint | Method |
|--------|----------|--------|
| Search recall | `GET /v1/identity/delegation-recall?task={query}&limit=10` | GET |

**DelegationRecallResult** (response):
```typescript
{
  query: string;
  similarTasks: SimilarTask[];       // { memoryId, taskDescription, agentId, outcome, score, createdAt }
  failurePatterns: FailurePattern[]; // { description, frequency, lastOccurred }
  recommendedAgent: string | null;
  recommendationReason: string | null;
}
```

#### States

- **Initial**: Search input focused, empty results area with hint text: "Enter a task description to find similar past delegations."
- **Loading**: Spinner on search button, skeleton results.
- **Results**: As shown in layout.
- **No results**: "No similar past tasks found for this query."
- **No recommendation**: Recommendation card hidden when `recommendedAgent` is null.
- **Error**: Inline error below search bar: "Search failed. [Retry]"

#### Mobile Responsiveness

- Search bar: full-width.
- Results table: card layout on mobile.
- Recommendation card: full-width.

#### Accessibility

- Search: `role="search"`, `aria-label="Search for similar past tasks"`.
- Results: `aria-live="polite"` region announces result count.
- Outcome badges: text + color (not color alone).

---

### 3.6 Portable Identity (`/identity/export`)

#### User Stories

- As a developer, I want to export an agent's identity as JSON, so I can transfer it to another Engram instance.
- As a developer, I want to import an agent identity from JSON, so I can restore or clone an agent's profile.
- As a developer, I want to verify the integrity hash before importing, so I can trust the data hasn't been tampered with.

#### Layout

```
┌─────────────────────────────────────────────────┐
│ Portable Identity                               │
├──────────────────────┬──────────────────────────┤
│ Export               │ Import                   │
│                      │                          │
│ Agent: [dropdown ▼]  │ [Upload JSON file]       │
│                      │ or drag & drop           │
│ [Export Identity]    │                          │
│                      │ ┌──────────────────────┐ │
│ Preview:             │ │ Preview:             │ │
│ Schema: 1.0.0        │ │ Agent: agent-x       │ │
│ Capabilities: 5      │ │ Schema: 1.0.0        │ │
│ Trust: 0.87          │ │ Capabilities: 3      │ │
│ Tasks: 142           │ │ Hash: ✅ Valid        │ │
│                      │ │                      │ │
│ [Download JSON]      │ │ Target Agent:        │ │
│                      │ │ [___ optional ___]   │ │
│                      │ │                      │ │
│                      │ │ [Import Identity]    │ │
│                      │ └──────────────────────┘ │
└──────────────────────┴──────────────────────────┘
```

#### Data Flow

| Action | Endpoint | Method |
|--------|----------|--------|
| Export | `GET /v1/identity/agents/:id/export` | GET |
| Import | `POST /v1/identity/agents/import` | POST |

**PortableIdentityExport** (export response / import request body):
```typescript
{
  schemaVersion: string;    // "1.0.0"
  exportedAt: string;
  agentId: string;
  agentName: string;
  capabilities: CapabilityProfile[];    // { name, score, evidenceCount }
  preferences: Record<string, any>;
  trustProfile: TrustProfile;           // { totalTasks, successRate, avgResponseQuality, specializations }
  workHistorySummary: WorkHistorySummary; // { totalMemories, taskCompletions, reflections, activeSince, topCategories }
  collaborationPatterns: CollaborationPattern[]; // { partnerAgentId, interactionCount, avgOutcomeScore }
  integrityHash: string;                // SHA-256
}
```

**Import request**:
```typescript
{ identity: PortableIdentityExport; targetAgentId?: string; }
```

**Import response**:
```typescript
{ agentId: string; memoriesCreated: number; }
```

#### States

- **Loading (export)**: Spinner on export button.
- **Export preview**: Shows summary card before download.
- **No agents**: "No agents available for export."
- **Import: no file**: Drop zone with upload prompt.
- **Import: file loaded**: Preview with hash verification status.
- **Import: hash invalid**: Red alert: "⚠️ Integrity check failed — this export may have been tampered with." Import button disabled.
- **Import: schema mismatch**: Warning: "Schema version X.Y.Z is not compatible with current version 1.0.0." Import button disabled.
- **Import: success**: Success toast: "Identity imported. {N} memories created for agent {id}."
- **Error**: Inline error message with details.

#### Mobile Responsiveness

- Export/Import panels: stack vertically on mobile.
- File drop zone: tap-to-upload on mobile (no drag).

#### Accessibility

- File upload: `aria-label="Upload identity JSON file"`, keyboard accessible.
- Hash verification: status announced via `aria-live`.
- Export download: standard `<a download>` pattern.

---

## 4. Design Guidelines

### Visual Consistency

Follow the existing dashboard patterns:
- **Theme**: Dark theme (`bg-background`, `bg-card`) with green brand accents (`text-brand-500`).
- **Active nav**: `bg-primary text-primary-foreground`.
- **Cards**: Use existing `Card` component from `src/components/ui/card.tsx`.
- **Tables**: Use existing `Table` component from `src/components/ui/table.tsx`.
- **Badges**: Use existing `Badge` component for status indicators.
- **Dialogs**: Use existing `Dialog` component for create/edit forms.
- **Buttons**: Use existing `Button` component.
- **Inputs**: Use existing `Input` component.
- **Tabs**: Use existing `Tabs` component for sub-navigation.
- **Skeletons**: Use existing `Skeleton` component for loading states.
- **Tooltips**: Use existing `Tooltip` component.

### Chart Library

**Recharts 3.7** (already installed). Use consistently with existing analytics charts in `src/app/(dashboard)/analytics/components/`:
- `LineChart` for trust history trends (reference: `memory-timeline.tsx`).
- `BarChart` for capability scores (reference: `type-breakdown-chart.tsx`).
- `RadarChart` for capability radar (new, but Recharts supports it natively).
- Color palette: use `src/lib/analytics-colors.ts` for chart colors.

### Component Reuse

| Existing Component | Use For |
|---|---|
| `Card, CardHeader, CardContent` | Profile cards, stat cards, recommendation card |
| `Table, TableHeader, TableBody, TableRow, TableCell` | All data tables |
| `Badge` | Status badges (pending, completed, failed, timed_out), challenge types |
| `Dialog, DialogContent, DialogHeader, DialogTitle` | Create contract, create team, raise challenge |
| `Tabs, TabsList, TabsTrigger, TabsContent` | Sub-navigation within identity section |
| `Skeleton` | All loading states |
| `Button` | Actions, CTAs |
| `Input` | Form fields |
| `DropdownMenu` | Agent selector, filters |
| `Tooltip` | Hover explanations for scores/metrics |
| `Avatar` | Agent avatars (with Fingerprint icon fallback) |
| `Progress` | Trust score bars |
| `Separator` | Section dividers |
| `Switch` | Toggle options |
| `ErrorBoundary` | Page-level error handling (already in layout) |

### New Components to Create

| Component | Location | Description |
|---|---|---|
| `IdentityTabNav` | `src/app/(dashboard)/identity/components/` | Horizontal tab navigation for identity sub-pages |
| `AgentProfileCard` | same | Agent summary card with name, trust, capabilities |
| `CapabilityChart` | same | Radar/bar chart for domain confidence scores |
| `TrustTrendChart` | same | Line chart for trust over time |
| `ContractStatusBadge` | same | Color-coded status badge for contract statuses |
| `ChallengeTypeBadge` | same | Badge for challenge types |
| `DynamicArrayInput` | same | Reusable input for adding/removing string items (outputs, criteria) |
| `FileDropZone` | same | Drag-and-drop file upload for identity import |
| `EmptyState` | `src/components/ui/` | Generic empty state with icon, message, CTA (reusable) |

---

## 5. Task Breakdown

### Phase 0: Backend API Completion

#### T0.1: Contract & Challenge REST Endpoints
- **Description**: Wire `DelegationContractService` and `ChallengeService` methods to REST endpoints in `IdentityController`: list contracts, get contract, create contract, complete contract, list challenges, create challenge, resolve challenge, list failure patterns.
- **Effort**: M
- **Dependencies**: None (services exist)
- **DoD**: All endpoints return correct data. Swagger docs generated. Integration tests pass for each endpoint.

#### T0.2: Team List & Collaboration Endpoints
- **Description**: Add `GET /v1/identity/teams` (list all) and `GET /v1/identity/teams/:id/collaboration` (collaboration pairs) to `IdentityController`.
- **Effort**: S
- **Dependencies**: None (service methods exist)
- **DoD**: Endpoints return correct data. Swagger docs generated.

#### T0.3: Bulk Trust Profile Endpoint
- **Description**: Add `GET /v1/identity/trust-profiles?agentIds=a,b,c` to return multiple trust profiles in one call.
- **Effort**: S
- **Dependencies**: None
- **DoD**: Endpoint returns array of TrustProfile objects. Works with empty agentIds (returns all).

#### T0.4: Trust History Endpoint
- **Description**: Add `GET /v1/identity/agents/:id/trust-history?days=30` that returns daily trust snapshots. Requires either periodic snapshot storage or on-the-fly calculation from task completions grouped by day.
- **Effort**: L
- **Dependencies**: T0.1
- **DoD**: Returns array of `{ date, overallTrust, domains: { domain, trustScore }[] }`. Tested with 30/60/90 day ranges.

### Phase 1: Foundation

#### T1.1: Identity API Client
- **Description**: Add identity methods to `EngramClient` in `src/lib/engram-client.ts`: `getTrustProfile`, `getTaskCompletions`, `listContracts`, `getContract`, `createContract`, `completeContract`, `listChallenges`, `createChallenge`, `resolveChallenge`, `listTeams`, `getTeam`, `createTeam`, `getTeamCapabilities`, `getCollaborationPairs`, `delegationRecall`, `exportIdentity`, `importIdentity`, `listFailurePatterns`, `getTrustProfiles`, `getTrustHistory`.
- **Effort**: M
- **Dependencies**: T0.1, T0.2, T0.3, T0.4
- **DoD**: All methods typed. Error handling consistent with existing client patterns. Exported from `engram-client.ts`.

#### T1.2: Identity Types
- **Description**: Add TypeScript interfaces to `src/lib/types.ts` for all identity API response types: `TrustProfile`, `DomainTrust`, `DelegationContract`, `Challenge`, `FailurePattern`, `TeamProfile`, `TeamCapability`, `CollaborationPair`, `DelegationRecallResult`, `SimilarTask`, `PortableIdentityExport`, `TaskCompletion`.
- **Effort**: S
- **Dependencies**: None
- **DoD**: All types match backend DTOs. No `any` types.

#### T1.3: Sidebar Navigation
- **Description**: Add Identity nav item to sidebar with `Fingerprint` icon from lucide-react, positioned after "Pools".
- **Effort**: S
- **Dependencies**: None
- **DoD**: Sidebar shows "Identity" item. Active state highlights correctly on `/identity` and all sub-routes.

#### T1.4: Identity Layout & Tab Navigation
- **Description**: Create `src/app/(dashboard)/identity/layout.tsx` with `IdentityTabNav` component providing horizontal tabs for all sub-pages. Create page route files for each sub-page.
- **Effort**: S
- **Dependencies**: T1.3
- **DoD**: All 6 routes render. Tab navigation works. Active tab highlights correctly. Breadcrumbs display.

#### T1.5: Shared Components
- **Description**: Build `EmptyState`, `DynamicArrayInput`, `FileDropZone`, `ContractStatusBadge`, `ChallengeTypeBadge` components.
- **Effort**: M
- **Dependencies**: None
- **DoD**: Components render correctly in isolation. Storybook stories or test files for each. Accessible (keyboard, screen reader).

### Phase 2: Core Pages

#### T2.1: Agent Identity Overview Page
- **Description**: Build `/identity` page with agent selector, profile card, capability chart (Recharts Radar or Bar), trust breakdown table, recent completions table, behavioral consistency section.
- **Effort**: L
- **Dependencies**: T1.1, T1.2, T1.4, T1.5
- **DoD**: Page loads agent data. Chart renders domain scores. Table shows trust breakdown with trend indicators. Recent completions list with outcome badges. Loading/empty/error states all work. Responsive on mobile.

#### T2.2: Delegation Contracts Page
- **Description**: Build `/identity/contracts` with filterable contract list, contract detail view (slide-out or sub-route), create contract dialog, challenge list per contract, raise challenge dialog, resolve challenge action.
- **Effort**: XL
- **Dependencies**: T1.1, T1.2, T1.4, T1.5
- **DoD**: Contract list with status/agent/date filters. Contract detail shows all fields. Create form validates and submits. Challenges display with resolution status. Raise/resolve challenge works. All states handled. Responsive.

#### T2.3: Teams Page
- **Description**: Build `/identity/teams` with team card grid, team detail view with capability bar chart, member table, collaboration pairs table, create/edit team dialog.
- **Effort**: L
- **Dependencies**: T1.1, T1.2, T1.4, T1.5
- **DoD**: Team cards show name/count/score. Detail shows aggregated capabilities chart. Collaboration pairs table renders. Create team with multi-select agent picker works. Empty state for no teams. Responsive.

#### T2.4: Trust Profiles Page
- **Description**: Build `/identity/trust` with trust overview table (all agents × domains), filters, trust history line chart with multi-agent selection and time range picker.
- **Effort**: L
- **Dependencies**: T1.1, T1.2, T1.4, T0.4
- **DoD**: Table shows all agent/domain trust data with trend indicators. Chart renders trust over time for selected agents. Filters work. Loading/empty/error states. Responsive.

#### T2.5: Delegation Recall Page
- **Description**: Build `/identity/recall` with search input, recommendation card, similar tasks table, failure patterns list.
- **Effort**: M
- **Dependencies**: T1.1, T1.2, T1.4
- **DoD**: Search triggers API call with debounce. Results render with outcome badges. Recommendation card shows/hides based on data. Failure patterns list renders. All states handled. Responsive.

#### T2.6: Portable Identity Page
- **Description**: Build `/identity/export` with export panel (agent selector, preview, download) and import panel (file upload/drop zone, preview with hash verification, target agent selector, import action).
- **Effort**: L
- **Dependencies**: T1.1, T1.2, T1.4, T1.5
- **DoD**: Export generates and downloads JSON. Import reads file, shows preview, validates hash and schema version. Import submits correctly. Success/error feedback. Hash mismatch blocks import. Schema mismatch shows warning. Responsive.

### Phase 3: Polish

#### T3.1: Loading & Error State Audit
- **Description**: Audit all pages for consistent loading skeletons, error handling with retry, and proper empty states.
- **Effort**: S
- **Dependencies**: T2.1–T2.6
- **DoD**: Every data-fetching component has loading/error/empty states. No unhandled promise rejections. Error boundaries catch render errors.

#### T3.2: Accessibility Audit
- **Description**: Run axe-core on all pages. Fix issues: focus management, ARIA attributes, keyboard navigation, color contrast, screen reader announcements.
- **Effort**: M
- **Dependencies**: T2.1–T2.6
- **DoD**: Zero critical/serious axe violations. All interactive elements keyboard accessible. Charts have text alternatives.

#### T3.3: Mobile Responsiveness Audit
- **Description**: Test all pages at 375px, 768px, 1024px, 1440px widths. Fix layout issues.
- **Effort**: M
- **Dependencies**: T2.1–T2.6
- **DoD**: All pages usable at all breakpoints. No horizontal overflow. Touch targets ≥ 44px.

### Summary Table

| Task | Effort | Dependencies | Phase |
|------|--------|-------------|-------|
| T0.1 Contract/Challenge endpoints | M | — | 0 |
| T0.2 Team list/collab endpoints | S | — | 0 |
| T0.3 Bulk trust endpoint | S | — | 0 |
| T0.4 Trust history endpoint | L | T0.1 | 0 |
| T1.1 Identity API client | M | T0.* | 1 |
| T1.2 Identity types | S | — | 1 |
| T1.3 Sidebar navigation | S | — | 1 |
| T1.4 Identity layout & tabs | S | T1.3 | 1 |
| T1.5 Shared components | M | — | 1 |
| T2.1 Overview page | L | T1.* | 2 |
| T2.2 Contracts page | XL | T1.* | 2 |
| T2.3 Teams page | L | T1.* | 2 |
| T2.4 Trust profiles page | L | T1.*, T0.4 | 2 |
| T2.5 Recall page | M | T1.* | 2 |
| T2.6 Export/Import page | L | T1.* | 2 |
| T3.1 Loading/error audit | S | T2.* | 3 |
| T3.2 Accessibility audit | M | T2.* | 3 |
| T3.3 Mobile audit | M | T2.* | 3 |

**Estimated total**: ~18 tasks, roughly 2-3 sprint effort depending on team size.

---

## 6. Edge Cases & Error Handling

| Scenario | Handling |
|----------|---------|
| **Agent with no capabilities** | Overview shows profile card with "No capability data yet". Chart renders empty/placeholder. Trust table shows single row with 0 values. |
| **Empty trust profiles** | Trust page shows empty state message. History chart shows flat line at 0 or "insufficient data" message. |
| **Failed delegation contracts** | Red status badge. Contract detail shows result field with failure details. Failure patterns section highlights relevant patterns. |
| **Import with schema version mismatch** | Parse file, check `schemaVersion` major against current (1.x.x). If incompatible, show blocking error with versions displayed. Import button disabled. |
| **Import with invalid integrity hash** | Compute hash client-side before submitting. Show red warning. Import button disabled. If server also rejects, show server error. |
| **No teams configured** | Teams page shows empty state with create CTA. |
| **Agent selector with many agents (100+)** | Use virtualized dropdown or search-as-you-type combobox. |
| **Contract timeout while viewing** | If viewing a contract that times out, optimistic update status to `timed_out` or poll/refresh contract detail. |
| **Network errors** | All API calls wrapped in try/catch. Show inline error with retry button. Don't clear successfully loaded data on refresh failure. |
| **Concurrent contract creation** | Server handles uniqueness. Client shows success/failure toast. |
| **Large identity export (many memories)** | Show progress indicator during export. Stream download for large files. |
| **Agent ID references non-existent agent** | Trust profile returns empty data gracefully (backend already handles this). UI shows "Agent not found or no data." |

---

## 7. API Proxy

All identity API calls from the browser route through the existing Next.js API proxy at `/api/engram/[...path]/route.ts`. This proxy already forwards requests to the Engram backend, adding the API key server-side. No changes needed to the proxy — identity endpoints at `/v1/identity/*` will be proxied automatically.

---

## 8. File Structure

```
src/app/(dashboard)/identity/
├── layout.tsx                    # Identity section layout with tab nav
├── page.tsx                      # Agent Identity Overview
├── contracts/
│   ├── page.tsx                  # Delegation Contracts list
│   └── [id]/
│       └── page.tsx              # Contract detail (optional, can use slide-out)
├── teams/
│   ├── page.tsx                  # Teams list
│   └── [id]/
│       └── page.tsx              # Team detail
├── trust/
│   └── page.tsx                  # Trust Profiles
├── recall/
│   └── page.tsx                  # Delegation Recall
├── export/
│   └── page.tsx                  # Portable Identity
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
```
