# Production Rollback Plan

> Last updated: 2026-02-21 | Covers: Engram API (Railway), Dashboard (Vercel), Database (Supabase/PostgreSQL)

## 1. Pre-Deploy Checklist

Before every production deploy:

- [ ] **Database backup verified** — Take a manual snapshot via Supabase dashboard or `pg_dump`:
  ```bash
  pg_dump "$DATABASE_URL" --no-owner --clean > backup-$(date +%Y%m%d-%H%M%S).sql
  ```
- [ ] **Migration review** — Run `npx prisma migrate status` against production to confirm pending migrations
- [ ] **Migration SQL audited** — Read every `.sql` file in pending migrations; confirm `IF NOT EXISTS` / `IF EXISTS` guards
- [ ] **Staging smoke test** — Deploy to staging first, verify:
  - API health: `GET /health` returns 200
  - Memory CRUD: create, recall, delete a test memory
  - Dashboard loads, login works, memory list renders
  - New features function as expected
- [ ] **Rollback plan reviewed** — Know which Railway/Vercel deploy to roll back to
- [ ] **Team notified** — Post in team channel before production deploy

## 2. Railway Rollback (API Server)

### Via Dashboard
1. Go to [Railway Dashboard](https://railway.app/dashboard) → Engram project
2. Select the **engram-api** service
3. Click **Deployments** tab
4. Find the last known-good deployment
5. Click the **⋮** menu → **Rollback to this deploy**
6. Confirm — Railway redeploys the previous image immediately

### Via CLI
```bash
# List recent deployments
railway deployments list --service engram-api

# Rollback to previous deployment
railway rollback --service engram-api

# Or rollback to a specific deployment ID
railway rollback --service engram-api --deployment <deployment-id>

# For production environment specifically
railway rollback --service engram-api --environment production
```

### Verify
```bash
curl https://engram-api.railway.app/health
# Should return 200 with version info matching the rolled-back deploy
```

## 3. Database Rollback

### ⚠️ CRITICAL: Database rollbacks are NOT automatic

Prisma `migrate deploy` is forward-only. Rolling back database changes requires manual SQL.

### Option A: Resolve a Failed Migration

If a migration partially applied and is stuck:

```bash
# Mark a failed migration as rolled back (does NOT undo SQL)
npx prisma migrate resolve --rolled-back <migration_name>

# Then manually undo the SQL changes (see rollback SQL below)
```

### Option B: Manual SQL Rollback

Connect to the database and run the reverse SQL. Always back up first.

```bash
# Connect via psql
psql "$DATABASE_URL"

# Or use Supabase SQL Editor in the dashboard
```

**General pattern for rolling back a CREATE TABLE migration:**
```sql
-- 1. Drop the table
DROP TABLE IF EXISTS "table_name" CASCADE;

-- 2. Remove the migration record so Prisma doesn't think it's applied
DELETE FROM "_prisma_migrations"
WHERE migration_name = 'YYYYMMDD_migration_name';
```

**For ALTER TABLE migrations (adding columns):**
```sql
-- 1. Drop the column
ALTER TABLE "table_name" DROP COLUMN IF EXISTS "column_name";

-- 2. Remove migration record
DELETE FROM "_prisma_migrations"
WHERE migration_name = 'YYYYMMDD_migration_name';
```

**For enum additions:**
```sql
-- Enum values CANNOT be removed in PostgreSQL without recreating the type.
-- If needed, create a new type, migrate the column, drop the old type.
-- Generally safe to leave unused enum values in place.
```

### Option C: Full Database Restore

Last resort — restores the entire database to a point in time:

1. Go to Supabase Dashboard → Database → Backups
2. Select the backup taken before the deploy
3. Restore (this replaces ALL data since that backup)

⚠️ This will lose any data written after the backup point.

## 4. Vercel Rollback (Dashboard)

### Via Dashboard
1. Go to [Vercel Dashboard](https://vercel.com) → Engram Dashboard project
2. Click **Deployments** tab
3. Find the last known-good production deployment
4. Click **⋮** menu → **Promote to Production**
5. Dashboard instantly serves the previous version

### Via CLI
```bash
# List deployments
vercel ls engram-dashboard

# Promote a specific deployment to production
vercel promote <deployment-url> --scope=<team>
```

### Verify
- Load the dashboard URL in a browser
- Check browser console for errors
- Verify login and basic navigation work

## 5. Emergency Procedures

### Production is DOWN — Step-by-Step Recovery

**Triage (0-2 minutes):**
1. Check Railway service status — is the API container running?
2. Check `GET /health` — does it respond at all?
3. Check Supabase status — is the database reachable?
4. Check Vercel status — is the dashboard serving?

**API Down (Railway):**
1. **Immediate:** Roll back to previous Railway deployment (Section 2)
2. Check Railway logs: `railway logs --service engram-api`
3. If the issue is a bad migration, the API may crash on startup — fix the database first (Section 3)
4. If the issue is an env var change, revert it in Railway dashboard → Variables

**Database Down (Supabase):**
1. Check [Supabase Status](https://status.supabase.com/)
2. If it's a Supabase outage, wait — nothing to do on our end
3. If it's a bad migration locking tables, connect via psql and check:
   ```sql
   SELECT * FROM pg_stat_activity WHERE state = 'active';
   -- Kill long-running queries if needed:
   SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'active' AND query_start < now() - interval '5 minutes';
   ```
4. If data is corrupt, restore from backup (Section 3, Option C)

**Dashboard Down (Vercel):**
1. Roll back to previous Vercel deployment (Section 4)
2. Check Vercel function logs for errors
3. The API being down will cause dashboard errors — fix API first

**Everything Down:**
1. Roll back API on Railway
2. Roll back Dashboard on Vercel
3. Assess database — only roll back migrations if they caused the outage
4. Verify recovery in order: Database → API → Dashboard

### Communication During Outage
- Post status in team Discord channel immediately
- Update every 15 minutes until resolved
- Post root cause analysis after recovery

## 6. Contact & Ownership

| Role | Who | Can Deploy | Can Rollback |
|------|-----|-----------|-------------|
| Infrastructure Owner | Rook | ✅ All environments | ✅ All environments |
| API Developer | Any contributor | ✅ Staging | ✅ Staging |
| Dashboard Developer | Any contributor | ✅ Staging (via PR merge) | ❌ Needs Rook |
| Database Admin | Rook | ✅ Migrations | ✅ Manual SQL |

**Escalation:** If Rook is unavailable, any team member with Railway/Vercel access can perform rollbacks using this guide.

## 7. Known Risks

### Identity Tables Are New
- `trust_signals`, `trust_scores`, `capability_checkpoints`, `experience_weights` — schema exists but migrations may not be applied to production yet
- `agent_teams`, `agent_team_members`, `agent_team_collaborations` — multi-agent team tables, pending migration
- `delegated_tasks`, `delegation_templates`, `delegation_contracts` — delegation framework, pending migration
- See [MIGRATION-PLAN.md](./MIGRATION-PLAN.md) for the consolidated migration plan

### Schema Changes Pending
- Several models in `schema.prisma` don't have corresponding migration files yet
- Running `prisma migrate deploy` will NOT create these tables — they need explicit migration files first
- **Never** run `prisma migrate dev` against production (see [MIGRATIONS.md](./MIGRATIONS.md))

### In-Memory Stores
- Some identity features (Challenge, FailurePattern) are implemented as in-memory stores, not database tables
- These do NOT need migrations but will lose data on restart
- Future work may persist these to the database

### Enum Values Cannot Be Removed
- PostgreSQL does not support `DROP VALUE` from enums
- If an enum value was added (e.g., `TASK_OUTCOME`, `SELF_ASSESSMENT`), it stays permanently
- This is safe — unused values don't cause issues

### The 543-Memory Incident
- On an early deployment, `prisma migrate dev` was run against production and wiped 543 memories
- The `premigrate:dev` script now blocks this
- **Never run `prisma migrate dev` or `prisma migrate reset` on any shared database**
