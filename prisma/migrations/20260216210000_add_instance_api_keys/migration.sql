-- CreateTable
CREATE TABLE "instance_api_keys" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_hint" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY['sync', 'read']::TEXT[],
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "instance_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "instance_api_keys_key_hash_key" ON "instance_api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "instance_api_keys_account_id_idx" ON "instance_api_keys"("account_id");

-- AddForeignKey
ALTER TABLE "instance_api_keys" ADD CONSTRAINT "instance_api_keys_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
