-- 手动录入累计花费（第十五批）
CREATE TABLE "manual_spend" (
  "tenant_id" UUID NOT NULL,
  "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "manual_spend_pkey" PRIMARY KEY ("tenant_id")
);
ALTER TABLE "manual_spend" ADD CONSTRAINT "manual_spend_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
