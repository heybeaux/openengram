-- Webhook Subscriptions (v2 event bus)
CREATE TABLE IF NOT EXISTS "webhook_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[] NOT NULL DEFAULT '{}',
    "secret" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "backoff_ms" INTEGER NOT NULL DEFAULT 1000,
    "filter_layers" TEXT[] NOT NULL DEFAULT '{}',
    "filter_tags" TEXT[] NOT NULL DEFAULT '{}',
    "filter_min_importance" DOUBLE PRECISION,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "webhook_subscriptions_user_id_idx" ON "webhook_subscriptions"("user_id");

-- Webhook Delivery Logs (v2)
CREATE TABLE IF NOT EXISTS "webhook_delivery_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subscription_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status_code" INTEGER,
    "error" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "delivered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_delivery_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "webhook_delivery_logs_sub_delivered_idx" ON "webhook_delivery_logs"("subscription_id", "delivered_at");
