-- CreateTable
CREATE TABLE "instance_sync_keys" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_hint" TEXT NOT NULL,
    "instance_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "instance_sync_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_agent_map" (
    "id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "local_agent_id" TEXT NOT NULL,
    "cloud_agent_id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_agent_map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_user_map" (
    "id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "local_user_id" TEXT NOT NULL,
    "cloud_user_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_user_map_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "instance_sync_keys_key_hash_key" ON "instance_sync_keys"("key_hash");
CREATE INDEX "instance_sync_keys_account_id_idx" ON "instance_sync_keys"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_agent_map_instance_id_local_agent_id_key" ON "sync_agent_map"("instance_id", "local_agent_id");
CREATE UNIQUE INDEX "sync_agent_map_instance_id_agent_name_key" ON "sync_agent_map"("instance_id", "agent_name");
CREATE INDEX "sync_agent_map_cloud_agent_id_idx" ON "sync_agent_map"("cloud_agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_user_map_instance_id_local_user_id_key" ON "sync_user_map"("instance_id", "local_user_id");
CREATE UNIQUE INDEX "sync_user_map_instance_id_cloud_user_id_key" ON "sync_user_map"("instance_id", "cloud_user_id");
CREATE INDEX "sync_user_map_cloud_user_id_idx" ON "sync_user_map"("cloud_user_id");

-- AddForeignKey
ALTER TABLE "instance_sync_keys" ADD CONSTRAINT "instance_sync_keys_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_agent_map" ADD CONSTRAINT "sync_agent_map_cloud_agent_id_fkey" FOREIGN KEY ("cloud_agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_user_map" ADD CONSTRAINT "sync_user_map_cloud_user_id_fkey" FOREIGN KEY ("cloud_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
