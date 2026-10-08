-- AI offer analysis: admin settings + persisted tenant-scoped analyses (ADD ONLY)

CREATE TABLE "ai_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "ai_analyses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "input_kind" TEXT NOT NULL,
    "input_ref" TEXT NOT NULL,
    "merchant" TEXT,
    "network" TEXT,
    "payout" DOUBLE PRECISION,
    "payout_currency" TEXT,
    "estimated_cpc" DOUBLE PRECISION,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_analyses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_analyses_tenant_id_idx" ON "ai_analyses"("tenant_id");
