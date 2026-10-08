-- Phase 2 Traffic Intelligence (additive only; no changes to existing tables' behavior)
-- New enum: TrafficEventType
-- New table: traffic_events (append-only traffic event journal)
-- Alters (nullable-only additions): clicks (traffic_source, traffic_medium, match_type)

CREATE TYPE "TrafficEventType" AS ENUM ('AD_CLICK', 'LANDING_PAGE_VIEW', 'AFFILIATE_CLICK', 'MERCHANT_VISIT', 'CONVERSION', 'COMMISSION');

CREATE TABLE "traffic_events" (
  "id" UUID NOT NULL PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "parent_event_id" UUID,
  "event_type" "TrafficEventType" NOT NULL,
  "click_id" UUID,
  "conversion_id" UUID,
  "tracking_link_id" UUID,
  "timestamp" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" TEXT,
  "destination" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(3)
);
CREATE INDEX "traffic_events_tenant_id_idx" ON "traffic_events"("tenant_id");
CREATE INDEX "traffic_events_click_id_idx" ON "traffic_events"("click_id");
CREATE INDEX "traffic_events_conversion_id_idx" ON "traffic_events"("conversion_id");
CREATE INDEX "traffic_events_parent_event_id_idx" ON "traffic_events"("parent_event_id");
CREATE INDEX "traffic_events_event_type_idx" ON "traffic_events"("event_type");
CREATE INDEX "traffic_events_timestamp_idx" ON "traffic_events"("timestamp");
ALTER TABLE "traffic_events" ADD CONSTRAINT "traffic_events_parent_event_id_fkey"
  FOREIGN KEY ("parent_event_id") REFERENCES "traffic_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Clicks: nullable-only additions (Phase 2 Traffic Intelligence)
-- Only real observed values are ever written here; NULL when unknown — never invented.
ALTER TABLE "clicks" ADD COLUMN "traffic_source" TEXT;
ALTER TABLE "clicks" ADD COLUMN "traffic_medium" TEXT;
ALTER TABLE "clicks" ADD COLUMN "match_type" TEXT;
