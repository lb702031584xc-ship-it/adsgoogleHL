-- P1 traffic monitoring: alert rules + alerts (additive only; no changes to existing tables)

CREATE TABLE "alert_rules" (
  "id" UUID NOT NULL PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "threshold_pct" DOUBLE PRECISION NOT NULL,
  "window_hours" INTEGER NOT NULL DEFAULT 24,
  "baseline_hours" INTEGER NOT NULL DEFAULT 168,
  "min_clicks" INTEGER NOT NULL DEFAULT 50,
  "auto_pause" BOOLEAN NOT NULL DEFAULT false,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "alert_rules_tenant_id_idx" ON "alert_rules"("tenant_id");

CREATE TABLE "alerts" (
  "id" UUID NOT NULL PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "rule_id" UUID,
  "tracking_link_id" UUID,
  "metric" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "data" JSONB,
  "status" TEXT NOT NULL DEFAULT 'open',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "alerts_tenant_id_idx" ON "alerts"("tenant_id");
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "alert_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_tracking_link_id_fkey"
  FOREIGN KEY ("tracking_link_id") REFERENCES "tracking_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;
