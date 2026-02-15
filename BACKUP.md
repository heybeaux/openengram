# Engram Backup Strategy

## Overview

Two independent backup systems protect Engram data:

| Target | Script | Schedule | Retention | Location |
|--------|--------|----------|-----------|----------|
| Local DB | `scripts/backup-verified.sh` | 3x daily (LaunchAgent `ai.engram.backup`) | 30 days | `~/engram-backups/` |
| Cloud (Supabase) | `scripts/backup-cloud.sh` | Daily at 4 AM (LaunchAgent `ai.engram.backup-cloud`) | 30 days | `~/engram-backups/cloud/` |

## Supabase Built-in Backups

- **Free plan**: No automated backups
- **Pro plan**: Daily backups, 7-day retention
- **Check your plan**: Supabase Dashboard → Settings → Billing

Regardless of plan, our local pg_dump backup provides independent protection.

## Cloud Backup Setup

### 1. Credentials

Create `.env.cloud` in the engram repo root (gitignored):

```bash
SUPABASE_DIRECT_URL="postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT.supabase.co:5432/postgres"
```

**Important**: Use the DIRECT connection URL, not the pooler URL. pg_dump doesn't work through connection poolers.

### 2. Manual Run

```bash
cd ~/projects/agent-memory/engram
./scripts/backup-cloud.sh
```

### 3. Enable Daily Schedule

```bash
launchctl load ~/Library/LaunchAgents/ai.engram.backup-cloud.plist
```

### 4. Check Status

```bash
launchctl list | grep engram
ls -la ~/engram-backups/cloud/
cat /tmp/engram-backup-cloud.log
```

## Restore

To restore a cloud backup to a local database:

```bash
gunzip -c ~/engram-backups/cloud/engram-cloud-YYYY-MM-DD-HHMMSS.sql.gz | psql -U clawdbot -d engram_restore
```

**Never restore directly to the production cloud database without careful review.**
