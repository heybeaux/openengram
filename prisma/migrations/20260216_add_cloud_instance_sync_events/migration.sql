-- CreateTable
CREATE TABLE "cloud_instances" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "instance_name" TEXT,
    "last_sync_at" TIMESTAMP(3),
    "memory_count" INTEGER NOT NULL DEFAULT 0,
    "last_push_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cloud_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_events" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'push',
    "status" TEXT NOT NULL DEFAULT 'completed',
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "new_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cloud_instances_account_id_instance_id_key" ON "cloud_instances"("account_id", "instance_id");
CREATE INDEX "cloud_instances_account_id_idx" ON "cloud_instances"("account_id");
CREATE INDEX "sync_events_account_id_created_at_idx" ON "sync_events"("account_id", "created_at");
