# Consolidated Prisma Migration Plan (HEY-319)

> Created: 2026-02-21 | Status: PLAN ONLY — no migrations created or executed

## Summary

The following models exist in `prisma/schema.prisma` but do **not** have corresponding migration files in `prisma/migrations/`. These tables need to be created in production before the features that depend on them can be used.

## Existing Migrations (Already Applied)

These identity-related migrations already exist and should already be in production:

| Migration | Tables/Changes |
|-----------|---------------|
| `20260210_add_agent_sessions_and_pools` | `agent_sessions`, `memory_pools`, `memory_pool_memberships`, `pool_grants`, `memory_access_logs` + enums |
| `20260220_add_task_completions` | `task_completions` |
| `20260220_hey_identity_visibility` | `MemoryVisibility` enum, `identity_snapshots`, `memories.visibility` column |
| `20260220_identity_profiles` | `agent_capability_profiles`, `agent_work_styles`, `TASK_OUTCOME`/`SELF_ASSESSMENT` enum values |
| `20260220_identity_framework` | No-op documentation migration |

## Pending Schema Changes (No Migration Files)

### New Enums Needed

```sql
-- 1. TrustSignalType enum
CREATE TYPE "TrustSignalType" AS ENUM ('SUCCESS', 'FAILURE', 'CORRECTION');

-- 2. TaskStatus enum
CREATE TYPE "TaskStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- 3. ContractStatus enum
CREATE TYPE "ContractStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'REJECTED');
```

### New Tables Needed

Listed in dependency order (tables with no foreign keys first).

---

#### Migration 1: Trust & Experience Tables (HEY-170, HEY-172, HEY-173)

**Tables:** `trust_signals`, `trust_scores`, `capability_checkpoints`, `experience_weights`

```sql
-- Enum
CREATE TYPE "TrustSignalType" AS ENUM ('SUCCESS', 'FAILURE', 'CORRECTION');

-- trust_signals (HEY-170)
CREATE TABLE IF NOT EXISTS "trust_signals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "signal_type" "TrustSignalType" NOT NULL,
    "context" TEXT NOT NULL,
    "category" TEXT,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "source_memory_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trust_signals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "trust_signals_user_id_created_at_idx" ON "trust_signals"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "trust_signals_user_id_category_idx" ON "trust_signals"("user_id", "category");
CREATE INDEX IF NOT EXISTS "trust_signals_user_id_signal_type_idx" ON "trust_signals"("user_id", "signal_type");
CREATE INDEX IF NOT EXISTS "trust_signals_agent_id_created_at_idx" ON "trust_signals"("agent_id", "created_at");

-- trust_scores (HEY-170)
CREATE TABLE IF NOT EXISTS "trust_scores" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "category" TEXT,
    "score" DOUBLE PRECISION NOT NULL,
    "signal_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "correction_count" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trust_scores_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "trust_scores_user_id_category_idx" ON "trust_scores"("user_id", "category");
CREATE INDEX IF NOT EXISTS "trust_scores_user_id_computed_at_idx" ON "trust_scores"("user_id", "computed_at");
CREATE INDEX IF NOT EXISTS "trust_scores_agent_id_category_idx" ON "trust_scores"("agent_id", "category");

-- capability_checkpoints (HEY-172)
CREATE TABLE IF NOT EXISTS "capability_checkpoints" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "capabilities" JSONB NOT NULL,
    "checkpoint_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "capability_checkpoints_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "capability_checkpoints_user_id_checkpoint_at_idx" ON "capability_checkpoints"("user_id", "checkpoint_at");
CREATE INDEX IF NOT EXISTS "capability_checkpoints_agent_id_checkpoint_at_idx" ON "capability_checkpoints"("agent_id", "checkpoint_at");

-- experience_weights (HEY-173)
CREATE TABLE IF NOT EXISTS "experience_weights" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "category" TEXT NOT NULL,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "experience_weights_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "experience_weights_user_id_agent_id_category_key" ON "experience_weights"("user_id", "agent_id", "category");
CREATE INDEX IF NOT EXISTS "experience_weights_user_id_weight_idx" ON "experience_weights"("user_id", "weight" DESC);
```

