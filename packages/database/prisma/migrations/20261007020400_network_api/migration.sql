-- Network API framework (2026-10-07): adapter credentials + pull audit + raw offer staging

-- Extend affiliate_networks with adapter kind, encrypted credential ref, base URL override, pull state
ALTER TABLE "affiliate_networks"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'impact',
  ADD COLUMN "api_key_ref" TEXT,
  ADD COLUMN "api_base_url" TEXT,
  ADD COLUMN "last_pull_at" TIMESTAMPTZ(3),
  ADD COLUMN "pull_status" TEXT NOT NULL DEFAULT 'NEVER',
  ADD COLUMN "pull_error" TEXT;

-- One audit row per offer-pull run
CREATE TABLE "network_offer_pulls" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "network_id" UUID NOT NULL,
  "pulled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "offer_count" INTEGER NOT NULL DEFAULT 0,
  "new_count" INTEGER NOT NULL DEFAULT 0,
  "updated_count" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL,
  "error" TEXT,
  CONSTRAINT "network_offer_pulls_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "network_offer_pulls_tenant_id_network_id_pulled_at_idx"
  ON "network_offer_pulls"("tenant_id", "network_id", "pulled_at");
ALTER TABLE "network_offer_pulls"
  ADD CONSTRAINT "network_offer_pulls_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "network_offer_pulls"
  ADD CONSTRAINT "network_offer_pulls_network_id_fkey"
  FOREIGN KEY ("network_id") REFERENCES "affiliate_networks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Raw offer staging (deduped by tenant + network + external ID)
CREATE TABLE "network_offers" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "network_id" UUID NOT NULL,
  "external_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "payout" DECIMAL(19, 4),
  "currency" TEXT DEFAULT 'USD',
  "terms_text" TEXT,
  "raw_data" JSONB NOT NULL,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "network_offers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "network_offers_tenant_id_network_id_external_id_key"
    UNIQUE ("tenant_id", "network_id", "external_id")
);
CREATE INDEX "network_offers_tenant_id_network_id_idx"
  ON "network_offers"("tenant_id", "network_id");
ALTER TABLE "network_offers"
  ADD CONSTRAINT "network_offers_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "network_offers"
  ADD CONSTRAINT "network_offers_network_id_fkey"
  FOREIGN KEY ("network_id") REFERENCES "affiliate_networks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
