# Cloud Backup Strategy

## Supabase-Hosted (Production)

### Automatic Backups
Supabase Pro plan includes **daily automatic backups** with 7-day retention. These are full PostgreSQL snapshots managed by Supabase infrastructure.

- **Frequency:** Daily
- **Retention:** 7 days (Pro), 14 days (Team), 30 days (Enterprise)
- **Restore:** Via Supabase Dashboard → Database → Backups → Restore
- **Point-in-Time Recovery (PITR):** Available on Pro plan as add-on ($100/mo) for up to 7-day window with second-level granularity

### Manual Export
For on-demand exports or migration:

```bash
# Export via pg_dump (requires direct DB connection string)
pg_dump "$DATABASE_URL" --no-owner --no-acl -Fc > engram-backup-$(date +%Y%m%d).dump

# Restore
pg_restore -d "$TARGET_DATABASE_URL" --no-owner --no-acl engram-backup-YYYYMMDD.dump
```

### What's Backed Up
- All tables: accounts, memories, agents, embeddings, sessions, pools, etc.
- pgvector indexes (rebuilt on restore)
- Row-level security policies

### What's NOT Backed Up
- Supabase Edge Functions (stored in git)
- Storage buckets (separate backup needed if used)
- Realtime subscriptions configuration

## Self-Hosted (Local)

Local deployments use `pg_dump` via a macOS LaunchAgent for automated daily backups. See the LaunchAgent plist in the repo for configuration.

## Recommendations

1. **Current setup (Pro plan):** Daily backups are sufficient for current scale
2. **When to upgrade:** Add PITR when revenue/user count justifies $100/mo — gives second-level recovery
3. **Off-site backup:** Periodically run manual `pg_dump` to a separate location (S3, local) for disaster recovery beyond Supabase
4. **Test restores:** Quarterly, restore a backup to a staging instance to verify integrity
