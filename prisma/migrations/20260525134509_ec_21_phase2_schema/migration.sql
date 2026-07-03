-- CreateEnum
CREATE TYPE "CardLevel" AS ENUM ('REPOSITORY', 'SUBSYSTEM', 'MODULE', 'CAPABILITY');

-- CreateEnum
CREATE TYPE "PassRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "cards" ADD COLUMN     "level" "CardLevel" NOT NULL DEFAULT 'MODULE',
ADD COLUMN     "sourcePass" TEXT,
ADD COLUMN     "tokenCount" INTEGER;

-- CreateTable
CREATE TABLE "subsystems" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "memberModulePaths" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subsystems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pass_runs" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "passName" TEXT NOT NULL,
    "status" "PassRunStatus" NOT NULL DEFAULT 'PENDING',
    "inputHash" TEXT,
    "outputHash" TEXT,
    "model" TEXT,
    "tokenCost" INTEGER,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "pass_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subsystems_repoId_idx" ON "subsystems"("repoId");

-- CreateIndex
CREATE UNIQUE INDEX "subsystems_repoId_slug_key" ON "subsystems"("repoId", "slug");

-- CreateIndex
CREATE INDEX "pass_runs_repoId_passName_startedAt_idx" ON "pass_runs"("repoId", "passName", "startedAt");

-- CreateIndex
CREATE INDEX "pass_runs_repoId_status_idx" ON "pass_runs"("repoId", "status");

-- CreateIndex
CREATE INDEX "cards_repoId_level_idx" ON "cards"("repoId", "level");

-- AddForeignKey
ALTER TABLE "subsystems" ADD CONSTRAINT "subsystems_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pass_runs" ADD CONSTRAINT "pass_runs_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
