# Rollback Plan — Identity Framework (2026-02-20)

## Overview

This document covers rollback procedures for the identity framework deployment (HEY-310 through HEY-324).

## 1. Database Migration Rollback

### Revert `20260220_identity_framework`

```sql
-- Drop task_completions table and all indexes
DROP TABLE IF EXISTS "task_completions" CASCADE;
```

Then remove the migration record:

```sql
DELETE FROM "_prisma_migrations"
WHERE migration_name = '20260220_identity_framework';
```

### Verify rollback

```sql
SELECT EXISTS (
  SELECT FROM information_schema.tables
  WHERE table_name = 'task_completions'
); -- Should return false
```

## 2. Feature Flag: Disable Identity UI

The dashboard uses edition gating to control visibility of identity features.

### Quick disable (no redeploy)

Set the environment variable on the dashboard deployment:

```bash
# Hides identity nav items (Agents, Delegation, Teams, Insights, Challenges)
NEXT_PUBLIC_FEATURE_IDENTITY=false
```

### Code-level disable

In `src/components/layout/sidebar.tsx`, the identity nav items can be removed or gated behind a feature flag by adding `editions: ["cloud"]` to restrict them, or filtering by a `NEXT_PUBLIC_FEATURE_IDENTITY` env var.

### Sync features (local edition)

The "Sync" nav item only shows in `local` edition (controlled by `editions: ["local"]` in the nav config). To disable:

```bash
# Remove cloud link / sync UI entirely
NEXT_PUBLIC_EDITION=cloud  # or simply remove the Sync nav entry
```

## 3. API Rollback

The identity endpoints are in the `IdentityModule`:

1. Revert the `src/identity/` directory to pre-identity state
2. Remove `IdentityModule` from `app.module.ts` imports
3. Redeploy the API server

### Endpoint list to verify removal:
- `POST /v1/identity/task-completions`
- `GET /v1/identity/trust-profile/:agentId`
- `GET /v1/identity/team-profile/:agentId`

## 4. Deployment Rollback

### Staging (HEY-320/321)
```bash
# Railway: revert to previous deployment
railway rollback --service engram-api
railway rollback --service engram-dashboard
```

### Production (HEY-322/323)
```bash
# Same procedure, production environment
railway rollback --service engram-api --environment production
railway rollback --service engram-dashboard --environment production
```

**Note:** HEY-320 through HEY-323 (actual staging/prod deployments) require manual execution by Rook with infrastructure access. This doc provides the commands but cannot be automated.

## 5. Rollback Order

If a full rollback is needed:

1. **Dashboard first** — Remove identity UI (instant, no data impact)
2. **API second** — Remove identity endpoints (stops new data ingestion)
3. **Database last** — Drop tables only after confirming no dependent services

## 6. Data Preservation

Before dropping `task_completions`:

```sql
-- Export task completion data for analysis
COPY task_completions TO '/tmp/task_completions_backup.csv' WITH CSV HEADER;
```

## 7. Monitoring

After rollback, verify:
- [ ] Dashboard loads without errors (check browser console)
- [ ] API health endpoint returns 200
- [ ] No 404s on removed routes (should return clean errors)
- [ ] Existing memory CRUD operations unaffected
