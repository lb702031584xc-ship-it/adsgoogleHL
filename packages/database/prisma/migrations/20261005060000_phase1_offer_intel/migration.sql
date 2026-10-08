-- Phase 1 Offer Intelligence (additive only; no changes to existing tables' behavior)
-- New: affiliate_networks, merchants, offer_policies, policy_evidence,
--      offer_risk_scores, profit_models
-- Alters (nullable-only additions): offers, audit_logs

CREATE TABLE "affiliate_networks" (
  "id" UUID NOT NULL PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "website" TEXT,
  "api_configured" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(3)
);
CREATE INDEX "affiliate_networks_tenant_id_idx" ON "affiliate_networks"("tenant_id");
CREATE INDEX "affiliate_networks_status_idx" ON "affiliate_networks"("status");

CREATE TABLE "merchants" (
  "id" UUID NOT NULL PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "domain" TEXT,
  "network_id" UUID,
  "risk_score" DOUBLE PRECISION,
  "risk_level" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(3)
);
CREATE INDEX "merchants_tenant_id_idx" ON "merchants"("tenant_id");
CREATE INDEX "merchants_network_id_idx" ON "merchants"("network_id");
CREATE INDEX "merchants_status_idx" ON "merchants"("status");
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_network_id_fkey"
  FOREIGN KEY ("network_id") REFERENCES "affiliate_networks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "offer_policies" (
  "id" UUID NOT NULL PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "offer_id" UUID NOT NULL,
  "source_url" TEXT,
  "source_snapshot_url" TEXT,
  "retrieved_at" TIMESTAMPTZ(3),
  "raw_terms" TEXT,
  "rules" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(3)
);
CREATE INDEX "offer_policies_tenant_id_idx" ON "offer_policies"("tenant_id");
CREATE INDEX "offer_policies_offer_id_idx" ON "offer_policies"("offer_id");
ALTER TABLE "offer_policies" ADD CONSTRAINT "offer_policies_offer_id_fkey"
  FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "policy_evidence" (
  "id" UUID NOT NULL PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "offer_policy_id" UUID NOT NULL,
  "rule" TEXT NOT NULL,
  "matched_text" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "source_excerpt" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(3)
);
CREATE INDEX "policy_evidence_tenant_id_idx" ON "policy_evidence"("tenant_id");
CREATE INDEX "policy_evidence_offer_policy_id_idx" ON "policy_evidence"("offer_policy_id");
CREATE INDEX "policy_evidence_rule_idx" ON "policy_evidence"("rule");
ALTER TABLE "policy_evidence" ADD CONSTRAINT "policy_evidence_offer_policy_id_fkey"
  FOREIGN KEY ("offer_policy_id") REFERENCES "offer_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "offer_risk_scores" (
  "id" UUID NOT NULL PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "offer_id" UUID NOT NULL,
  "overall_score" DOUBLE PRECISION NOT NULL,
  "policy_score" DOUBLE PRECISION,
  "profit_score" DOUBLE PRECISION,
  "merchant_score" DOUBLE PRECISION,
  "tracking_score" DOUBLE PRECISION,
  "decision" TEXT NOT NULL,
  "evaluated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(3)
);
CREATE INDEX "offer_risk_scores_tenant_id_idx" ON "offer_risk_scores"("tenant_id");
CREATE INDEX "offer_risk_scores_offer_id_idx" ON "offer_risk_scores"("offer_id");
CREATE INDEX "offer_risk_scores_decision_idx" ON "offer_risk_scores"("decision");
ALTER TABLE "offer_risk_scores" ADD CONSTRAINT "offer_risk_scores_offer_id_fkey"
  FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "profit_models" (
  "id" UUID NOT NULL PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "offer_id" UUID NOT NULL,
  "commission" DECIMAL(19, 4),
  "commission_type" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "expected_cvr" DOUBLE PRECISION,
  "approval_rate" DOUBLE PRECISION,
  "attribution_rate" DOUBLE PRECISION,
  "refund_rate" DOUBLE PRECISION,
  "scenarios" JSONB NOT NULL DEFAULT '{}',
  "break_even_cpc" DOUBLE PRECISION,
  "recommended_max_cpc" DOUBLE PRECISION,
  "data_quality" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(3)
);
CREATE INDEX "profit_models_tenant_id_idx" ON "profit_models"("tenant_id");
CREATE INDEX "profit_models_offer_id_idx" ON "profit_models"("offer_id");
ALTER TABLE "profit_models" ADD CONSTRAINT "profit_models_offer_id_fkey"
  FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Offers: nullable-only additions (Phase 1 Offer Intelligence)
ALTER TABLE "offers" ADD COLUMN "merchant_id" UUID;
ALTER TABLE "offers" ADD COLUMN "category" TEXT;
ALTER TABLE "offers" ADD COLUMN "geo_allow" TEXT[];
ALTER TABLE "offers" ADD COLUMN "cookie_days" INTEGER;
ALTER TABLE "offers" ADD COLUMN "commission_value" DECIMAL(19, 4);
ALTER TABLE "offers" ADD COLUMN "commission_type" TEXT;
CREATE INDEX "offers_merchant_id_idx" ON "offers"("merchant_id");
ALTER TABLE "offers" ADD CONSTRAINT "offers_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AuditLog: nullable-only additions (§25)
ALTER TABLE "audit_logs" ADD COLUMN "reason" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "ip" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "user_agent" TEXT;