**Rollback SQL:**
```sql
DROP TABLE IF EXISTS "experience_weights" CASCADE;
DROP TABLE IF EXISTS "capability_checkpoints" CASCADE;
DROP TABLE IF EXISTS "trust_scores" CASCADE;
DROP TABLE IF EXISTS "trust_signals" CASCADE;
DROP TYPE IF EXISTS "TrustSignalType";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20260221_trust_experience_tables';
```

---

#### Migration 2: Multi-Agent Teams (HEY-188)

**Tables:** `agent_teams`, `agent_team_members`, `agent_team_collaborations`

```sql
-- agent_teams
CREATE TABLE IF NOT EXISTS "agent_teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "user_id" TEXT NOT NULL,
    "shared_capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trust_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "collaboration_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "agent_teams_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "agent_teams_user_id_idx" ON "agent_teams"("user_id");

-- agent_team_members
CREATE TABLE IF NOT EXISTS "agent_team_members" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "role" TEXT,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_team_members_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "agent_team_members"
    ADD CONSTRAINT "agent_team_members_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "agent_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "agent_team_members_team_id_agent_id_key" ON "agent_team_members"("team_id", "agent_id");
CREATE INDEX IF NOT EXISTS "agent_team_members_agent_id_idx" ON "agent_team_members"("agent_id");

-- agent_team_collaborations
CREATE TABLE IF NOT EXISTS "agent_team_collaborations" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "task_description" TEXT NOT NULL,
    "participant_agent_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "outcome" TEXT,
    "score" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_team_collaborations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "agent_team_collaborations"
    ADD CONSTRAINT "agent_team_collaborations_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "agent_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "agent_team_collaborations_team_id_created_at_idx" ON "agent_team_collaborations"("team_id", "created_at");
```

**Rollback SQL:**
```sql
DROP TABLE IF EXISTS "agent_team_collaborations" CASCADE;
DROP TABLE IF EXISTS "agent_team_members" CASCADE;
DROP TABLE IF EXISTS "agent_teams" CASCADE;
DELETE FROM "_prisma_migrations" WHERE migration_name = '20260221_multi_agent_teams';
```

---

#### Migration 3: Delegation Framework (HEY-182, HEY-183, HEY-185)

**Tables:** `delegation_templates`, `delegation_contracts`, `delegated_tasks`

```sql
-- Enums
CREATE TYPE "TaskStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'FAILED');
CREATE TYPE "ContractStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'REJECTED');

-- delegation_templates (HEY-183) — no FK dependencies
CREATE TABLE IF NOT EXISTS "delegation_templates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "required_capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "default_instructions" TEXT,
    "expected_outputs" TEXT,
    "typical_duration_ms" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "delegation_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "delegation_templates_user_id_name_key" ON "delegation_templates"("user_id", "name");
CREATE INDEX IF NOT EXISTS "delegation_templates_user_id_task_type_idx" ON "delegation_templates"("user_id", "task_type");

-- delegation_contracts (HEY-185)
CREATE TABLE IF NOT EXISTS "delegation_contracts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "delegator" TEXT NOT NULL,
    "delegate" TEXT NOT NULL,
    "task_description" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'PROPOSED',
    "terms" JSONB NOT NULL,
    "result" TEXT,
    "verified_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "delegation_contracts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "delegation_contracts_user_id_status_idx" ON "delegation_contracts"("user_id", "status");
CREATE INDEX IF NOT EXISTS "delegation_contracts_delegator_idx" ON "delegation_contracts"("delegator");
CREATE INDEX IF NOT EXISTS "delegation_contracts_delegate_idx" ON "delegation_contracts"("delegate");

-- delegated_tasks (HEY-182) — references templates and contracts
CREATE TABLE IF NOT EXISTS "delegated_tasks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "assigned_to" TEXT NOT NULL,
    "assigned_by" TEXT NOT NULL,
    "task_description" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'ASSIGNED',
    "deadline" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "result" TEXT,
    "metadata" JSONB,
    "memory_id" TEXT,
    "template_id" TEXT,
    "contract_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "delegated_tasks_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "delegated_tasks"
    ADD CONSTRAINT "delegated_tasks_template_id_fkey"
    FOREIGN KEY ("template_id") REFERENCES "delegation_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "delegated_tasks"
    ADD CONSTRAINT "delegated_tasks_contract_id_fkey"
    FOREIGN KEY ("contract_id") REFERENCES "delegation_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "delegated_tasks_user_id_status_idx" ON "delegated_tasks"("user_id", "status");
CREATE INDEX IF NOT EXISTS "delegated_tasks_assigned_to_status_idx" ON "delegated_tasks"("assigned_to", "status");
CREATE INDEX IF NOT EXISTS "delegated_tasks_assigned_by_idx" ON "delegated_tasks"("assigned_by");
CREATE INDEX IF NOT EXISTS "delegated_tasks_contract_id_idx" ON "delegated_tasks"("contract_id");
```

