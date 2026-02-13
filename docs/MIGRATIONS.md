# Migration Safety Guide

## Golden Rules
1. **Never run `prisma migrate dev` on production** — only `prisma migrate deploy`
2. **Every migration must be idempotent** — safe to run multiple times
3. **Test migrations against a copy** before applying to production
4. **`package.json` blocks `prisma migrate dev`** via `premigrate:dev` script

## Commands
```bash
npm run migrate:deploy    # Apply pending migrations (production-safe)
npm run migrate:safe      # Apply with safety wrapper script
npm run migrate:status    # Check migration status
npx prisma migrate dev    # BLOCKED — will error with warning
```

## Idempotency Patterns

### ✅ Safe: CREATE TABLE
```sql
CREATE TABLE IF NOT EXISTS "my_table" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "my_table_pkey" PRIMARY KEY ("id")
);
```

### ✅ Safe: CREATE INDEX
```sql
CREATE INDEX IF NOT EXISTS "my_table_user_id_idx" ON "my_table"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "my_table_name_key" ON "my_table"("name");
```

### ✅ Safe: ADD COLUMN
```sql
DO $$ BEGIN
    ALTER TABLE "my_table" ADD COLUMN "new_col" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
```

### ✅ Safe: RLS POLICIES
```sql
DROP POLICY IF EXISTS "my_policy" ON "my_table";
CREATE POLICY "my_policy" ON "my_table" FOR ALL USING (true);
```

### ✅ Safe: EXTENSIONS
```sql
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
```

### ❌ Unsafe: Prisma default output
```sql
-- Prisma generates this — NOT idempotent!
CREATE TABLE "my_table" (...);  -- Fails if table exists
CREATE INDEX "idx" ON ...;       -- Fails if index exists
ALTER TABLE ADD COLUMN "x" TEXT; -- Fails if column exists
```

## Workflow
1. `npx prisma migrate dev --create-only` (local dev only — creates the SQL file)
2. **Edit the generated SQL** to add `IF NOT EXISTS` / `IF EXISTS` guards
3. Review the migration carefully
4. Commit the migration file
5. Deploy with `npm run migrate:deploy`

## The Disaster Story
Early on, `prisma migrate dev` was run against production. It attempted to reset the database to match the schema from scratch, wiping data. The `premigrate:dev` script in `package.json` now blocks this command entirely. Use `migrate:deploy` which only applies forward migrations.
