-- CreateEnum
CREATE TYPE "EmbeddingStatus" AS ENUM ('PENDING', 'COMPLETE', 'FAILED');

-- AlterTable
ALTER TABLE "memories" ADD COLUMN "embedding_status" "EmbeddingStatus" NOT NULL DEFAULT 'PENDING';

-- Backfill: memories that already have embeddings are COMPLETE
UPDATE "memories" SET "embedding_status" = 'COMPLETE' WHERE "embedding_id" IS NOT NULL;

-- CreateIndex
CREATE INDEX "memories_embedding_status_idx" ON "memories"("embedding_status");
