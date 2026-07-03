-- Add content hash to memories for dedup
ALTER TABLE "memories" ADD COLUMN "content_hash" TEXT;
CREATE INDEX "memories_content_hash_idx" ON "memories"("content_hash");

-- Sync ID mapping table: maps local ↔ cloud memory IDs
CREATE TABLE "sync_id_map" (
    "id" TEXT NOT NULL,
    "local_memory_id" TEXT NOT NULL,
    "cloud_memory_id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "content_hash" TEXT,
    "synced_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "sync_id_map_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sync_id_map_instance_id_local_memory_id_key" ON "sync_id_map"("instance_id", "local_memory_id");
CREATE UNIQUE INDEX "sync_id_map_instance_id_cloud_memory_id_key" ON "sync_id_map"("instance_id", "cloud_memory_id");
CREATE INDEX "sync_id_map_content_hash_idx" ON "sync_id_map"("content_hash");
