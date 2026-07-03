-- CreateTable
CREATE TABLE "eval_runs" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recall_score" DOUBLE PRECISION NOT NULL,
    "recall_total" INTEGER NOT NULL,
    "recall_passed" INTEGER NOT NULL,
    "latency_p50_ms" INTEGER NOT NULL,
    "latency_p95_ms" INTEGER,
    "context_grade" TEXT,
    "details" JSONB,
    "triggered_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eval_runs_pkey" PRIMARY KEY ("id")
);
