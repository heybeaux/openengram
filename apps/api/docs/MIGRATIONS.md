# Migration Guide

## The Disaster
On an early deployment, someone ran `prisma migrate dev` against production. It reset the database and **wiped 543 memories**. The `premigrate:dev` script now blocks this:

```json
"premigrate:dev": "echo \"\\n⚠️  WARNING: Use npm run migrate:safe or npm run migrate:deploy instead\\n\" && exit 1"
```

## Safe Commands
```bash
npm run migrate:deploy   # prisma migrate deploy — applies pending migrations
npm run migrate:status   # Check migration state
npm run migrate:safe     # Wrapper script with extra checks
```

## NEVER
- `prisma migrate dev` on any shared database
- `prisma migrate reset` on anything with real data
- `prisma db push` on production

## Idempotency Rules

Every migration SQL must be safe to run multiple times (deploy won't re-run, but idempotency prevents partial-apply disasters).

### ✅ Correct Patterns
```sql
-- Tables
CREATE TABLE IF NOT EXISTS my_table (...);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_name ON my_table (col);

-- Columns (wrap in DO block)
DO $$ BEGIN
  ALTER TABLE my_table ADD COLUMN IF NOT EXISTS new_col TEXT;
END $$;

-- RLS Policies (DROP + CREATE, because IF NOT EXISTS is invalid)
DROP POLICY IF EXISTS my_policy ON my_table;
CREATE POLICY my_policy ON my_table ...;

-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;
```

### ❌ Invalid Patterns
```sql
-- THIS IS NOT VALID POSTGRESQL:
CREATE POLICY IF NOT EXISTS my_policy ON my_table ...;

-- This will fail on second run:
CREATE TABLE my_table (...);

-- This will fail if column exists:
ALTER TABLE my_table ADD COLUMN new_col TEXT;
```

## Writing a New Migration

1. Create the SQL file: `prisma/migrations/YYYYMMDD_description/migration.sql`
2. Make every statement idempotent
3. Test locally: `npm run migrate:deploy`
4. Verify: `npm run migrate:status`
5. Commit the migration file alongside schema changes

## Real Example (from codebase)
```sql
-- prisma/migrations/20260210_fog_index_snapshots/migration.sql
CREATE TABLE IF NOT EXISTS fog_index_snapshots (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    score       DOUBLE PRECISION NOT NULL,
    tier        TEXT NOT NULL,
    components  JSONB NOT NULL DEFAULT '[]'::jsonb,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fog_index_snapshots_computed_at
    ON fog_index_snapshots (computed_at DESC);
```
