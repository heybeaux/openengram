-- HEY-385: Upgrade identity stores from FileStoreService to Prisma
-- Creates tables for identity contracts, tasks, team profiles, challenges, and agent profiles.

-- Identity Contracts (delegation verification contracts)
CREATE TABLE "identity_contracts" (
    "id" TEXT NOT NULL,
    "task_description" TEXT NOT NULL,
    "expected_outputs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "success_criteria" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timeout" INTEGER NOT NULL,
    "constraints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "delegated_to" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" TEXT,
    "completed_at" TIMESTAMP(3),
    "account_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_contracts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "identity_contracts_delegated_to_idx" ON "identity_contracts"("delegated_to");
CREATE INDEX "identity_contracts_status_idx" ON "identity_contracts"("status");

-- Identity Tasks (delegation task log entries)
CREATE TABLE "identity_tasks" (
    "id" TEXT NOT NULL,
    "session_key" TEXT NOT NULL,
    "parent_session_key" TEXT,
    "agent_id" TEXT,
    "task" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "error" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "identity_tasks_agent_id_idx" ON "identity_tasks"("agent_id");
CREATE INDEX "identity_tasks_status_idx" ON "identity_tasks"("status");
CREATE INDEX "identity_tasks_created_at_idx" ON "identity_tasks"("created_at");

-- Identity Team Profiles (multi-agent team collaboration)
CREATE TABLE "identity_team_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "agent_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "collaboration_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "last_active" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identity_team_profiles_pkey" PRIMARY KEY ("id")
);

-- Identity Challenges (challenge protocol)
CREATE TABLE "identity_challenges" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT,
    "task_description" TEXT NOT NULL,
    "challenge_type" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "resolution" TEXT,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "account_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "identity_challenges_contract_id_idx" ON "identity_challenges"("contract_id");

-- Identity Agent Profiles (capability profiles for auto-challenge)
CREATE TABLE "identity_agent_profiles" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence_by_domain" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identity_agent_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "identity_agent_profiles_agent_id_key" ON "identity_agent_profiles"("agent_id");
