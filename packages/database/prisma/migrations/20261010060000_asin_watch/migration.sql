-- ASIN 跟踪 + 每日快照（第十批）
CREATE TABLE "asin_watches" (
  "id" TEXT NOT NULL,
  "tenant_id" UUID NOT NULL,
  "asin" VARCHAR(32) NOT NULL,
  "title" VARCHAR(500),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "asin_watches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "asin_watches_tenant_id_asin_key" ON "asin_watches"("tenant_id", "asin");
CREATE INDEX "asin_watches_tenant_id_idx" ON "asin_watches"("tenant_id");
ALTER TABLE "asin_watches" ADD CONSTRAINT "asin_watches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "asin_snapshots" (
  "id" TEXT NOT NULL,
  "tenant_id" UUID NOT NULL,
  "asin" VARCHAR(32) NOT NULL,
  "captured_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "review_count" INTEGER,
  "rating" DOUBLE PRECISION,
  "price" DOUBLE PRECISION,
  "raw_json" JSONB,
  CONSTRAINT "asin_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "asin_snapshots_tenant_id_asin_captured_at_idx" ON "asin_snapshots"("tenant_id", "asin", "captured_at");
ALTER TABLE "asin_snapshots" ADD CONSTRAINT "asin_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
