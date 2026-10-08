-- Amazon 自动选品：存储每次发现任务的结果
CREATE TABLE "amazon_discoveries" (
  "id" UUID NOT NULL PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "run_id" UUID NOT NULL,
  "criteria" JSONB NOT NULL,
  "products" JSONB NOT NULL,
  "total_found" INTEGER NOT NULL DEFAULT 0,
  "total_kept" INTEGER NOT NULL DEFAULT 0,
  "errors" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "amazon_discoveries_tenant_id_idx" ON "amazon_discoveries"("tenant_id");
CREATE INDEX "amazon_discoveries_run_id_idx" ON "amazon_discoveries"("run_id");
