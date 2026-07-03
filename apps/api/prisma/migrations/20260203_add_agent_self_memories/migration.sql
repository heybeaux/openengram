-- Add SubjectType enum
CREATE TYPE "SubjectType" AS ENUM ('USER', 'AGENT', 'ENTITY');

-- Add agent self-memory fields to memories table
ALTER TABLE "memories" ADD COLUMN "subject_type" "SubjectType" NOT NULL DEFAULT 'USER';
ALTER TABLE "memories" ADD COLUMN "subject_id" TEXT;
ALTER TABLE "memories" ADD COLUMN "agent_id" TEXT;

-- Create index for efficient subject-based queries
CREATE INDEX "memories_subject_type_agent_id_idx" ON "memories"("subject_type", "agent_id");
