-- HEY-182: Task Completion Tracking for Identity Framework
-- DO NOT execute directly — apply via prisma migrate deploy

CREATE TABLE "task_completions" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "delegated_to" TEXT NOT NULL,
    "delegated_by" TEXT NOT NULL,
    "task_description" TEXT NOT NULL,
    "domain" TEXT,
    "outcome" TEXT NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "quality_signals" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "embedding_text" TEXT,
    "embedding" vector,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_completions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_completions_delegated_to_idx" ON "task_completions"("delegated_to");
CREATE INDEX "task_completions_delegated_by_idx" ON "task_completions"("delegated_by");
CREATE INDEX "task_completions_task_id_idx" ON "task_completions"("task_id");
CREATE INDEX "task_completions_domain_idx" ON "task_completions"("domain");
CREATE INDEX "task_completions_created_at_idx" ON "task_completions"("created_at");
