-- Offer 最终链接指标抓取 + 推荐指数（第三批）
CREATE TABLE "offer_metrics" (
  "id" UUID NOT NULL,
  "offer_id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "metrics" JSONB NOT NULL,
  "score" INTEGER,
  "grade" TEXT,
  "fetched_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "offer_metrics_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "offer_metrics_offer_id_key" ON "offer_metrics"("offer_id");
CREATE INDEX "offer_metrics_tenant_id_idx" ON "offer_metrics"("tenant_id");

ALTER TABLE "offer_metrics" ADD CONSTRAINT "offer_metrics_offer_id_fkey"
  FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offer_metrics" ADD CONSTRAINT "offer_metrics_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
