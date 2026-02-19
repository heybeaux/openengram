# Staging Environment Specification

**Author:** Claw (automated audit)  
**Date:** 2026-02-18  
**Status:** Draft — awaiting review  

---

## 1. Current State

### Engram API (Backend)

| Aspect | Details |
|--------|---------|
| **Runtime** | NestJS (Node 20), built with `pnpm`, Prisma ORM |
| **Hosting** | Railway (single service), Docker-based deployment |
| **Dockerfile** | Multi-stage: `node:20-alpine` builder → runtime. Runs `docker-entrypoint.sh` which runs `prisma migrate deploy` then `node dist/src/main.js` |
| **Database** | PostgreSQL with `pgvector` extension (Railway-managed Postgres, inferred from `DATABASE_URL` + `DIRECT_URL` env vars) |
| **Branch → Deploy** | `main` branch. CI runs on push to `main`, then `migrate-prod` job deploys migrations to production DB using GitHub Secrets |
| **No railway.toml/json** | Railway config is likely set via dashboard, not checked into repo |

### Engram Dashboard (Frontend)

| Aspect | Details |
|--------|---------|
| **Framework** | Next.js 14 (React 18) |
| **Hosting** | Vercel (inferred — no `vercel.json`, standard Next.js auto-detect) |
| **Branch → Deploy** | `main` → production (Vercel default behavior) |
| **No explicit Vercel config** | Using Vercel defaults |

### CI/CD (GitHub Actions)

Two workflow files:

1. **`ci-cloud.yml`** — Runs on push to `main` only
   - Spins up `pgvector/pgvector:pg16` service container
   - Steps: install → prisma generate → migrate → typecheck → lint → build → test
   - **`migrate-prod` job**: After CI passes on `main`, deploys Prisma migrations to production DB using `secrets.DATABASE_URL` / `secrets.DIRECT_URL`
   - `continue-on-error: true` on migration (⚠️ risky)

2. **`ci-local.yml`** — Runs on push to `main` AND PRs to `main`
   - Same CI steps but with `EDITION=local` and skips cloud-specific tests
   - No deployment step

### Branching

- **Engram:** `main` is the only long-lived branch. No `production`, `staging`, or `develop` branch. Many feature branches.
- **Dashboard:** Same — `main` only, no environment branches.

### Environment Variables

**Secrets (must differ per environment):**
- `DATABASE_URL` / `DIRECT_URL` — Postgres connection strings
- `OPENAI_API_KEY` — LLM calls
- `COHERE_API_KEY` — Cohere embeddings
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — Billing
- `ENCRYPTION_KEY` — Cloud-link encryption (32-byte hex)
- `AM_API_KEY` — API protection

**Config (can share or vary):**
- `EDITION` — `local` or `cloud`
- `EMBEDDING_PROVIDER` — `local`, `openai`, `cloud-ensemble`
- `PORT`, `NODE_ENV`
- `GRAPH_ENABLED`, `ENSEMBLE_ENABLED`, `MULTIQUERY_ENABLED`, etc. (feature flags)
- `FRONTEND_URL` — Dashboard URL
- `STRIPE_PRICE_ID_PRO` — Stripe price ID
- `POSTHOG_API_KEY`, `GA4_MEASUREMENT_ID` — Analytics

**Third-party services:** OpenAI, Cohere, Pinecone, Stripe, PostHog, GA4, Sentry

---

## 2. Problems

### Why We Need Staging

1. **No safety net before production.** Today, merging to `main` immediately runs migrations against the production database (`migrate-prod` job). There is zero smoke testing against a staging environment.

2. **HEY-157 incident (2026-02-18).** A code change merged to `main` impacted production directly. With a staging environment, this would have been caught before reaching users.

3. **User data at risk.** Engram stores user memories — a failed migration or broken endpoint can corrupt or lose irreplaceable data. The `continue-on-error: true` on the migration step means a failed migration doesn't even block deployment.

