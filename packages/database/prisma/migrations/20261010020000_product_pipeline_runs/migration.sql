-- 选品流水线运行记录（第五批）
CREATE TABLE "product_pipeline_runs" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "name" TEXT,
  "item_count" INTEGER NOT NULL,
  "options" JSONB NOT NULL,
  "results" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "product_pipeline_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_pipeline_runs_tenant_id_idx" ON "product_pipeline_runs"("tenant_id");

ALTER TABLE "product_pipeline_runs" ADD CONSTRAINT "product_pipeline_runs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
