#!/usr/bin/env bash
# Engram Database Backup Script
# Creates compressed pg_dump backups with 30-day retention.
# Usage: ./scripts/backup.sh
set -euo pipefail

DB_NAME="engram"
DB_USER="clawdbot"
DB_HOST="localhost"
DB_PORT="5432"
BACKUP_DIR="$HOME/engram-backups"
RETENTION_DAYS=30

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# Find pg_dump
find_pg_dump() {
    command -v pg_dump && return
    for ver in 18 17 16 15 14; do
        local p="/Applications/Postgres.app/Contents/Versions/${ver}/bin/pg_dump"
        [ -x "$p" ] && echo "$p" && return
    done
    for p in /opt/homebrew/bin/pg_dump /usr/local/bin/pg_dump; do
        [ -x "$p" ] && echo "$p" && return
    done
}

PG_DUMP=$(find_pg_dump)
if [ -z "$PG_DUMP" ]; then
    log "❌ pg_dump not found"
    exit 1
fi

mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +"%Y-%m-%d-%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/engram-backup-${TIMESTAMP}.sql.gz"

log "🗄️  Backing up '${DB_NAME}' → ${BACKUP_FILE}"
if "$PG_DUMP" -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" --no-password | gzip > "$BACKUP_FILE"; then
    if [ -s "$BACKUP_FILE" ]; then
        SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
        log "✅ Backup complete: ${BACKUP_FILE} (${SIZE})"
    else
        log "❌ Backup failed — file is empty"
        rm -f "$BACKUP_FILE"
        exit 1
    fi
else
    log "❌ pg_dump failed with exit code $?"
    rm -f "$BACKUP_FILE"
    exit 1
fi

# Cleanup old backups (keep last 30)
DELETED=$(find "$BACKUP_DIR" -name "engram-backup-*.sql.gz" -type f -mtime +${RETENTION_DAYS} -print -delete | wc -l | tr -d ' ')
[ "$DELETED" -gt 0 ] && log "🧹 Deleted ${DELETED} old backup(s)"

TOTAL=$(ls -1 "$BACKUP_DIR"/engram-backup-*.sql.gz 2>/dev/null | wc -l | tr -d ' ')
log "📁 Total backups: ${TOTAL}"