4. **No preview for dashboard.** Dashboard changes also deploy immediately on merge to `main` via Vercel.

5. **Feature flags are not enough.** While the codebase has many feature flags (`ENSEMBLE_ENABLED`, etc.), structural changes (schema migrations, new endpoints) can't be gated this way.

---

## 3. Proposed Architecture

### 3.1 Git Branching Strategy

```
feature/* ──PR──► main (staging) ──promote──► production branch (prod)
```

- **`main`** = staging. All PRs merge here. Auto-deploys to staging environment.
- **`production`** = production. Only updated via fast-forward merge from `main` (manual promotion).
- Feature branches → PR → `main`. No direct pushes to `production`.

### 3.2 Railway: Two Services + Two Databases

```
Railway Project: engram
├── Service: engram-staging
│   ├── Source: main branch
│   ├── DB: engram-staging-db (PostgreSQL + pgvector)
│   └── Domain: staging-api.openengram.ai
│
└── Service: engram-production
    ├── Source: production branch
    ├── DB: engram-prod-db (PostgreSQL + pgvector, existing)
    └── Domain: api.openengram.ai (existing)
```

**Key points:**
- Each service has its own Railway Postgres database
- Staging DB is disposable — can be reset/reseeded anytime
- Production DB is the existing database (no migration needed)
- Both use the same Dockerfile

### 3.3 Vercel: Preview Deploys + Gated Production

```
Vercel Project: engram-dashboard
├── Preview: auto-deploy on PR + main branch
│   └── URL: staging.openengram.ai (or *.vercel.app preview)
│
└── Production: deploy only from production branch
    └── URL: openengram.ai
```

**Vercel config (`vercel.json`):**
```json
{
  "git": {
    "deploymentEnabled": {
      "main": true,
      "production": true
    }
  }
}
```

Or configure via Vercel dashboard:
- Production Branch: `production`
- Preview branches: all others (including `main`)

### 3.4 Database Isolation & Seed Strategy

**Staging DB:**
- Separate Railway Postgres instance with pgvector
- Seeded with anonymized/synthetic data (never copy prod data)
- Create a seed script: `prisma/seed.ts`
  - Creates test accounts, agents, users
  - Inserts sample memories across all layers
  - Generates sample graph entities and relationships
  - Sets up Stripe test-mode data

**Seed command:**
```bash
# In package.json
"db:seed": "ts-node prisma/seed.ts",
"db:reset-staging": "prisma migrate reset --force && pnpm db:seed"
```

**Production DB:**
- Unchanged. Existing Railway Postgres.
- Migrations run via `migrate-prod` job only on `production` branch pushes.

### 3.5 Environment Variable Management

| Variable | Staging | Production |
|----------|---------|------------|
| `NODE_ENV` | `staging` | `production` |
| `DATABASE_URL` | Railway staging DB | Railway prod DB |
| `OPENAI_API_KEY` | Same key (or separate with lower limits) | Production key |
| `STRIPE_SECRET_KEY` | `sk_test_...` | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | Staging webhook secret | Prod webhook secret |
| `FRONTEND_URL` | `https://staging.openengram.ai` | `https://openengram.ai` |
| `POSTHOG_API_KEY` | Separate project or disabled | Production key |
| `SENTRY_DSN` | Same DSN, tagged `staging` | Tagged `production` |
| `ENCRYPTION_KEY` | Different key | Production key |

**Railway variable management:**
```bash
# Set staging vars
railway variables set NODE_ENV=staging -s engram-staging
railway variables set FRONTEND_URL=https://staging.openengram.ai -s engram-staging

# Set production vars (already exist, just verify)
railway variables list -s engram-production
```

---

## 4. CI/CD Pipeline

### 4.1 PR → main: Validate

