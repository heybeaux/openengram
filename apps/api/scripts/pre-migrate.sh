#!/usr/bin/env bash
# Pre-Migration Backup Hook for Engram
# Run this BEFORE any prisma migrate command to protect your data.
#
# Usage: ./scripts/pre-migrate.sh && npx prisma migrate deploy
#
# ⚠️  NEVER use `prisma migrate dev` on a database with real data.
#     It RESETS the database, dropping all tables and data.
#     Use `prisma migrate deploy` instead.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Use same defaults as backup.sh
DB_NAME="${ENGRAM_DB_NAME:-engram}"
DB_USER="${ENGRAM_DB_USER:-$USER}"
DB_HOST="${ENGRAM_DB_HOST:-localhost}"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  ⚠️  BACKING UP DATABASE BEFORE MIGRATION               ║"
echo "║                                                          ║"
echo "║  This creates a safety backup in case the migration      ║"
echo "║  causes data loss. If anything goes wrong, restore with: ║"
echo "║                                                          ║"
echo "║    gunzip -c backups/engram_backup_<timestamp>.sql.gz \\ ║"
echo "║      | psql -U $DB_USER -h $DB_HOST $DB_NAME              "
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Run the backup script
"${SCRIPT_DIR}/backup.sh"

echo ""
echo "✅ Pre-migration backup complete. Safe to proceed with migration."
echo ""
echo "🔴 REMINDER: Use 'prisma migrate deploy' — NEVER 'prisma migrate dev' on real data!"
echo ""
