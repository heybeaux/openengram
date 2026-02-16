-- CreateTable
CREATE TABLE "cloud_links" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "cloud_api_key" TEXT NOT NULL,
    "cloud_account_id" TEXT,
    "cloud_email" TEXT,
    "cloud_plan" TEXT,
    "last_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cloud_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cloud_links_account_id_key" ON "cloud_links"("account_id");

-- AddForeignKey
ALTER TABLE "cloud_links" ADD CONSTRAINT "cloud_links_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
