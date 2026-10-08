-- Automation round 2: weekly report — aggregated weekly stats + AI narrative per tenant
CREATE TABLE "weekly_reports" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "week_start" TIMESTAMPTZ(3) NOT NULL,
  "week_end" TIMESTAMPTZ(3) NOT NULL,
  "data" JSONB NOT NULL,
  "ai_summary" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'GENERATED',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "weekly_reports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "weekly_reports_tenant_id_week_start_week_end_key" ON "weekly_reports"("tenant_id", "week_start", "week_end");
CREATE INDEX "weekly_reports_tenant_id_idx" ON "weekly_reports"("tenant_id");
