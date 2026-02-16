-- HEY-23: Add access_code column to accounts for persistent usage tracking
-- Apply with: prisma migrate deploy (on Railway)
ALTER TABLE "accounts" ADD COLUMN "access_code" TEXT;

-- Index for counting usage per code
CREATE INDEX "accounts_access_code_idx" ON "accounts"("access_code") WHERE "access_code" IS NOT NULL;
