-- CreateTable
CREATE TABLE "ux_feedback" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT,
    "category" TEXT NOT NULL,
    "page" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ux_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ux_feedback_account_id_created_at_idx" ON "ux_feedback"("account_id", "created_at");

-- AddForeignKey
ALTER TABLE "ux_feedback" ADD CONSTRAINT "ux_feedback_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
