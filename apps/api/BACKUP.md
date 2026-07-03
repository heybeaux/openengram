# Engram Backup Strategy

## Local (Development / Self-Hosted)

### Automated Backups via LaunchAgent

A macOS LaunchAgent (`ai.engram.backup`) runs the verified backup script **3 times daily** (every 8 hours).

- **Script**: `scripts/backup-verified.sh`
- **Backup directory**: `~/engram-backups/`
- **Offsite mirror**: `~/engram-backups-offsite/` (git-based)
- **Retention**: 30 days (auto-pruned)
- **Format**: `pg_dump` compressed with gzip (`.sql.gz`)

### Verification

Each backup run:
1. Records pre-backup memory count
2. Dumps the database via `pg_dump`
3. Verifies file size ≥ 1MB (guards against empty/corrupt dumps)
4. Pushes to the offsite git repository

### Manual Restore

```bash
./scripts/restore.sh ~/engram-backups/engram-backup-YYYY-MM-DD-HHMMSS.sql.gz
```

## Cloud (Railway)

### Railway Automated Backups

Railway provides automated daily backups for PostgreSQL databases on paid plans. To verify or configure:

1. Go to the Railway dashboard → your Engram project → PostgreSQL service
2. Navigate to **Settings → Backups**
3. Ensure automated backups are **enabled**
4. Railway retains backups for 7 days by default

> **Note**: If Railway backups are not yet configured, enable them in the dashboard. For production workloads, also consider supplementing with `scripts/backup-cloud.sh` for off-platform backup redundancy.

### Cloud Backup Script

For additional safety, `scripts/backup-cloud.sh` can be run as a cron job or CI step to dump the Railway database to external storage.

## Recovery Procedures

| Scenario | Action |
|----------|--------|
| Local corruption | Restore from `~/engram-backups/` using `restore.sh` |
| Local machine loss | Clone from `~/engram-backups-offsite/` git repo |
| Railway DB issue | Restore from Railway dashboard backups |
| Railway + local needed | Run `backup-cloud.sh` to pull a fresh dump |
