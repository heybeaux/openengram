-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "MemoryType" AS ENUM ('CONSTRAINT', 'PREFERENCE', 'FACT', 'TASK', 'EVENT', 'LESSON');

-- AlterTable
ALTER TABLE "memories" ADD COLUMN     "consolidated_into" TEXT,
ADD COLUMN     "effective_score" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
ADD COLUMN     "embedding" vector,
ADD COLUMN     "memory_type" "MemoryType",
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "promoted_from" TEXT,
ADD COLUMN     "safety_critical" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "score_computed_at" TIMESTAMP(3),
ADD COLUMN     "superseded_at" TIMESTAMP(3),
ADD COLUMN     "type_confidence" DOUBLE PRECISION,
ADD COLUMN     "user_hidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "user_pinned" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "memory_extractions" ADD COLUMN     "how_confidence" DOUBLE PRECISION,
ADD COLUMN     "memory_type" "MemoryType",
ADD COLUMN     "type_confidence" DOUBLE PRECISION,
ADD COLUMN     "what_confidence" DOUBLE PRECISION,
ADD COLUMN     "when_confidence" DOUBLE PRECISION,
ADD COLUMN     "where_confidence" DOUBLE PRECISION,
ADD COLUMN     "who_confidence" DOUBLE PRECISION,
ADD COLUMN     "why_confidence" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "memories_embedding_idx" ON "memories"("embedding");

-- CreateIndex
CREATE INDEX "memories_user_id_layer_priority_created_at_idx" ON "memories"("user_id", "layer", "priority", "created_at" DESC);

-- CreateIndex
CREATE INDEX "memories_user_id_memory_type_user_hidden_idx" ON "memories"("user_id", "memory_type", "user_hidden");

-- CreateIndex
CREATE INDEX "memories_user_id_effective_score_idx" ON "memories"("user_id", "effective_score" DESC);

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_consolidated_into_fkey" FOREIGN KEY ("consolidated_into") REFERENCES "memories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
