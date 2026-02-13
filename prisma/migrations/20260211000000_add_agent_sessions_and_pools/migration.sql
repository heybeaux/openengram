-- CreateEnum: AgentSessionStatus
DO $$ BEGIN
  CREATE TYPE "AgentSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'TERMINATED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: PoolVisibility
DO $$ BEGIN
  CREATE TYPE "PoolVisibility" AS ENUM ('GLOBAL', 'SHARED', 'PRIVATE');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: PoolPermission
DO $$ BEGIN
  CREATE TYPE "PoolPermission" AS ENUM ('READ', 'WRITE', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: MemoryAccessType
DO $$ BEGIN
  CREATE TYPE "MemoryAccessType" AS ENUM ('CREATED', 'READ', 'RECALLED', 'INJECTED', 'UPDATED', 'SUPERSEDED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- CreateTable: agent_sessions
CREATE TABLE IF NOT EXISTS "agent_sessions" (
    "id" TEXT NOT NULL,
    "session_key" TEXT NOT NULL,
    "parent_key" TEXT,
    "label" TEXT,
    "task_description" TEXT,
    "status" "AgentSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: memory_pools
CREATE TABLE IF NOT EXISTS "memory_pools" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "visibility" "PoolVisibility" NOT NULL DEFAULT 'GLOBAL',
    "description" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "memory_pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable: memory_pool_memberships
CREATE TABLE IF NOT EXISTS "memory_pool_memberships" (
    "id" TEXT NOT NULL,
    "memory_id" TEXT NOT NULL,
    "pool_id" TEXT NOT NULL,
    "added_by" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_pool_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable: pool_grants
CREATE TABLE IF NOT EXISTS "pool_grants" (
    "id" TEXT NOT NULL,
    "pool_id" TEXT NOT NULL,
    "agent_session_id" TEXT NOT NULL,
    "permission" "PoolPermission" NOT NULL DEFAULT 'READ',
    "granted_by" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "pool_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable: memory_access_logs
CREATE TABLE IF NOT EXISTS "memory_access_logs" (
    "id" TEXT NOT NULL,
    "memory_id" TEXT NOT NULL,
    "agent_session_id" TEXT NOT NULL,
    "accessType" "MemoryAccessType" NOT NULL,
    "context" TEXT,
    "tokens_cost" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_access_logs_pkey" PRIMARY KEY ("id")
);

-- Add column to memories for multi-agent attribution
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "created_by_session" TEXT;

-- CreateIndexes (safe with IF NOT EXISTS)
CREATE UNIQUE INDEX IF NOT EXISTS "agent_sessions_session_key_key" ON "agent_sessions"("session_key");
CREATE INDEX IF NOT EXISTS "agent_sessions_parent_key_idx" ON "agent_sessions"("parent_key");
CREATE INDEX IF NOT EXISTS "agent_sessions_status_idx" ON "agent_sessions"("status");
CREATE INDEX IF NOT EXISTS "agent_sessions_created_at_idx" ON "agent_sessions"("created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "memory_pools_user_id_name_key" ON "memory_pools"("user_id", "name");
CREATE INDEX IF NOT EXISTS "memory_pools_user_id_idx" ON "memory_pools"("user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "memory_pool_memberships_memory_id_pool_id_key" ON "memory_pool_memberships"("memory_id", "pool_id");
CREATE INDEX IF NOT EXISTS "memory_pool_memberships_pool_id_idx" ON "memory_pool_memberships"("pool_id");
CREATE INDEX IF NOT EXISTS "memory_pool_memberships_memory_id_idx" ON "memory_pool_memberships"("memory_id");

CREATE UNIQUE INDEX IF NOT EXISTS "pool_grants_pool_id_agent_session_id_key" ON "pool_grants"("pool_id", "agent_session_id");

CREATE INDEX IF NOT EXISTS "memory_access_logs_memory_id_created_at_idx" ON "memory_access_logs"("memory_id", "created_at");
CREATE INDEX IF NOT EXISTS "memory_access_logs_agent_session_id_created_at_idx" ON "memory_access_logs"("agent_session_id", "created_at");
CREATE INDEX IF NOT EXISTS "memory_access_logs_created_at_idx" ON "memory_access_logs"("created_at");

-- AddForeignKeys (use DO blocks to handle already-existing constraints)
DO $$ BEGIN
  ALTER TABLE "memory_pool_memberships" ADD CONSTRAINT "memory_pool_memberships_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "memory_pool_memberships" ADD CONSTRAINT "memory_pool_memberships_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "memory_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "pool_grants" ADD CONSTRAINT "pool_grants_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "memory_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "pool_grants" ADD CONSTRAINT "pool_grants_agent_session_id_fkey" FOREIGN KEY ("agent_session_id") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "memory_access_logs" ADD CONSTRAINT "memory_access_logs_agent_session_id_fkey" FOREIGN KEY ("agent_session_id") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
