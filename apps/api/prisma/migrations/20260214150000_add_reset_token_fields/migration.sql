-- AlterTable
ALTER TABLE "accounts" ADD COLUMN "reset_token" TEXT;
ALTER TABLE "accounts" ADD COLUMN "reset_token_expires_at" TIMESTAMP(3);
