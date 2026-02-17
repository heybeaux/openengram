-- Add INSIGHT to MemoryLayer enum
ALTER TYPE "MemoryLayer" ADD VALUE IF NOT EXISTS 'INSIGHT';

-- Add metadata JSON column to memories table
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- Create awareness_states table for Waking Cycle checkpoints
CREATE TABLE IF NOT EXISTS "awareness_states" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "signal_source" TEXT NOT NULL,
    "last_checked_at" TIMESTAMP(3) NOT NULL,
    "checkpoint" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "awareness_states_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: one state per signal source per account
CREATE UNIQUE INDEX IF NOT EXISTS "awareness_states_account_id_signal_source_key" ON "awareness_states"("account_id", "signal_source");

-- Foreign key to accounts
ALTER TABLE "awareness_states" ADD CONSTRAINT "awareness_states_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
