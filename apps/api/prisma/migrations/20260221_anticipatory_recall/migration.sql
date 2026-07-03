-- Anticipatory Recall Engine (ARE)
-- Adds event tracking and learned weights for anticipatory recall strategies.

-- AnticipatoryEvent: tracks each anticipatory result for feedback learning
CREATE TABLE "anticipatory_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "recall_id" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "memory_id" TEXT,
    "salience" DOUBLE PRECISION NOT NULL,
    "was_useful" BOOLEAN,
    "latency_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anticipatory_events_pkey" PRIMARY KEY ("id")
);

-- AnticipatoryWeight: per-user per-strategy learned weights
CREATE TABLE "anticipatory_weights" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "successful" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "anticipatory_weights_pkey" PRIMARY KEY ("id")
);

-- Indexes for AnticipatoryEvent
CREATE INDEX "anticipatory_events_user_id_created_at_idx" ON "anticipatory_events"("user_id", "created_at");
CREATE INDEX "anticipatory_events_strategy_was_useful_idx" ON "anticipatory_events"("strategy", "was_useful");
CREATE INDEX "anticipatory_events_recall_id_idx" ON "anticipatory_events"("recall_id");

-- Unique constraint for AnticipatoryWeight
CREATE UNIQUE INDEX "anticipatory_weights_user_id_strategy_key" ON "anticipatory_weights"("user_id", "strategy");
