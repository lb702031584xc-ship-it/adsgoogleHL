-- Automation: URL-change targeting fields + cashback offer / rotation tables (additive only)
-- Altered tables: url_change_requests (3 nullable columns), clicks (1 boolean, existing rows default false)
-- New tables: cashback_offers, rotation_groups, rotation_group_items

-- AlterTable: url_change_requests — nullable additions only, safe for existing rows
ALTER TABLE "url_change_requests" ADD COLUMN "referral_url" TEXT;
ALTER TABLE "url_change_requests" ADD COLUMN "device_target" TEXT;
-- Plain UUID column with NO FK constraint (see schema.prisma comment on googleAccountId)
ALTER TABLE "url_change_requests" ADD COLUMN "google_account_id" UUID;

-- AlterTable: clicks — test-click marker; existing rows default false
ALTER TABLE "clicks" ADD COLUMN "is_test" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "cashback_offers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cashback_network" TEXT NOT NULL,
    "original_url" TEXT NOT NULL,
    "tracking_link_id" UUID,
    "adspower_profile_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "cashback_offers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cashback_offers_tenant_id_idx" ON "cashback_offers"("tenant_id");
CREATE INDEX "cashback_offers_tracking_link_id_idx" ON "cashback_offers"("tracking_link_id");
CREATE INDEX "cashback_offers_status_idx" ON "cashback_offers"("status");

-- CreateTable
CREATE TABLE "rotation_groups" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'round_robin',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rotation_groups_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "rotation_groups_tenant_id_idx" ON "rotation_groups"("tenant_id");

-- CreateTable
CREATE TABLE "rotation_group_items" (
    "id" UUID NOT NULL,
    "rotation_group_id" UUID NOT NULL,
    "cashback_offer_id" UUID NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rotation_group_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "rotation_group_items_rotation_group_id_idx" ON "rotation_group_items"("rotation_group_id");
CREATE INDEX "rotation_group_items_cashback_offer_id_idx" ON "rotation_group_items"("cashback_offer_id");

-- AddForeignKey
ALTER TABLE "cashback_offers" ADD CONSTRAINT "cashback_offers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashback_offers" ADD CONSTRAINT "cashback_offers_tracking_link_id_fkey" FOREIGN KEY ("tracking_link_id") REFERENCES "tracking_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rotation_groups" ADD CONSTRAINT "rotation_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rotation_group_items" ADD CONSTRAINT "rotation_group_items_rotation_group_id_fkey" FOREIGN KEY ("rotation_group_id") REFERENCES "rotation_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rotation_group_items" ADD CONSTRAINT "rotation_group_items_cashback_offer_id_fkey" FOREIGN KEY ("cashback_offer_id") REFERENCES "cashback_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