```yaml
# .github/workflows/ci.yml (replaces both ci-cloud.yml and ci-local.yml)
name: CI

on:
  push:
    branches: [main, production]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  ci:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    strategy:
      matrix:
        edition: [local, cloud]

    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: engram_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/engram_test
      DIRECT_URL: postgresql://postgres:postgres@localhost:5432/engram_test
      EDITION: ${{ matrix.edition }}
      ENCRYPTION_KEY: ci-test-encryption-key-32chars!!
      NODE_ENV: test

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: npx prisma generate
      - run: npx prisma migrate deploy
      - run: npx tsc --noEmit
      - run: pnpm run lint
      - run: pnpm run build
      - name: Test
        run: |
          if [ "${{ matrix.edition }}" = "local" ]; then
            pnpm test -- --no-coverage --forceExit --ci --testPathIgnorePatterns='cloud-link|cloud-sync|instance/instance.controller.spec|ensemble|stripe|analytics|monitoring|feedback|eval|reembedding|webhook'
          else
            pnpm test -- --no-coverage --forceExit --ci
          fi
```

### 4.2 main merge → Auto-deploy to Staging

Railway handles this automatically when the staging service is linked to the `main` branch. No GitHub Action needed for the deploy itself.

**Staging migration (automatic):** The `docker-entrypoint.sh` already runs `prisma migrate deploy` on startup. Railway will rebuild and redeploy on each push to `main`.

### 4.3 Staging → Production: Manual Promote

```yaml
# .github/workflows/promote-to-production.yml
name: Promote to Production

on:
  workflow_dispatch:
    inputs:
      confirm:
        description: 'Type DEPLOY to confirm production deployment'
        required: true

jobs:
  preflight:
    runs-on: ubuntu-latest
    if: github.event.inputs.confirm == 'DEPLOY'
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Show commits being promoted
        run: |
          echo "## Commits being promoted to production:"
          git log production..main --oneline || echo "No production branch yet"

  promote:
    needs: preflight
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Fast-forward production to main
        run: |
          git checkout production || git checkout -b production
          git merge --ff-only main
          git push origin production

  migrate-prod:
    needs: promote
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
        with:
          ref: production
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: npx prisma generate
      - name: Deploy migrations to production
        run: npx prisma migrate deploy
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          DIRECT_URL: ${{ secrets.DIRECT_URL }}
        # NOTE: removed continue-on-error — migration failure should block deploy
```

### 4.4 Production Promotion Checklist

Before running the promote workflow:

- [ ] All CI checks pass on `main`
- [ ] Staging has been deployed and running for ≥1 hour
- [ ] Smoke test staging API: `curl https://staging-api.openengram.ai/health`
- [ ] Test critical paths on staging dashboard
- [ ] Check Sentry for new errors on staging
- [ ] Review migration files since last production deploy
- [ ] If Stripe changes: verify test-mode webhooks work on staging

---

## 5. Migration Strategy

**Goal:** Get from current state → proposed state with zero downtime.

### Step 1: Create `production` branch (Day 1)

```bash
cd ~/projects/agent-memory/engram
git checkout main
git checkout -b production
git push origin production
```

Same for dashboard:
```bash
cd ~/projects/agent-memory/engram-dashboard
git checkout main
git checkout -b production
git push origin production
```

### Step 2: Set up Railway staging service (Day 1)

```bash
# In Railway dashboard or CLI:
# 1. Create new service "engram-staging" in the same project
# 2. Link to GitHub repo, branch: main
# 3. Create new Postgres database "engram-staging-db" with pgvector
# 4. Set environment variables (copy from prod, change DATABASE_URL, NODE_ENV, FRONTEND_URL, use Stripe test keys)
```

### Step 3: Reconfigure Railway production service (Day 1)

```bash
# Change production service's source branch from "main" to "production"
# This is a Railway dashboard setting — no downtime
```

### Step 4: Update Vercel (Day 1)

```
# In Vercel dashboard:
# 1. Change Production Branch from "main" to "production"
# 2. main branch will now create Preview deployments
# 3. Set staging-specific env vars for preview deploys
```

