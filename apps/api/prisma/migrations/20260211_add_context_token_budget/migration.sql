-- AlterTable
ALTER TABLE "agent_sessions" ADD COLUMN IF NOT EXISTS "context_token_budget" INTEGER;
