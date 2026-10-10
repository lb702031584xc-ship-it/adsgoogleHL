-- 组合测试（第九批）：一次测 5-10 个品
CREATE TABLE "combo_test_runs" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "html_content" TEXT,
  "items" JSONB NOT NULL,
  "test_days" INTEGER NOT NULL DEFAULT 3,
  "target_clicks" INTEGER NOT NULL DEFAULT 200,
  "status" VARCHAR(16) NOT NULL DEFAULT 'running',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "combo_test_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "combo_test_runs_tenant_id_idx" ON "combo_test_runs"("tenant_id");
ALTER TABLE "combo_test_runs" ADD CONSTRAINT "combo_test_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
