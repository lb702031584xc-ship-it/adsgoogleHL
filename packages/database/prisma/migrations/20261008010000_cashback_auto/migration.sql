-- Cashback automation pack (2026-10-08): 5 features
-- 1. rate-watch: cashback_rate_checks
-- 2. terms-watch: cashback_terms_watches
-- 4. redirect-check: redirect_chain_checks
-- 5. rate-compare: cashback_compare_groups + cashback_rate_snapshots
-- (3. lp-cashback-score reuses existing tables, no new tables)

-- 1. rate-watch
CREATE TABLE "cashback_rate_checks" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "cashback_offer_id" UUID NOT NULL,
  "advertised_rate" TEXT NOT NULL,
  "detected_rate" TEXT,
  "rate_url" TEXT,
  "status" TEXT NOT NULL,
  "checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cashback_rate_checks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cashback_rate_checks_tenant_id_idx" ON "cashback_rate_checks"("tenant_id");
CREATE INDEX "cashback_rate_checks_cashback_offer_id_idx" ON "cashback_rate_checks"("cashback_offer_id");
CREATE INDEX "cashback_rate_checks_checked_at_idx" ON "cashback_rate_checks"("checked_at");
ALTER TABLE "cashback_rate_checks" ADD CONSTRAINT "cashback_rate_checks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cashback_rate_checks" ADD CONSTRAINT "cashback_rate_checks_cashback_offer_id_fkey" FOREIGN KEY ("cashback_offer_id") REFERENCES "cashback_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. terms-watch
CREATE TABLE "cashback_terms_watches" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "merchant_name" TEXT NOT NULL,
  "merchant_domain" TEXT NOT NULL,
  "terms_url" TEXT NOT NULL,
  "terms_hash" TEXT,
  "cashback_allowed" BOOLEAN,
  "last_checked" TIMESTAMPTZ(3),
  "status" TEXT NOT NULL DEFAULT 'ok',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cashback_terms_watches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cashback_terms_watches_tenant_id_idx" ON "cashback_terms_watches"("tenant_id");
ALTER TABLE "cashback_terms_watches" ADD CONSTRAINT "cashback_terms_watches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. redirect-check
CREATE TABLE "redirect_chain_checks" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "tracking_link_id" UUID NOT NULL,
  "hop_count" INTEGER NOT NULL,
  "hops" JSONB NOT NULL,
  "issues" JSONB NOT NULL,
  "checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL,
  CONSTRAINT "redirect_chain_checks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "redirect_chain_checks_tenant_id_tracking_link_id_checked_at_idx" ON "redirect_chain_checks"("tenant_id", "tracking_link_id", "checked_at");
ALTER TABLE "redirect_chain_checks" ADD CONSTRAINT "redirect_chain_checks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "redirect_chain_checks" ADD CONSTRAINT "redirect_chain_checks_tracking_link_id_fkey" FOREIGN KEY ("tracking_link_id") REFERENCES "tracking_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. rate-compare
CREATE TABLE "cashback_compare_groups" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "merchant_domain" TEXT NOT NULL,
  "portals" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cashback_compare_groups_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cashback_compare_groups_tenant_id_idx" ON "cashback_compare_groups"("tenant_id");
ALTER TABLE "cashback_compare_groups" ADD CONSTRAINT "cashback_compare_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "cashback_rate_snapshots" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "merchant_domain" TEXT NOT NULL,
  "portal" TEXT NOT NULL,
  "rate" TEXT,
  "url" TEXT,
  "checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cashback_rate_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cashback_rate_snapshots_tenant_id_merchant_domain_checked_at_idx" ON "cashback_rate_snapshots"("tenant_id", "merchant_domain", "checked_at" DESC);
ALTER TABLE "cashback_rate_snapshots" ADD CONSTRAINT "cashback_rate_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
