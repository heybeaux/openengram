-- CreateTable
CREATE TABLE "awareness_cycle_runs" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "phase" TEXT NOT NULL DEFAULT 'starting',
    "instance_id" TEXT NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_time" TIMESTAMP(3),
    "insights_generated" INTEGER NOT NULL DEFAULT 0,
    "observations" INTEGER NOT NULL DEFAULT 0,
    "patterns" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "awareness_cycle_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "awareness_cycle_runs_status_idx" ON "awareness_cycle_runs"("status");

-- CreateIndex
CREATE INDEX "awareness_cycle_runs_start_time_idx" ON "awareness_cycle_runs"("start_time" DESC);