**Rollback SQL:**
```sql
DROP TABLE IF EXISTS "delegated_tasks" CASCADE;
DROP TABLE IF EXISTS "delegation_contracts" CASCADE;
DROP TABLE IF EXISTS "delegation_templates" CASCADE;
DROP TYPE IF EXISTS "ContractStatus";
DROP TYPE IF EXISTS "TaskStatus";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20260221_delegation_framework';
```

---

## Models NOT Needing Migration

The following identity-related concepts from the task description are **not** database models:

| Concept | Status | Notes |
|---------|--------|-------|
| `Challenge` | In-memory store | Not in `schema.prisma` — runtime only |
| `FailurePattern` | In-memory store | Not in `schema.prisma` — runtime only |
| `Team` (generic) | Covered by `AgentTeam` | See Migration 2 above |

## Order of Operations

1. **Take database backup** (see Pre-Migration Backup below)
2. **Create migration files** — Write `.sql` files in `prisma/migrations/` directories
3. **Apply Migration 1** — Trust & Experience (no foreign keys, independent)
4. **Apply Migration 2** — Multi-Agent Teams (self-referential FKs only)
5. **Apply Migration 3** — Delegation Framework (has FK to templates/contracts)
6. **Run `prisma migrate deploy`** — Applies all pending migrations in order
7. **Verify** — Check all tables exist, run API smoke tests

Migrations 1 and 2 are independent and can be applied in any order. Migration 3 must come after its own tables are created in order (templates → contracts → tasks).

## Pre-Migration Backup Steps

```bash
# 1. Full database dump
pg_dump "$DATABASE_URL" --no-owner --format=custom \
  -f "engram-backup-$(date +%Y%m%d-%H%M%S).dump"

# 2. Verify backup is readable
pg_restore --list "engram-backup-*.dump" | head -20

# 3. Record current migration state
npx prisma migrate status 2>&1 | tee migration-status-pre.txt

# 4. Record current table list
psql "$DATABASE_URL" -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;" \
  | tee tables-pre.txt
```

## Post-Migration Verification

```sql
-- Verify all new tables exist
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN (
  'trust_signals', 'trust_scores', 'capability_checkpoints', 'experience_weights',
  'agent_teams', 'agent_team_members', 'agent_team_collaborations',
  'delegated_tasks', 'delegation_templates', 'delegation_contracts'
)
ORDER BY tablename;
-- Should return 10 rows

-- Verify enums exist
SELECT typname FROM pg_type
WHERE typname IN ('TrustSignalType', 'TaskStatus', 'ContractStatus');
-- Should return 3 rows

-- Verify Prisma migration records
SELECT migration_name, finished_at FROM "_prisma_migrations"
ORDER BY finished_at DESC LIMIT 5;
```

## ⚠️ Reminders

- **DO NOT** run `prisma migrate dev` — it will reset the database
- **DO NOT** run `prisma migrate reset` — it will wipe all data
- **DO NOT** run `prisma db push` on production
- Use `prisma migrate deploy` only after creating migration files manually
- All migration SQL should use `IF NOT EXISTS` / `IF EXISTS` guards for idempotency
