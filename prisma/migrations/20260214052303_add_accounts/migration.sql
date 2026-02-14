/*
  Warnings:

  - The primary key for the `webhook_delivery_logs` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `webhook_subscriptions` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the `fog_index_snapshots` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'STARTER', 'PRO', 'SCALE');

-- CreateEnum
CREATE TYPE "EnsembleJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EnsembleReembedMode" AS ENUM ('INCREMENTAL', 'FULL');

-- CreateEnum
CREATE TYPE "EnsembleVersionStatus" AS ENUM ('CREATING', 'ACTIVE', 'DEPRECATED', 'DELETED');

-- CreateEnum
CREATE TYPE "EnsembleModelStatus" AS ENUM ('ACTIVE', 'SHADOW', 'DEPRECATED', 'DISABLED');

-- DropIndex
DROP INDEX "idx_memories_analytics";

-- DropIndex
DROP INDEX "idx_memories_session_created";

-- DropIndex
DROP INDEX "idx_memories_user_importance";

-- DropIndex
DROP INDEX "idx_memories_user_layer_created";

-- DropIndex
DROP INDEX "memories_embedding_idx";

-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "account_id" TEXT;

-- AlterTable
ALTER TABLE "dedup_configs" ADD COLUMN     "auto_resolve_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.92,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "dream_cycle_reports" ALTER COLUMN "started_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "completed_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "dream_cycle_runs" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "started_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "ended_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "memories" ADD COLUMN     "cluster_id" TEXT,
ALTER COLUMN "last_dream_cycle_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "monitoring_snapshots" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "snapshot_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "agent_session_key" TEXT;

-- AlterTable
ALTER TABLE "webhook_delivery_logs" DROP CONSTRAINT "webhook_delivery_logs_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "webhook_delivery_logs_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "webhook_subscriptions" DROP CONSTRAINT "webhook_subscriptions_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "events" DROP DEFAULT,
ADD CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id");

-- DropTable
DROP TABLE "fog_index_snapshots";

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT,
    "stripe_customer_id" TEXT,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "plan_expires_at" TIMESTAMP(3),
    "memories_used" INTEGER NOT NULL DEFAULT 0,
    "api_calls_today" INTEGER NOT NULL DEFAULT 0,
    "api_calls_reset_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ensemble_reembed_jobs" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "status" "EnsembleJobStatus" NOT NULL DEFAULT 'PENDING',
    "mode" "EnsembleReembedMode" NOT NULL,
    "models" TEXT[],
    "total_memories" INTEGER NOT NULL DEFAULT 0,
    "processed_memories" INTEGER NOT NULL DEFAULT 0,
    "failed_memories" INTEGER NOT NULL DEFAULT 0,
    "skipped_memories" INTEGER NOT NULL DEFAULT 0,
    "metrics" JSONB,
    "avg_drift" DOUBLE PRECISION,
    "max_drift" DOUBLE PRECISION,
    "drift_flags" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "triggered_by" TEXT NOT NULL DEFAULT 'cron',
    "triggered_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ensemble_reembed_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ensemble_reembed_checkpoints" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_processed_id" TEXT NOT NULL,
    "progress" JSONB NOT NULL,
    "completed_models" TEXT[],
    "metrics" JSONB,

    CONSTRAINT "ensemble_reembed_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ensemble_reembed_events" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scope" JSONB NOT NULL,
    "triggered_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "error" TEXT,

    CONSTRAINT "ensemble_reembed_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ensemble_embedding_versions" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "status" "EnsembleVersionStatus" NOT NULL DEFAULT 'CREATING',
    "memories_embedded" INTEGER NOT NULL DEFAULT 0,
    "previous_version" TEXT,
    "modelVersions" JSONB NOT NULL,

    CONSTRAINT "ensemble_embedding_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ensemble_model_configs" (
    "id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "status" "EnsembleModelStatus" NOT NULL DEFAULT 'SHADOW',
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "promoted_at" TIMESTAMP(3),
    "deprecated_at" TIMESTAMP(3),
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "query_type_weights" JSONB,
    "quality_metrics" JSONB,
    "promotion_thresholds" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ensemble_model_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ensemble_ab_test_results" (
    "id" TEXT NOT NULL,
    "test_id" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "query_id" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ensemble_ab_test_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drift_snapshots" (
    "id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "avg_drift" DOUBLE PRECISION NOT NULL,
    "max_drift" DOUBLE PRECISION NOT NULL,
    "sample_count" INTEGER NOT NULL,
    "alert_level" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drift_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_clusters" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "member_count" INTEGER NOT NULL DEFAULT 0,
    "centroid_embedding" vector,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_clusters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_stripe_customer_id_key" ON "accounts"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "ensemble_reembed_jobs_job_id_key" ON "ensemble_reembed_jobs"("job_id");

-- CreateIndex
CREATE INDEX "ensemble_reembed_jobs_status_idx" ON "ensemble_reembed_jobs"("status");

-- CreateIndex
CREATE INDEX "ensemble_reembed_jobs_started_at_idx" ON "ensemble_reembed_jobs"("started_at");

-- CreateIndex
CREATE INDEX "ensemble_reembed_jobs_triggered_by_idx" ON "ensemble_reembed_jobs"("triggered_by");

-- CreateIndex
CREATE UNIQUE INDEX "ensemble_reembed_checkpoints_job_id_key" ON "ensemble_reembed_checkpoints"("job_id");

-- CreateIndex
CREATE INDEX "ensemble_reembed_checkpoints_job_id_idx" ON "ensemble_reembed_checkpoints"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "ensemble_reembed_events_event_id_key" ON "ensemble_reembed_events"("event_id");

-- CreateIndex
CREATE INDEX "ensemble_reembed_events_status_idx" ON "ensemble_reembed_events"("status");

-- CreateIndex
CREATE INDEX "ensemble_reembed_events_priority_idx" ON "ensemble_reembed_events"("priority");

-- CreateIndex
CREATE INDEX "ensemble_reembed_events_created_at_idx" ON "ensemble_reembed_events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ensemble_embedding_versions_version_id_key" ON "ensemble_embedding_versions"("version_id");

-- CreateIndex
CREATE INDEX "ensemble_embedding_versions_status_idx" ON "ensemble_embedding_versions"("status");

-- CreateIndex
CREATE INDEX "ensemble_embedding_versions_created_at_idx" ON "ensemble_embedding_versions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ensemble_model_configs_model_id_key" ON "ensemble_model_configs"("model_id");

-- CreateIndex
CREATE INDEX "ensemble_model_configs_status_idx" ON "ensemble_model_configs"("status");

-- CreateIndex
CREATE INDEX "ensemble_ab_test_results_test_id_idx" ON "ensemble_ab_test_results"("test_id");

-- CreateIndex
CREATE INDEX "ensemble_ab_test_results_timestamp_idx" ON "ensemble_ab_test_results"("timestamp");

-- CreateIndex
CREATE INDEX "drift_snapshots_model_id_created_at_idx" ON "drift_snapshots"("model_id", "created_at");

-- CreateIndex
CREATE INDEX "drift_snapshots_alert_level_idx" ON "drift_snapshots"("alert_level");

-- CreateIndex
CREATE INDEX "memories_cluster_id_idx" ON "memories"("cluster_id");

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "memory_clusters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "idx_dream_cycle_reports_user_created" RENAME TO "dream_cycle_reports_user_id_created_at_idx";

-- RenameIndex
ALTER INDEX "idx_dream_cycle_runs_status" RENAME TO "dream_cycle_runs_status_idx";

-- RenameIndex
ALTER INDEX "idx_monitoring_snapshots_snapshot_at" RENAME TO "monitoring_snapshots_snapshot_at_idx";

-- RenameIndex
ALTER INDEX "webhook_delivery_logs_sub_delivered_idx" RENAME TO "webhook_delivery_logs_subscription_id_delivered_at_idx";
