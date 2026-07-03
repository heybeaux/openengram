# Edition Split: Local vs Cloud

**Author:** Rook (with Beaux)
**Date:** 2026-02-15
**Status:** Proposed

---

## Problem Statement

Engram is trying to be two products in one codebase without any separation, and both experiences are suffering.

### What's Actually Happening

**For self-hosted users:**
- `docker compose up` doesn't just work — you need `ENCRYPTION_KEY`, embedding provider API keys, and various config to even start
- Cloud-only features (billing page, cloud link, ensemble providers) appear in the UI and confuse users
- The setup wizard was broken on cloud, the fix broke it locally, the fix for that broke something else
- There's no clear "this is what you get" — it's a maze of feature flags and env vars

**For cloud users (us, right now):**
- Newer API routes were missing from prod because Railway deployed old code
- Migrations didn't apply because CI was broken
- CI is broken because cloud-only test suites (cloud-link, cloud-sync, instance) need `ENCRYPTION_KEY` and other cloud config that shouldn't exist in a generic test run
- Dashboard shows self-hosted features that don't apply

**For development:**
- Every PR touches both paths. Fix cloud → break local. Fix local → break cloud.
- CI runs all tests including cloud-specific ones, requiring cloud env vars in the test environment
- 21 tickets closed today, 15 new ones opened. The bug treadmill.
- Sub-agents fixing one ticket inadvertently break another because there's no clear boundary between editions

### Root Cause

There is no architectural boundary between "local self-hosted product" and "cloud managed product." They share everything: modules, routes, guards, middleware, tests, Docker config, and CI pipeline. Every cloud feature increases the complexity that local users face, and every simplification for local users risks breaking cloud.

---

## Proposed Solution: Build-Time Edition Flag

**One repo. Two editions. Clean boundary.**

```
EDITION=local   # Default. Zero-config self-hosted experience.
EDITION=cloud   # Paid managed service. All features.
```

### Principles

1. **Local is the default.** If `EDITION` is not set, you get local. No surprises.
2. **Local needs zero API keys.** Postgres + local embeddings. That's it.
3. **Cloud modules don't exist in local builds.** Not hidden — not loaded at all.
4. **Each edition has its own CI workflow.** Local tests never need `ENCRYPTION_KEY`.
5. **Docker experience for local: `docker compose up` and done.**

---

## Module Classification

### CORE (Both Editions)

These modules load in every edition:

| Module | Purpose |
|--------|---------|
| `account` | User accounts, auth (email/password) |
| `agent` | Agent management |
| `agent-session` | Session tracking |
| `memory` | Core memory CRUD |
| `memory-pool` | Memory collections/pools |
| `memory-access-log` | Access tracking |
| `embedding` | Embedding abstraction (provider differs per edition) |
| `vector` | Vector storage/search |
| `multi-query` | Multi-query recall |
| `deduplication` | Memory dedup |
| `consolidation` | Dream cycle, context generation |
| `clustering` | Memory clustering |
| `graph` | Entity/relationship graphs |
| `extraction` (in `memory`) | 5W1H extraction |
| `fog-index` | Memory quality scoring |
| `hierarchy` | Memory hierarchy/units |
| `llm` | LLM abstraction |
| `summarization` | Memory summarization |
| `correction` | Memory corrections |
| `dashboard` | Dashboard API (memory list, stats) |
| `health` | Health checks |
| `prisma` | Database access |
| `config` | Configuration |
| `common` | Guards, utils, interceptors |
| `user` | User management |
| `session` | Session management |
| `scoped-context` | Scoped context generation |
| `prefetch` | Prefetch optimization |
| `auto` | Auto-capture |
| `events` | Event system |
| `project` | Project management |
| `storage` | File storage |
| `rate-limit` | Rate limiting |

### CLOUD-ONLY

These modules **only** load when `EDITION=cloud`:

| Module | Purpose | Why Cloud-Only |
|--------|---------|----------------|
| `cloud-link` | Link self-hosted → cloud | Needs ENCRYPTION_KEY, cloud API |
| `cloud-sync` | Sync memories to cloud | Depends on cloud-link |
| `stripe` | Billing, subscriptions | Paid plans are cloud-only |
| `ensemble` | Multi-provider cloud embeddings | OpenAI + Cohere API keys |
| `instance` | Mode detection endpoint | Cloud needs to identify itself |
| `analytics` | PostHog, GA4, OpenPanel | Cloud analytics only |
| `eval` | Ensemble A/B testing | Depends on ensemble |
| `webhook` / `webhooks` | External webhooks | Cloud integrations |
| `reembedding` | Re-embed with cloud models | Depends on ensemble |
| `monitoring` | Advanced monitoring/snapshots | Cloud operational tooling |
| `feedback` | UX feedback collection | Cloud product feedback |

### LOCAL-ONLY

| Module | Purpose | Why Local-Only |
|--------|---------|----------------|
| `embedding` (local provider) | Local Metal GPU embeddings | Only runs on local hardware |

---

## Implementation Plan

### Phase 1: Edition Flag + Conditional Module Loading (Day 1)

**`app.module.ts`** — The single point of control:

