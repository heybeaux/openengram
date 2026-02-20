-- HEY-177: Add TASK_OUTCOME and SELF_ASSESSMENT to MemoryType enum
ALTER TYPE "MemoryType" ADD VALUE IF NOT EXISTS 'TASK_OUTCOME';
ALTER TYPE "MemoryType" ADD VALUE IF NOT EXISTS 'SELF_ASSESSMENT';

-- HEY-179: Agent Capability Profiles
CREATE TABLE "agent_capability_profiles" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "evidence_count" INTEGER NOT NULL DEFAULT 0,
    "success_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "avg_duration_ms" DOUBLE PRECISION,
    "last_used_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_capability_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_capability_profiles_agent_id_user_id_capability_key" ON "agent_capability_profiles"("agent_id", "user_id", "capability");
CREATE INDEX "agent_capability_profiles_agent_id_user_id_idx" ON "agent_capability_profiles"("agent_id", "user_id");

-- HEY-181: Agent Work Style Tracking
CREATE TABLE "agent_work_styles" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "sample_count" INTEGER NOT NULL DEFAULT 0,
    "trend" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_work_styles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_work_styles_agent_id_user_id_dimension_key" ON "agent_work_styles"("agent_id", "user_id", "dimension");
CREATE INDEX "agent_work_styles_agent_id_user_id_idx" ON "agent_work_styles"("agent_id", "user_id");
