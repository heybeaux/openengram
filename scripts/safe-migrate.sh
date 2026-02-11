#!/usr/bin/env bash
# Safe Migration Wrapper — prevents prisma migrate dev on production data
# Usage: ./scripts/safe-migrate.sh [prisma migrate args...]
set -euo pipefail

DB_NAME="engram"
DB_USER="clawdbot"
DB_HOST="localhost"
DB_PORT="5432"
THRESHOLD=100

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

# Count memories
COUNT=$("$PSQL" -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" -t -A -c "SELECT COUNT(*) FROM \"Memory\";" 2>/dev/null || echo "0")

# Check if args contain "migrate dev"
ARGS="$*"
if echo "$ARGS" | grep -q "migrate dev"; then
    if [ "$COUNT" -gt "$THRESHOLD" ]; then
        echo "🛑 BLOCKED: Database has ${COUNT} memories (threshold: ${THRESHOLD})"
        echo ""
        echo "   'prisma migrate dev' RESETS the database and DESTROYS ALL DATA."
        echo "   This is what wiped 543 memories on Feb 5, 2026."
        echo ""
        echo "   Use instead:  npx prisma migrate deploy"
        echo "   Or to force:  FORCE_MIGRATE=1 ./scripts/safe-migrate.sh migrate dev"
        echo ""
        if [ "${FORCE_MIGRATE:-}" != "1" ]; then
            exit 1
        fi
        echo "⚠️  FORCE_MIGRATE=1 set. Proceeding anyway..."
    else
        echo "✅ Database has ${COUNT} memories (≤${THRESHOLD}). Safe to migrate dev."
    fi
fi

echo "Running: npx prisma $ARGS"
cd "$(dirname "$0")/.."
exec npx prisma $ARGS
