# Identity Framework — Rollback Plan

> HEY-323 · Created 2026-02-20

## 1. Backend Rollback (Railway)

1. Open [Railway Dashboard](https://railway.app/dashboard) → **engram** service
2. Go to **Deployments** tab
3. Find the last known-good deployment (pre-identity-framework)
4. Click **⋮ → Rollback** to redeploy that image
5. Verify health check: `GET /health` returns 200
6. Confirm API responses no longer include identity fields

## 2. Dashboard Rollback (Vercel)

1. Open [Vercel Dashboard](https://vercel.com) → **engram-dashboard** project
2. Go to **Deployments** tab
3. Find the last known-good deployment
4. Click **⋮ → Promote to Production**
5. Verify the dashboard loads without identity UI components

## 3. Feature Flag (Immediate)

Set the feature flag to disable identity features without a full rollback:

```bash
# Railway: set env var
FEATURE_IDENTITY_DASHBOARD=false

# Vercel: set env var
NEXT_PUBLIC_FEATURE_IDENTITY_DASHBOARD=false
```

This hides identity UI in the dashboard and disables identity API endpoints at the middleware level.

## 4. Database Rollback

**Only if data corruption or critical issues require full removal.**

⚠️ **WARNING**: This drops data permanently. Take a backup first.

```sql
-- Take a backup before running these statements!
-- pg_dump -t task_completions $DATABASE_URL > backup_task_completions.sql

-- Reverse of identity framework migrations
DROP TABLE IF EXISTS "task_completions" CASCADE;

-- If agent session / pool tables need rollback (added in v0.7, not identity-specific):
-- DROP TABLE IF EXISTS "pool_grants" CASCADE;
-- DROP TABLE IF EXISTS "memory_pool_memberships" CASCADE;
-- DROP TABLE IF EXISTS "memory_access_logs" CASCADE;
-- DROP TABLE IF EXISTS "memory_pools" CASCADE;
-- DROP TABLE IF EXISTS "agent_sessions" CASCADE;

-- Clean up Prisma migration history
DELETE FROM "_prisma_migrations" WHERE migration_name = '20260220_add_task_completions';
-- DELETE FROM "_prisma_migrations" WHERE migration_name = '20260210_add_agent_sessions_and_pools';
```

## 5. Data Recovery

### From Railway Postgres Backups
1. Railway provides automatic daily backups
2. Go to **Railway → Database → Backups**
3. Download the backup from before the deployment
4. Restore with: `pg_restore --data-only -t <table> backup.dump`

### From Manual Backup
If a pre-deploy backup was taken (see production checklist):
```bash
psql $DATABASE_URL < pre_deploy_backup_20260220.sql
```

## 6. Communication Plan

| Audience | Channel | Message |
|----------|---------|---------|
| Engineering | Slack #engram-dev | Rollback initiated — reason, ETA |
| Stakeholders | Slack #engram-updates | Feature temporarily disabled, investigating |
| Users (if affected) | Status page / email | Brief service interruption notice |

### Rollback Decision Criteria
- Error rate > 5% on identity endpoints → feature flag off
- Error rate > 10% overall → full backend rollback
- Data corruption detected → database rollback + restore from backup
- Dashboard broken → Vercel rollback immediately
