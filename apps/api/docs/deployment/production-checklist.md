# Identity Framework — Production Deploy Checklist

> HEY-324 · Created 2026-02-20

## Pre-Deploy

- [ ] All tests pass: `npm test` (unit + integration)
- [ ] Staging deployment verified and smoke-tested
- [ ] Database backup taken:
  ```bash
  pg_dump $DATABASE_URL > pre_deploy_backup_$(date +%Y%m%d).sql
  ```
- [ ] Rollback plan reviewed (`docs/deployment/rollback-plan.md`)
- [ ] Team notified in #engram-dev

## Environment Variables

### Backend (Railway)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | Postgres connection (pooled) |
| `DIRECT_URL` | ✅ | Postgres connection (direct, for migrations) |
| `FEATURE_IDENTITY_DASHBOARD` | ✅ | Set to `true` to enable identity features |
| `OPENAI_API_KEY` | ✅ | For embeddings (task completion vectors) |
| `PINECONE_API_KEY` | ✅ | Vector store |
| `PINECONE_INDEX` | ✅ | Index name |

### Dashboard (Vercel)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_URL` | ✅ | Backend API URL |
| `NEXT_PUBLIC_FEATURE_IDENTITY_DASHBOARD` | ✅ | Set to `true` to enable identity UI |

## Migration Execution

```bash
# 1. Connect to Railway shell or run locally with DIRECT_URL
# 2. Run pending migrations (DO NOT use prisma migrate dev in production)
npx prisma migrate deploy

# 3. Verify migration applied
npx prisma migrate status
```

Expected: `20260220_add_task_completions` shows as applied.

## Deploy Steps

1. **Backend**: Push to `main` → Railway auto-deploys
2. **Wait** for Railway deployment to complete (~2 min)
3. **Verify** backend health check
4. **Dashboard**: Push to `main` → Vercel auto-deploys
5. **Wait** for Vercel deployment to complete (~1 min)
6. **Enable** feature flag: `FEATURE_IDENTITY_DASHBOARD=true`

## Health Checks

| Service | URL | Expected |
|---------|-----|----------|
| Backend health | `GET /health` | `200 { status: "ok" }` |
| Backend API | `GET /api/v1/memories?limit=1` | `200` with data |
| Dashboard | `GET /` | `200` HTML loads |
| Dashboard API | `GET /api/health` | `200` |

## Smoke Tests

### Identity Framework
- [ ] `POST /api/v1/task-completions` — create a task completion record
- [ ] `GET /api/v1/task-completions?delegatedTo=test` — query by delegate
- [ ] `GET /api/v1/task-completions/:id` — fetch by ID
- [ ] Verify vector embedding is generated for task completion

### Core Features (Regression)
- [ ] `POST /api/v1/memories` — create a memory
- [ ] `GET /api/v1/memories/search?q=test` — semantic search works
- [ ] `GET /api/v1/memories/:id` — fetch by ID
- [ ] Dashboard login works
- [ ] Dashboard memory list loads
- [ ] Dashboard memory search works

### Dashboard Identity UI
- [ ] Identity section visible when feature flag is `true`
- [ ] Identity section hidden when feature flag is `false`
- [ ] Task completion list renders
- [ ] Delegation stats display correctly

## Post-Deploy Monitoring

### First 15 Minutes
- [ ] Check Railway logs for errors
- [ ] Check Vercel function logs
- [ ] Monitor error rate (should be < 1%)
- [ ] Verify response times are normal (p50 < 200ms, p95 < 1s)

### First Hour
- [ ] No increase in error alerts
- [ ] Memory usage stable
- [ ] Database connection pool healthy
- [ ] Embedding generation working (check task_completions for non-null embeddings)

### First 24 Hours
- [ ] Dream cycle runs successfully overnight
- [ ] No data inconsistencies reported
- [ ] User feedback monitored

## Rollback Trigger Criteria

| Condition | Action |
|-----------|--------|
| Identity endpoints returning 5xx > 5% | Disable feature flag |
| Overall error rate > 10% | Full backend rollback |
| Dashboard not loading | Vercel rollback |
| Data corruption detected | DB rollback + restore |
| Migration failed | `prisma migrate resolve --rolled-back 20260220_add_task_completions` |

See `docs/deployment/rollback-plan.md` for detailed rollback procedures.
