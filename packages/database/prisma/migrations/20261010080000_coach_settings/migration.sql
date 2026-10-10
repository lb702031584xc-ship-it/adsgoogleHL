-- 教练模式设置（第十三批）
CREATE TABLE "coach_settings" (
  "tenant_id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "daily_budget_limit" DOUBLE PRECISION,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coach_settings_pkey" PRIMARY KEY ("tenant_id")
);
ALTER TABLE "coach_settings" ADD CONSTRAINT "coach_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
