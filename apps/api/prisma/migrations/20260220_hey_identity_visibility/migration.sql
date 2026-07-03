-- HEY-174: Add MemoryVisibility enum and visibility field to memories
CREATE TYPE "MemoryVisibility" AS ENUM ('PRIVATE', 'TEAM', 'PUBLIC');
ALTER TABLE "memories" ADD COLUMN "visibility" "MemoryVisibility" NOT NULL DEFAULT 'PRIVATE';
CREATE INDEX "memories_visibility_idx" ON "memories"("visibility");

-- HEY-176: Identity snapshots for dream cycle consolidation
CREATE TABLE "identity_snapshots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "trust_scores" JSONB NOT NULL DEFAULT '{}',
    "behavioral_traits" JSONB NOT NULL DEFAULT '[]',
    "source_memory_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dream_report_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "identity_snapshots_user_id_created_at_idx" ON "identity_snapshots"("user_id", "created_at");
CREATE INDEX "identity_snapshots_agent_id_created_at_idx" ON "identity_snapshots"("agent_id", "created_at");
