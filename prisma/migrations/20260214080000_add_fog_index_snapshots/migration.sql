-- CreateTable
CREATE TABLE IF NOT EXISTS "fog_index_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "score" DOUBLE PRECISION NOT NULL,
    "tier" TEXT NOT NULL,
    "components" JSONB,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fog_index_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "fog_index_snapshots_computed_at_idx" ON "fog_index_snapshots"("computed_at");
