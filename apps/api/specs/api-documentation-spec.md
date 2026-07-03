# API Documentation Spec

**Date:** 2026-02-20
**Author:** Kit 🦊
**Status:** Draft — awaiting review

---

## 1. Overview

Engram's API surface grew significantly today. We need comprehensive, developer-friendly documentation for all endpoints. This spec defines the structure, content, and tasks for the API reference.

---

## 2. Documentation Structure

### 2.1 Format

All API docs live in the Next.js dashboard at `/docs/api`. Each endpoint group gets a section with:

- **Endpoint signature** — method, path, auth requirements
- **Description** — what it does, when to use it
- **Request** — headers, path params, query params, body schema (TypeScript interface)
- **Response** — success schema, status codes, error responses
- **Example** — curl command + JSON response
- **Notes** — gotchas, rate limits, related endpoints

### 2.2 Organization

```
/docs/api
├── Authentication
│   ├── POST /v1/auth/login
│   ├── POST /v1/auth/register
│   ├── GET /v1/auth/me
│   └── Auth headers (JWT vs API Key)
│
├── Memories (existing — update)
│   ├── POST /v1/memories
│   ├── GET /v1/memories/:id
│   ├── PATCH /v1/memories/:id
│   ├── DELETE /v1/memories/:id
│   └── POST /v1/memories/:id/challenge  ← NEW
│
├── Recall (existing — update)
│   ├── POST /v1/recall
│   └── POST /v1/recall/contextual  ← note delegation context param
│
├── Identity  ← NEW SECTION
│   ├── GET /v1/agents/:id/identity
│   ├── GET /v1/agents/:id/capabilities
│   ├── GET /v1/agents/:id/export
│   ├── POST /v1/agents/:id/import
│   ├── POST /v1/agents/:agentId/task-outcomes
│   ├── GET /v1/agents/:agentId/task-outcomes
│   ├── POST /v1/agents/:agentId/self-assessments
│   ├── GET /v1/agents/:agentId/self-assessments
│   ├── POST /v1/agents/:agentId/trust/recompute
│   ├── GET /v1/agents/:agentId/trust/narrative
│   └── GET /v1/agents/:agentId/failure-patterns
│
├── Delegation  ← NEW SECTION
│   ├── Tasks
│   │   ├── POST /v1/tasks
│   │   ├── GET /v1/tasks
│   │   └── PATCH /v1/tasks/:id
│   ├── Templates
│   │   ├── POST /v1/delegation-templates
│   │   ├── GET /v1/delegation-templates
│   │   ├── PATCH /v1/delegation-templates/:id
│   │   └── DELETE /v1/delegation-templates/:id
│   └── Contracts
│       ├── POST /v1/delegation-contracts
│       ├── GET /v1/delegation-contracts
│       └── PATCH /v1/delegation-contracts/:id
│
├── Teams  ← NEW SECTION
│   ├── POST /v1/teams
│   ├── GET /v1/teams
│   ├── GET /v1/teams/:id
│   ├── PATCH /v1/teams/:id
│   ├── DELETE /v1/teams/:id
│   ├── POST /v1/teams/:id/members
│   ├── DELETE /v1/teams/:id/members/:memberId
│   └── POST /v1/teams/:id/collaborations
│
├── Challenges  ← NEW SECTION
│   ├── POST /v1/memories/:id/challenge
│   ├── GET /v1/challenges
│   ├── GET /v1/challenges/:id
│   └── PATCH /v1/challenges/:id/resolve
│
├── Awareness  ← NEW SECTION
│   ├── GET /v1/awareness/status
│   ├── POST /v1/awareness/cycle
│   ├── PATCH /v1/insights/:id/feedback
│   ├── POST /v1/notifications/configure
│   └── GET /v1/notifications/config
│
├── Cloud Sync (existing — update)
│   ├── POST /v1/cloud/link
│   ├── GET /v1/cloud/status
│   ├── POST /v1/cloud/sync (trigger push)
│   ├── POST /v1/cloud/pull (trigger pull)
│   ├── POST /v1/cloud/reconcile/preview  ← NEW
│   └── POST /v1/cloud/reconcile/execute  ← NEW
│
└── Account (existing — update)
    ├── GET /v1/account
    ├── PATCH /v1/account
    └── API Key management
```

---

## 3. Endpoint Documentation Template

Each endpoint follows this format:

```markdown
### POST /v1/tasks

Create a delegated task assignment.

**Auth:** JWT or API Key required

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| taskDescription | string | ✅ | What needs to be done |
| assignedTo | string | ✅ | Agent ID of the assignee |
| assignedBy | string | ✅ | Agent ID of the delegator |
| deadline | string (ISO 8601) | ❌ | When the task should be completed |
| contractId | string | ❌ | Link to a delegation contract |

**Response (201):**
```json
{
  "id": "task_abc123",
  "taskDescription": "Fix the SSRF vulnerability",
  "assignedTo": "agent_rook",
  "assignedBy": "agent_kit",
  "status": "ASSIGNED",
  "deadline": "2026-02-21T00:00:00Z",
  "createdAt": "2026-02-20T18:00:00Z"
}
```

**Error Responses:**
| Status | Description |
|--------|-------------|
| 400 | Invalid request body |
| 401 | Missing or invalid auth |
| 404 | Agent not found |

**Example:**
```bash
curl -X POST https://api.openengram.ai/v1/tasks \
  -H "X-AM-API-Key: eng_your_key" \
  -H "Content-Type: application/json" \
  -d '{"taskDescription": "Fix SSRF", "assignedTo": "agent_rook", "assignedBy": "agent_kit"}'
```
```

---

## 4. Authentication Documentation

### Auth Methods