### Step 5: Update GitHub Actions (Day 1)

- Replace `ci-cloud.yml` and `ci-local.yml` with unified `ci.yml`
- Add `promote-to-production.yml` workflow
- Remove `migrate-prod` job from CI (moved to promotion workflow)
- Update GitHub Secrets if needed

### Step 6: Verify (Day 1-2)

1. Push a trivial change to `main` → verify staging deploys
2. Run promote workflow → verify production deploys
3. Confirm both environments are healthy

### Step 7: Create seed script (Week 1)

- Write `prisma/seed.ts` with synthetic test data
- Document how to reset staging DB

**Total estimated time:** 2-4 hours for setup, half-day for verification.

---

## 6. Cost Implications

### Railway

| Resource | Current | With Staging | Delta |
|----------|---------|-------------|-------|
| Compute (API service) | 1 service | 2 services | +~$5-20/mo (usage-based) |
| Postgres | 1 database | 2 databases | +~$5-7/mo (starter plan) |
| **Total** | ~$10-25/mo | ~$20-50/mo | **+$10-25/mo** |

Railway pricing is usage-based. Staging will see minimal traffic (dev/CI only), so costs should be on the lower end.

### Vercel

- Preview deployments are included in all plans (including free/hobby)
- No additional cost for staging previews
- **Delta: $0**

### Third-Party Services

- **OpenAI/Cohere:** Minimal additional cost (staging traffic is low)
- **Pinecone:** May need a separate index for staging (~$0 on free tier, or shared with namespace isolation)
- **Stripe:** Test mode is free
- **Sentry:** Same project, environment tags — no additional cost

**Estimated total additional cost: $10-25/month**

---

## 7. Open Questions

1. **Pinecone isolation:** Should staging use a separate Pinecone index, a separate namespace in the same index, or skip vector search entirely in staging? Separate index is safest but may require plan upgrade.

2. **Staging domain:** `staging-api.openengram.ai` + `staging.openengram.ai`? Or use Railway/Vercel auto-generated URLs?

3. **Stripe test vs live:** The current `.env` already has `sk_test_` keys. Should staging always use test mode? (Recommended: yes.)

4. **Analytics isolation:** Should staging send to PostHog/GA4? Recommend: disable or use separate PostHog project to avoid polluting prod analytics.

5. **Database seeding:** What test scenarios should the seed script cover? Need example data representative of real usage patterns.

6. **Migration `continue-on-error`:** The current `migrate-prod` job has `continue-on-error: true`. This is dangerous — a failed migration means the app starts against an inconsistent schema. Should this be removed? (Recommended: yes, fail the deploy instead.)

7. **Railway project structure:** Single Railway project with two services, or two separate projects? Single project is simpler for shared networking if needed.

8. **Who can promote?** Should production promotion require specific GitHub team approval, or is the `workflow_dispatch` with confirmation sufficient?

9. **Rollback strategy:** If a production deploy goes bad, what's the rollback plan? Railway supports instant rollback to previous deploy. Should we document this?

10. **OpenAI API key sharing:** Should staging use the same OpenAI key (risking rate limit contention) or a separate key/org?

---

## Appendix: File Inventory

### Files to Create
- `.github/workflows/ci.yml` (unified CI)
- `.github/workflows/promote-to-production.yml`
- `prisma/seed.ts`

### Files to Modify
- Remove `.github/workflows/ci-cloud.yml` (replaced by unified CI)
- Remove `.github/workflows/ci-local.yml` (replaced by unified CI)
- `docker-entrypoint.sh` — consider adding health check endpoint warmup

### Files to Create (Dashboard)
- `vercel.json` (if configuring via file instead of dashboard)

### No Changes Required
- `Dockerfile` — works as-is for both environments
- `prisma/schema.prisma` — works as-is
- `package.json` — works as-is
