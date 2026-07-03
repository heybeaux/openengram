# Database Role Lockdown

## Why This Exists

Sub-agents have accidentally wiped the entire Engram database **twice** by running `prisma migrate reset` or `prisma migrate dev`. This role setup prevents that at the PostgreSQL level.

## Roles

### `clawdbot` (application role)
- **Used by**: The Engram app, Prisma client, sub-agents
- **Can**: SELECT, INSERT, UPDATE, DELETE on all tables; USAGE on sequences; EXECUTE functions
- **Cannot**: DROP tables, TRUNCATE tables, CREATE tables, ALTER schema
- **Not a superuser** — permission checks are enforced

### `engram_admin` (migration role)
- **Used by**: Manual migrations only (human-initiated)
- **Can**: Everything (superuser)
- **Password**: `engram_admin_local` (local only, no remote access)

## Running Migrations

**Never run `prisma migrate dev` or `prisma migrate reset` with the default DATABASE_URL.**

To apply migrations safely:

```bash
DATABASE_URL=postgresql://engram_admin:engram_admin_local@localhost:5432/engram pnpm prisma migrate deploy
```

After running migrations, re-grant permissions to clawdbot:

```bash
PSQL=/Applications/Postgres.app/Contents/Versions/latest/bin/psql
$PSQL -d engram -U engram_admin -c "
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO clawdbot;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO clawdbot;
"
```

## Restoring Permissions (if needed)

If clawdbot loses access to new tables after a migration:

```bash
PSQL=/Applications/Postgres.app/Contents/Versions/latest/bin/psql
$PSQL -d engram -U engram_admin -c "
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO clawdbot;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO clawdbot;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO clawdbot;
"
```

## Reverting (making clawdbot superuser again)

Only if absolutely necessary:

```bash
$PSQL -d engram -U engram_admin -c "ALTER ROLE clawdbot SUPERUSER;"
```

## Setup Date
2026-02-14 — after second data wipe incident.
