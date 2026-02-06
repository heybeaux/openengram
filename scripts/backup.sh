#!/usr/bin/env bash
# Engram Database Backup Script
# Backs up the engram PostgreSQL database with timestamp and compression.
# Retains backups for 30 days, auto-deletes older ones.
#
# Usage: ./scripts/backup.sh
# Cron:  0 */6 * * * cd /path/to/engram && ./scripts/backup.sh
#
# Environment variables (all optional, with sensible defaults):
#   ENGRAM_DB_NAME      Database name (default: engram)
#   ENGRAM_DB_USER      Database user (default: $USER)
#   ENGRAM_DB_HOST      Database host (default: localhost)
#   ENGRAM_BACKUP_DIR   Backup directory (default: ./backups)
#   ENGRAM_RETENTION    Days to retain backups (default: 30)

set -euo pipefail

# --- Config (env vars with defaults) ---
DB_NAME="${ENGRAM_DB_NAME:-engram}"
DB_USER="${ENGRAM_DB_USER:-$USER}"
DB_HOST="${ENGRAM_DB_HOST:-localhost}"
BACKUP_DIR="${ENGRAM_BACKUP_DIR:-$(cd "$(dirname "$0")/.." && pwd)/backups}"
RETENTION_DAYS="${ENGRAM_RETENTION:-30}"

# Find pg_dump - check common locations
find_pg_dump() {
    # Check if pg_dump is in PATH
    if command -v pg_dump &> /dev/null; then
        echo "pg_dump"
        return
    fi
    # macOS Postgres.app locations
    for ver in 18 17 16 15 14; do
        local pg_path="/Applications/Postgres.app/Contents/Versions/${ver}/bin/pg_dump"
        if [ -x "$pg_path" ]; then
            echo "$pg_path"
            return
        fi
    done
    # Homebrew locations
    for pg_path in /opt/homebrew/bin/pg_dump /usr/local/bin/pg_dump; do
        if [ -x "$pg_path" ]; then
            echo "$pg_path"
            return
        fi
    done
    echo ""
}

PG_DUMP=$(find_pg_dump)
if [ -z "$PG_DUMP" ]; then
    echo "❌ pg_dump not found. Install PostgreSQL or set it in PATH."
    exit 1
fi

# --- Setup ---
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/engram_backup_${TIMESTAMP}.sql.gz"

# --- Backup ---
echo "🗄️  Backing up database '${DB_NAME}' → ${BACKUP_FILE}"
"$PG_DUMP" -U "$DB_USER" -h "$DB_HOST" -d "$DB_NAME" --no-password | gzip > "$BACKUP_FILE"

# Verify
if [ -s "$BACKUP_FILE" ]; then
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "✅ Backup complete: ${BACKUP_FILE} (${SIZE})"
else
    echo "❌ Backup failed — file is empty"
    rm -f "$BACKUP_FILE"
    exit 1
fi

# --- Cleanup old backups ---
DELETED=$(find "$BACKUP_DIR" -name "engram_backup_*.sql.gz" -type f -mtime +${RETENTION_DAYS} -print -delete | wc -l | tr -d ' ')
if [ "$DELETED" -gt 0 ]; then
    echo "🧹 Deleted ${DELETED} backup(s) older than ${RETENTION_DAYS} days"
fi

echo "📁 Backups in ${BACKUP_DIR}: $(ls -1 "$BACKUP_DIR"/engram_backup_*.sql.gz 2>/dev/null | wc -l | tr -d ' ') file(s)"
