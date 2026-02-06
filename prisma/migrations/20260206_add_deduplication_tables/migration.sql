-- Migration: add_deduplication_tables
-- Created: 2026-02-06
-- Purpose: Add deduplication system tables for memory merge tracking

-- Create MemoryMergeEvent table for tracking merge history and lineage
CREATE TABLE IF NOT EXISTS "memory_merge_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "survivor_memory_id" TEXT NOT NULL,
    "absorbed_memory_ids" TEXT[] NOT NULL,
    "strategy" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "triggered_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "original_contents" TEXT NOT NULL,
    "merged_content" TEXT NOT NULL,
    "content_changed" BOOLEAN NOT NULL DEFAULT false,
    "can_rollback" BOOLEAN NOT NULL DEFAULT true,
    "rolled_back_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_merge_events_pkey" PRIMARY KEY ("id")
);

-- Create MergeCandidate table for review queue
CREATE TABLE IF NOT EXISTS "merge_candidates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "memory_ids" TEXT[] NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "suggested_strategy" TEXT NOT NULL,
    "suggested_survivor_id" TEXT NOT NULL,
    "safety_flags" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_notes" TEXT,
    "skip_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merge_candidates_pkey" PRIMARY KEY ("id")
);

-- Create DedupConfig table for user-specific configuration
CREATE TABLE IF NOT EXISTS "dedup_configs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "auto_merge_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.95,
    "review_suggest_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    "default_strategy" TEXT NOT NULL DEFAULT 'KEEP_DETAILED',
    "strategy_by_type" TEXT NOT NULL DEFAULT '{}',
    "preserve_source_content" BOOLEAN NOT NULL DEFAULT true,
    "regenerate_embedding" BOOLEAN NOT NULL DEFAULT true,
    "protected_types" TEXT[] NOT NULL DEFAULT ARRAY['CONSTRAINT']::TEXT[],
    "protected_keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "protected_importance_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "batch_schedule" TEXT NOT NULL DEFAULT '0 3 * * *',
    "max_memories_per_batch" INTEGER NOT NULL DEFAULT 5000,
    "batch_enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_batch_run_at" TIMESTAMP(3),
    "last_batch_stats" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dedup_configs_pkey" PRIMARY KEY ("id")
);

-- Create DedupBatchRun table for batch run history
CREATE TABLE IF NOT EXISTS "dedup_batch_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "memories_processed" INTEGER NOT NULL DEFAULT 0,
    "clusters_found" INTEGER NOT NULL DEFAULT 0,
    "auto_merged" INTEGER NOT NULL DEFAULT 0,
    "queued_for_review" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "config_snapshot" TEXT NOT NULL,

    CONSTRAINT "dedup_batch_runs_pkey" PRIMARY KEY ("id")
);

-- Create indexes for MemoryMergeEvent
CREATE INDEX IF NOT EXISTS "memory_merge_events_user_id_idx" ON "memory_merge_events"("user_id");
CREATE INDEX IF NOT EXISTS "memory_merge_events_survivor_memory_id_idx" ON "memory_merge_events"("survivor_memory_id");
CREATE INDEX IF NOT EXISTS "memory_merge_events_created_at_idx" ON "memory_merge_events"("created_at");

-- Create indexes for MergeCandidate
CREATE INDEX IF NOT EXISTS "merge_candidates_user_id_status_idx" ON "merge_candidates"("user_id", "status");
CREATE INDEX IF NOT EXISTS "merge_candidates_created_at_idx" ON "merge_candidates"("created_at");

-- Create unique constraint for DedupConfig
CREATE UNIQUE INDEX IF NOT EXISTS "dedup_configs_user_id_key" ON "dedup_configs"("user_id");

-- Create indexes for DedupBatchRun
CREATE INDEX IF NOT EXISTS "dedup_batch_runs_user_id_idx" ON "dedup_batch_runs"("user_id");
CREATE INDEX IF NOT EXISTS "dedup_batch_runs_started_at_idx" ON "dedup_batch_runs"("started_at");