| Method | Header | Use Case |
|--------|--------|----------|
| JWT Bearer | `Authorization: Bearer <token>` | Dashboard sessions, browser-based |
| API Key | `X-AM-API-Key: eng_xxx` | Agent integrations, MCP, CLI |
| Instance Sync Key | `X-Sync-Key: esync_xxx` | Local↔cloud sync operations |

### Auth Flow Documentation

1. **Registration** → `POST /v1/auth/register` → returns JWT
2. **Login** → `POST /v1/auth/login` → returns JWT
3. **API Key creation** → `POST /v1/account/api-keys` (requires JWT) → returns `eng_` prefixed key
4. **Using API key** → Include `X-AM-API-Key` header on all subsequent requests
5. **JWT refresh** → tokens have expiry, re-login required (no refresh token endpoint yet)

### Scoping

- **Account scope:** JWT grants access to all agents in the account
- **Agent scope:** API key is tied to a specific agent, only sees that agent's data
- **User scope:** Memories are scoped to users within agents

---

## 5. Concept Pages

### 5.1 Identity Concepts (`/docs/concepts/identity`)

**Sections:**
1. What is agent identity? (not just a name — emergent from memories)
2. Identity layers: capabilities, preferences, trust, work style
3. How identity is built (extraction pipeline → identity signals → consolidated profiles)
4. Identity lifecycle (new agent → learning → established → evolving)
5. Portable identity (export/import, what's included, deduplication)

**Diagrams needed:**
- Identity data flow: Memory → Extraction → Signals → Profile
- Trust score computation (signal weights, time decay)

### 5.2 Delegation Concepts (`/docs/concepts/delegation`)

**Sections:**
1. Task lifecycle: ASSIGNED → IN_PROGRESS → COMPLETED/FAILED
2. Delegation contracts: formal agreements between agents
3. Templates: reusable patterns for common delegations
4. How delegation feeds back into trust and capabilities
5. Experience-weighted recall in delegation context

**Diagrams needed:**
- Task state machine
- Contract state machine (PROPOSED → ACCEPTED → IN_PROGRESS → COMPLETED → VERIFIED)
- Delegation → Trust feedback loop

### 5.3 Trust Concepts (`/docs/concepts/trust`)

**Sections:**
1. Trust signals: SUCCESS, FAILURE, CORRECTION
2. Time-decayed scoring (30-day half-life, why)
3. Trust as living memory (narrative trust updates)
4. Challenge protocol: disputing memories
5. Failure pattern detection and its role

**Diagrams needed:**
- Trust score decay curve
- Challenge resolution flow

### 5.4 Awareness Concepts (`/docs/concepts/awareness`)

**Sections:**
1. Waking Cycle: what it does, when it runs (4h schedule)
2. Signal sources: where observations come from
3. Insight types: PATTERN_DETECTED, ANOMALY, TREND, SUGGESTION
4. Feedback loop: how user feedback improves insight quality
5. Proactive notifications: webhook delivery, HMAC signing

**Diagrams needed:**
- Waking Cycle pipeline (observe → analyze → surface → notify)
- Feedback loop cycle

### 5.5 Sync Operations (`/docs/operations/sync`)

**Sections:**
1. Cloud linking: connecting local instance to cloud
2. Push sync: local → cloud (automatic on memory creation)
3. Pull sync: cloud → local (manual or scheduled)
4. Reconciliation: merging two pre-existing stores
5. Identity mapping: how agent/user IDs are mapped across instances
6. Content hash deduplication

**Diagrams needed:**
- Sync architecture (local ↔ cloud with identity mapping)
- Reconciliation flow (preview → execute)

---

## 6. Task Breakdown

| # | Task | Est | Dependencies |
|---|------|-----|-------------|
| D1 | Auth documentation (methods, flows, scoping) | 1h | — |
| D2 | Identity endpoints (11 endpoints) | 2.5h | — |
| D3 | Delegation endpoints (10 endpoints) | 2h | — |
| D4 | Teams endpoints (8 endpoints) | 1.5h | — |
| D5 | Challenges endpoints (4 endpoints) | 1h | — |
| D6 | Awareness endpoints (5 endpoints) | 1h | — |
| D7 | Sync endpoints (6 endpoints, update existing) | 1.5h | — |
| D8 | Identity concepts page | 1.5h | — |
| D9 | Delegation concepts page | 1.5h | — |
| D10 | Trust concepts page | 1h | — |
| D11 | Awareness concepts page | 1h | — |
| D12 | Sync operations page | 1.5h | — |
| D13 | Architecture diagrams (Mermaid) | 2h | D8-D12 |
| D14 | Review + cross-linking between pages | 1h | D1-D13 |

**Total: ~20 hours**

---

## 7. Implementation Notes

### Dashboard docs pages
All docs pages are in `src/app/docs/` in the dashboard repo. They're MDX-like Next.js pages. Follow existing patterns from `/docs/api/page.tsx` and `/docs/concepts/layers/page.tsx`.

### API schema extraction
For accuracy, extract request/response schemas directly from:
- DTOs in `src/*/dto/*.ts` (class-validator decorators define the schema)
- Controller return types
- Prisma models for response shapes

### Curl examples
All examples should use `api.openengram.ai` as the base URL with `X-AM-API-Key` auth. Include both success and error examples.

### Versioning
Document current API as v1. Note that these endpoints are new in the identity release and may have breaking changes before v2 stabilization.

---

## 8. Definition of Done (overall)

- [ ] All 44+ new endpoints documented with schemas and examples
- [ ] 5 concept pages written with diagrams
- [ ] Architecture page updated
- [ ] Auth documentation comprehensive
- [ ] Cross-links between related docs
- [ ] All code examples tested (curl commands actually work)
- [ ] No broken links
- [ ] Mobile-readable formatting

---

*Spec authored by Kit 🦊. Ready for review.*
