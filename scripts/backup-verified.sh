#!/usr/bin/env bash
# Engram Verified Backup Script
# Runs 3x daily (every 8 hours), with verification and offsite push.
set -euo pipefail

DB_NAME="engram"
DB_USER="clawdbot"
DB_HOST="localhost"
DB_PORT="5432"
BACKUP_DIR="$HOME/engram-backups"
OFFSITE_REPO="$HOME/engram-backups-offsite"
RETENTION_DAYS=30
MIN_SIZE_BYTES=1000000  # 1MB minimum — anything less is suspicious

export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"
PSQL="psql"
PG_DUMP="pg_dump"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +"%Y-%m-%d-%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/engram-backup-${TIMESTAMP}.sql.gz"

# ── Step 1: Pre-backup count ──
PRE_COUNT=$("$PSQL" -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL;" 2>/dev/null | tr -d ' ')
log "📊 Pre-backup memory count: ${PRE_COUNT}"

if [ "$PRE_COUNT" -lt 100 ]; then
    log "⚠️  WARNING: Only ${PRE_COUNT} memories in DB — possible data loss. Backing up anyway but flagging."
fi

# ── Step 2: Dump ──
log "🗄️  Backing up '${DB_NAME}' → ${BACKUP_FILE}"
if ! "$PG_DUMP" -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" --no-password | gzip > "$BACKUP_FILE"; then
    log "❌ pg_dump failed"
    rm -f "$BACKUP_FILE"
    exit 1
fi

# ── Step 3: Size check ──
FILE_SIZE=$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_FILE" 2>/dev/null)
if [ "$FILE_SIZE" -lt "$MIN_SIZE_BYTES" ]; then
    log "❌ Backup too small (${FILE_SIZE} bytes). Likely corrupt or empty dump."
    exit 1
fi
log "📦 Backup size: $(du -h "$BACKUP_FILE" | cut -f1)"

# ── Step 4: Verify backup integrity ──
log "🔍 Verifying backup integrity..."
TABLES_IN_BACKUP=$(gunzip -c "$BACKUP_FILE" | grep -c "^COPY public\." || true)
MEMORIES_IN_BACKUP=$(gunzip -c "$BACKUP_FILE" | sed -n '/^COPY public\.memories /,/^\\.$/p' | wc -l | tr -d ' ')
MEMORIES_IN_BACKUP=$((MEMORIES_IN_BACKUP - 2))  # subtract COPY and \. lines

log "   Tables: ${TABLES_IN_BACKUP}"
log "   Memories: ${MEMORIES_IN_BACKUP}"

if [ "$MEMORIES_IN_BACKUP" -lt "$((PRE_COUNT - 10))" ]; then
    log "❌ VERIFICATION FAILED: Backup has ${MEMORIES_IN_BACKUP} memories but DB has ${PRE_COUNT}"
    exit 1
fi

log "✅ Backup verified: ${MEMORIES_IN_BACKUP} memories match DB count of ${PRE_COUNT}"

# ── Step 5: Offsite push (git repo) ──
if [ -d "$OFFSITE_REPO/.git" ]; then
    log "☁️  Pushing to offsite backup repo..."
    cp "$BACKUP_FILE" "$OFFSITE_REPO/"
    cd "$OFFSITE_REPO"
    # Keep only last 10 backups in offsite to save space
    ls -t engram-backup-*.sql.gz 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true
    git add -A
    git commit -m "backup: engram ${TIMESTAMP} (${MEMORIES_IN_BACKUP} memories)" --quiet 2>/dev/null || true
    git push --quiet 2>/dev/null && log "✅ Offsite push complete" || log "⚠️  Offsite push failed (will retry next run)"
    cd - >/dev/null
else
    log "⚠️  No offsite repo at ${OFFSITE_REPO} — skipping offsite backup"
fi

# ── Step 6: Cleanup old local backups ──
DELETED=$(find "$BACKUP_DIR" -name "engram-backup-*.sql.gz" -type f -mtime +${RETENTION_DAYS} -print -delete 2>/dev/null | wc -l | tr -d ' ')
[ "$DELETED" -gt 0 ] && log "🧹 Deleted ${DELETED} old backup(s)"

TOTAL=$(ls -1 "$BACKUP_DIR"/engram-backup-*.sql.gz 2>/dev/null | wc -l | tr -d ' ')
log "📁 Total local backups: ${TOTAL}"
log "🏁 Backup complete!"
