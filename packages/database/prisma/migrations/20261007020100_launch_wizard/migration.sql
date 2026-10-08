-- Launch Wizard checklist (automation round 2)

CREATE TABLE "launch_checklists" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "offer_id" UUID,
  "tracking_link_id" UUID,
  "landing_page_id" UUID,
  "current_step" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "steps_data" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "launch_checklists_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "launch_checklists_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "launch_checklists_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "launch_checklists_tracking_link_id_fkey" FOREIGN KEY ("tracking_link_id") REFERENCES "tracking_links"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "launch_checklists_landing_page_id_fkey" FOREIGN KEY ("landing_page_id") REFERENCES "landing_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "launch_checklists_tenant_id_idx" ON "launch_checklists"("tenant_id");
CREATE INDEX "launch_checklists_offer_id_idx" ON "launch_checklists"("offer_id");
CREATE INDEX "launch_checklists_status_idx" ON "launch_checklists"("status");
