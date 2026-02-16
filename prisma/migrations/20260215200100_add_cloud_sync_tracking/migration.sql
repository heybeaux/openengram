-- AlterTable: Add cloud sync tracking to memories
ALTER TABLE "memories" ADD COLUMN "cloud_synced_at" TIMESTAMP(3);

-- AlterTable: Add auto_sync to cloud_links
ALTER TABLE "cloud_links" ADD COLUMN "auto_sync" BOOLEAN NOT NULL DEFAULT false;
