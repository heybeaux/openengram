#!/usr/bin/env bash
# Engram Database Restore Script
# Usage: ./scripts/restore.sh <backup-file.sql.gz>
set -euo pipefail

DB_NAME="engram"
DB_USER="clawdbot"
DB_HOST="localhost"
DB_PORT="5432"

if [ $# -lt 1 ]; then
    echo "Usage: $0 <backup-file.sql.gz>"
    echo "Available backups:"
    ls -lh ~/engram-backups/engram-backup-*.sql.gz 2>/dev/null || echo "  (none)"
    exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ File not found: $BACKUP_FILE"
    exit 1
fi

# Validate it's a gzip file
if ! file "$BACKUP_FILE" | grep -q gzip; then
    echo "❌ Not a valid gzip backup: $BACKUP_FILE"
    exit 1
fi

# Show backup info
echo "📦 Backup: $BACKUP_FILE"
echo "   Size: $(du -h "$BACKUP_FILE" | cut -f1)"
echo "   Date: $(stat -f '%Sm' "$BACKUP_FILE" 2>/dev/null || stat -c '%y' "$BACKUP_FILE" 2>/dev/null)"
echo ""
echo "⚠️  This will DROP and recreate the '${DB_NAME}' database!"
echo ""
read -p "Type 'yes' to confirm restore: " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted."
    exit 0
fi

# Find psql
find_psql() {
    command -v psql && return
    for ver in 18 17 16 15 14; do
        local p="/Applications/Postgres.app/Contents/Versions/${ver}/bin/psql"
        [ -x "$p" ] && echo "$p" && return
    done
    for p in /opt/homebrew/bin/psql /usr/local/bin/psql; do
        [ -x "$p" ] && echo "$p" && return
    done
}

PSQL=$(find_psql)
if [ -z "$PSQL" ]; then
    echo "❌ psql not found"
    exit 1
fi

echo "🔄 Restoring database..."

# Drop and recreate
"$PSQL" -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d postgres -c "DROP DATABASE IF EXISTS ${DB_NAME};" 2>/dev/null || true
"$PSQL" -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d postgres -c "CREATE DATABASE ${DB_NAME};"

# Restore
gunzip -c "$BACKUP_FILE" | "$PSQL" -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" --quiet

echo "✅ Database restored from $BACKUP_FILE"