```typescript
const EDITION = process.env.EDITION || 'local';

const coreModules = [
  AccountModule,
  AgentModule,
  MemoryModule,
  // ... all CORE modules
];

const cloudModules = [
  CloudLinkModule,
  CloudSyncModule,
  StripeModule,
  EnsembleModule,
  AnalyticsModule,
  EvalModule,
  WebhookModule,
  MonitoringModule,
  FeedbackModule,
  InstanceModule,
  ReembeddingModule,
];

@Module({
  imports: [
    ...coreModules,
    ...(EDITION === 'cloud' ? cloudModules : []),
  ],
})
export class AppModule {}
```

**`main.ts`** — Remove ENCRYPTION_KEY requirement for local:

```typescript
if (process.env.EDITION === 'cloud' && !process.env.ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY required for cloud edition');
}
```

### Phase 2: Docker Compose for Local (Day 1-2)

**`docker-compose.yml`** (local — the default):

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: engram
      POSTGRES_PASSWORD: engram
      POSTGRES_DB: engram
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  api:
    build: .
    environment:
      DATABASE_URL: postgresql://engram:engram@postgres:5432/engram
      DIRECT_URL: postgresql://engram:engram@postgres:5432/engram
      EDITION: local
      EMBEDDING_PROVIDER: local
    ports:
      - "3001:3001"
    depends_on:
      postgres:
        condition: service_healthy

  dashboard:
    build:
      context: ../engram-dashboard
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:3001
    ports:
      - "3000:3000"
    depends_on:
      - api

volumes:
  pgdata:
```

**That's it.** `docker compose up`. Visit localhost:3000. Setup wizard. Done.

No `.env` file. No API keys. No confusion.

### Phase 3: Split CI Workflows (Day 2)

**`.github/workflows/ci-local.yml`:**
- Runs on all PRs and pushes
- Only tests CORE modules
- No ENCRYPTION_KEY, no cloud env vars
- This is the "does the product work" gate

**`.github/workflows/ci-cloud.yml`:**
- Runs on pushes to main only (or PRs labeled `cloud`)
- Tests CORE + CLOUD modules
- Has ENCRYPTION_KEY, cloud env vars
- This is the "does the cloud service work" gate

**`.github/workflows/deploy-cloud.yml`:**
- Runs after ci-cloud passes on main
- Runs `prisma migrate deploy` against prod
- Triggers Railway deployment

### Phase 4: Dashboard Edition Awareness (Day 2-3)

The dashboard already has `NEXT_PUBLIC_DEPLOYMENT_MODE`. Extend it:

- **Local:** No billing page, no cloud link settings, no ensemble config, no analytics. Just memories, agents, graph, search, settings.
- **Cloud:** Everything.

Remove all runtime `/v1/instance/info` checks for feature gating. Use build-time `NEXT_PUBLIC_EDITION` instead. Simpler, faster, no race conditions.

### Phase 5: Documentation (Day 3)

**Local README:**
```
## Quick Start

docker compose up

Visit http://localhost:3000
```

That's the entire getting started guide. Everything else is optional.

---

## Migration Path

1. **Add `EDITION` flag to `app.module.ts`** — cloud modules behind conditional. This is backward compatible: existing cloud deploy sets `EDITION=cloud`, local defaults to `local`.
2. **Set `EDITION=cloud` on Railway** — one env var, redeploy.
3. **Create `docker-compose.yml`** for local — new file, doesn't affect cloud.
4. **Split CI** — new workflow files, old one can remain temporarily.
5. **Test local Docker experience end-to-end** — `docker compose up` on a clean machine.
6. **Update docs and marketing site** — "Get started in 30 seconds."

Cloud prod keeps working throughout. Zero downtime.

---

## Why Not Separate Repos?

Considered it. Rejected it because:

- **Shared core is 80% of the code.** Two repos means maintaining two copies of memory, auth, agents, dedup, etc.
- **Bugs in core need fixing in both.** Cherry-picking across repos is a maintenance nightmare.
- **Edition flag is simpler.** One `if` statement in `app.module.ts` vs an entire repo sync process.
- **Can always split later** if the editions diverge significantly. For now, they share more than they differ.

---

## What This Fixes

| Problem | Before | After |
|---------|--------|-------|
| Local needs API keys | Yes (ENCRYPTION_KEY, embedding providers) | No. Zero keys. |
| CI broken by cloud tests | Yes (ENCRYPTION_KEY, cloud modules) | Local CI has no cloud deps |
| Cloud features in local UI | Yes (billing, cloud link, ensemble) | Not loaded at all |
| Local features in cloud UI | Yes (setup wizard, local models) | Not loaded at all |
| Docker experience | Broken, needs .env | `docker compose up` |
| Fix cloud → break local | Constantly | Separate module trees, separate CI |
| Bug treadmill | 21 closed, 15 opened | Clear boundaries prevent cross-contamination |

---

## Timeline

- **Day 1:** Edition flag in app.module.ts + main.ts. Docker compose for local. Set EDITION=cloud on Railway.
- **Day 2:** Split CI workflows. Dashboard build-time gating.
- **Day 3:** Documentation. End-to-end test on clean machine. Ship.

---

## Decision Required

Beaux — does this direction feel right? The key trade-off is: we keep one repo (less maintenance) but with a hard boundary between editions (less breakage). The local experience becomes dead simple at the cost of cloud features being completely invisible to self-hosted users (they'd need to upgrade to cloud for ensemble, billing, sync, etc.).

That's also the monetization path: free local → paid cloud when you want more.
