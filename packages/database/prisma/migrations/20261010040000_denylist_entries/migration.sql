-- 否定清单（批次5追加）：用户维护的"别碰名单"
CREATE TABLE "denylist_entries" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "type" VARCHAR(16) NOT NULL,
  "value" VARCHAR(256) NOT NULL,
  "reason" VARCHAR(512),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "denylist_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "denylist_entries_tenant_id_type_value_key" ON "denylist_entries"("tenant_id", "type", "value");
CREATE INDEX "denylist_entries_tenant_id_idx" ON "denylist_entries"("tenant_id");
ALTER TABLE "denylist_entries" ADD CONSTRAINT "denylist_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
