-- CreateEnum
CREATE TYPE "MemoryDurability" AS ENUM ('UNCLASSIFIED', 'DURABLE', 'EPHEMERAL');

-- AlterTable
ALTER TABLE "memories" ADD COLUMN "durability" "MemoryDurability" NOT NULL DEFAULT 'UNCLASSIFIED';
ALTER TABLE "memories" ADD COLUMN "durabilityClassifiedAt" TIMESTAMP(3);
