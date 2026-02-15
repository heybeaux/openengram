#!/usr/bin/env bash
# Engram Cloud Backup Script
# Backs up Supabase production database to local storage.
# READ-ONLY — never writes to the cloud DB.
set -euo pipefail

# ── Config ──
BACKUP_DIR="$HOME/engram-backups/cloud"
RETENTION_DAYS=30
MIN_SIZE_BYTES=10000  # 10KB minimum

export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"

# Load credentials from .env.cloud (not committed)
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env.cloud"
if [ -f "$ENV_FILE" ]; then
    # shellcheck disable=SC1090
    source "$ENV_FILE"
fi

# SUPABASE_DIRECT_URL must be set (direct connection, not pooler)
if [ -z "${SUPABASE_DIRECT_URL:-}" ]; then
    echo "❌ SUPABASE_DIRECT_URL not set. Create .env.cloud or export it."
    exit 1
fi

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +"%Y-%m-%d-%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/engram-cloud-${TIMESTAMP}.sql.gz"

# ── Step 1: Pre-backup count ──
log "📊 Counting cloud memories..."
PRE_COUNT=$(psql "$SUPABASE_DIRECT_URL" -t -c "SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL;" 2>/dev/null | tr -d ' ')
log "   Cloud memory count: ${PRE_COUNT}"

# ── Step 2: Dump (read-only) ──
log "🗄️  Dumping Supabase production → ${BACKUP_FILE}"
if ! pg_dump "$SUPABASE_DIRECT_URL" \
    --no-owner --no-privileges --no-comments \
    --schema=public \
    | gzip > "$BACKUP_FILE"; then
    log "❌ pg_dump failed"
    rm -f "$BACKUP_FILE"
    exit 1
fi

# ── Step 3: Size check ──
FILE_SIZE=$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_FILE" 2>/dev/null)
if [ "$FILE_SIZE" -lt "$MIN_SIZE_BYTES" ]; then
    log "❌ Backup too small (${FILE_SIZE} bytes). Likely corrupt or empty."
    exit 1
fi
log "📦 Backup size: $(du -h "$BACKUP_FILE" | cut -f1)"

# ── Step 4: Verify ──
log "🔍 Verifying backup..."
TABLES_IN_BACKUP=$(gunzip -c "$BACKUP_FILE" | grep -c "^COPY public\." || true)
MEMORIES_IN_BACKUP=$(gunzip -c "$BACKUP_FILE" | sed -n '/^COPY public\.memories /,/^\\.$/p' | wc -l | tr -d ' ')
MEMORIES_IN_BACKUP=$((MEMORIES_IN_BACKUP - 2))  # subtract COPY and \. lines

log "   Tables: ${TABLES_IN_BACKUP}"
log "   Memories in backup: ${MEMORIES_IN_BACKUP}"

if [ "$MEMORIES_IN_BACKUP" -lt "$((PRE_COUNT - 10))" ]; then
    log "❌ VERIFICATION FAILED: Backup has ${MEMORIES_IN_BACKUP} but cloud has ${PRE_COUNT}"
    exit 1
fi
log "✅ Verified: ${MEMORIES_IN_BACKUP} memories (cloud has ${PRE_COUNT})"

# ── Step 5: Prune old backups ──
DELETED=$(find "$BACKUP_DIR" -name "engram-cloud-*.sql.gz" -type f -mtime +${RETENTION_DAYS} -print -delete 2>/dev/null | wc -l | tr -d ' ')
[ "$DELETED" -gt 0 ] && log "🧹 Pruned ${DELETED} old backup(s)"

TOTAL=$(ls -1 "$BACKUP_DIR"/engram-cloud-*.sql.gz 2>/dev/null | wc -l | tr -d ' ')
log "📁 Total cloud backups: ${TOTAL}"
log "🏁 Cloud backup complete!"
