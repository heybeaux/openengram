-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "MemoryLayer" AS ENUM ('IDENTITY', 'PROJECT', 'SESSION', 'TASK');

-- CreateEnum
CREATE TYPE "MemorySource" AS ENUM ('EXPLICIT_STATEMENT', 'AGENT_OBSERVATION', 'CORRECTION', 'PATTERN_DETECTED', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ImportanceHint" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ChainLinkType" AS ENUM ('LED_TO', 'SUPPORTS', 'CONTRADICTS', 'UPDATES', 'RELATED');

-- CreateEnum
CREATE TYPE "ConsolidationType" AS ENUM ('POST_SESSION', 'NIGHTLY', 'PERIODIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "ConsolidationStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookEvent" AS ENUM ('PROACTIVE_SURFACE', 'CONTRADICTION_DETECTED', 'PATTERN_DETECTED', 'CONSOLIDATION_COMPLETE');

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "api_key_hash" TEXT NOT NULL,
    "api_key_hint" TEXT NOT NULL,
    "memories_limit" INTEGER,
    "requests_per_day" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "external_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT,
    "external_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "consolidated" BOOLEAN NOT NULL DEFAULT false,
    "consolidated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memories" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT,
    "session_id" TEXT,
    "raw" TEXT NOT NULL,
    "layer" "MemoryLayer" NOT NULL,
    "source" "MemorySource" NOT NULL DEFAULT 'EXPLICIT_STATEMENT',
    "importance_hint" "ImportanceHint",
    "importance_score" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "session_position" INTEGER,
    "embedding_id" TEXT,
    "embedding_model" TEXT,
    "retrieval_count" INTEGER NOT NULL DEFAULT 0,
    "last_retrieved_at" TIMESTAMP(3),
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "consolidated" BOOLEAN NOT NULL DEFAULT false,
    "consolidated_at" TIMESTAMP(3),
    "superseded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_extractions" (
    "id" TEXT NOT NULL,
    "memory_id" TEXT NOT NULL,
    "who" TEXT,
    "what" TEXT,
    "when" TIMESTAMP(3),
    "where_ctx" TEXT,
    "why" TEXT,
    "how" TEXT,
    "topics" TEXT[],
    "raw_json" JSONB,
    "extracted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "model" TEXT,

    CONSTRAINT "memory_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_entities" (
    "id" TEXT NOT NULL,
    "memory_id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,

    CONSTRAINT "memory_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_chain_links" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "link_type" "ChainLinkType" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_chain_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "memory_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "was_used" BOOLEAN NOT NULL DEFAULT false,
    "was_helpful" BOOLEAN,
    "correction" TEXT,
    "query_context" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consolidation_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "ConsolidationType" NOT NULL,
    "status" "ConsolidationStatus" NOT NULL DEFAULT 'PENDING',
    "session_id" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "memories_processed" INTEGER,
    "patterns_detected" INTEGER,
    "links_created" INTEGER,
    "memories_merged" INTEGER,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consolidation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" "WebhookEvent"[],
    "secret" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_success" TIMESTAMP(3),
    "last_failure" TIMESTAMP(3),
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "webhook_id" TEXT NOT NULL,
    "event" "WebhookEvent" NOT NULL,
    "payload" JSONB NOT NULL,
    "status_code" INTEGER,
    "response_ms" INTEGER,
    "error" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resource_id" TEXT,
    "details" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agents_api_key_hash_key" ON "agents"("api_key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "users_agent_id_external_id_key" ON "users"("agent_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_user_id_external_id_key" ON "projects"("user_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "memories_embedding_id_key" ON "memories"("embedding_id");

-- CreateIndex
CREATE INDEX "memories_user_id_layer_idx" ON "memories"("user_id", "layer");

-- CreateIndex
CREATE INDEX "memories_user_id_created_at_idx" ON "memories"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "memories_project_id_idx" ON "memories"("project_id");

-- CreateIndex
CREATE INDEX "memories_session_id_idx" ON "memories"("session_id");

-- CreateIndex
CREATE INDEX "memories_deleted_at_idx" ON "memories"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "memory_extractions_memory_id_key" ON "memory_extractions"("memory_id");

-- CreateIndex
CREATE UNIQUE INDEX "entities_user_id_normalized_name_type_key" ON "entities"("user_id", "normalized_name", "type");

-- CreateIndex
CREATE UNIQUE INDEX "memory_entities_memory_id_entity_id_key" ON "memory_entities"("memory_id", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "memory_chain_links_source_id_target_id_link_type_key" ON "memory_chain_links"("source_id", "target_id", "link_type");

-- CreateIndex
CREATE INDEX "consolidation_jobs_user_id_type_status_idx" ON "consolidation_jobs"("user_id", "type", "status");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhook_id_created_at_idx" ON "webhook_deliveries"("webhook_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_agent_id_created_at_idx" ON "audit_logs"("agent_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "memories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_extractions" ADD CONSTRAINT "memory_extractions_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_entities" ADD CONSTRAINT "memory_entities_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_entities" ADD CONSTRAINT "memory_entities_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_chain_links" ADD CONSTRAINT "memory_chain_links_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_chain_links" ADD CONSTRAINT "memory_chain_links_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
