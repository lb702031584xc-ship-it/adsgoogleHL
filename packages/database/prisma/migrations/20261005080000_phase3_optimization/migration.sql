-- Phase 3 Optimization (additive only; no changes to existing tables' behavior)
-- New enum: ExperimentStatus
-- New tables: experiments, kill_switch_configs, kill_switch_events
-- Relation-only additions on offers/tenants require no DDL (back-references)

-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('DRAFT', 'RUNNING', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "experiments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ExperimentStatus" NOT NULL DEFAULT 'DRAFT',
    "variant_a" JSONB NOT NULL,
    "variant_b" JSONB NOT NULL,
    "traffic_split_a" INTEGER NOT NULL DEFAULT 50,
    "split_seed" TEXT,
    "metrics_a" JSONB,
    "metrics_b" JSONB,
    "winner" TEXT,
    "confidence" DOUBLE PRECISION,
    "precondition_check" JSONB,
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "experiments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kill_switch_configs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "max_spend" DECIMAL(12,2),
    "min_expected_profit" DECIMAL(12,2),
    "min_cvr" DOUBLE PRECISION,
    "max_policy_risk" INTEGER,
    "pause_on_merchant_terminated" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "kill_switch_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kill_switch_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "triggered_by" TEXT NOT NULL,
    "condition_snapshot" JSONB NOT NULL,
    "action_taken" TEXT NOT NULL,
    "links_paused" INTEGER NOT NULL DEFAULT 0,
    "auto_execute" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kill_switch_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "experiments_tenant_id_idx" ON "experiments"("tenant_id");

-- CreateIndex
CREATE INDEX "experiments_offer_id_idx" ON "experiments"("offer_id");

-- CreateIndex
CREATE INDEX "kill_switch_configs_tenant_id_idx" ON "kill_switch_configs"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "kill_switch_configs_offer_id_key" ON "kill_switch_configs"("offer_id");

-- CreateIndex
CREATE INDEX "kill_switch_events_tenant_id_idx" ON "kill_switch_events"("tenant_id");

-- CreateIndex
CREATE INDEX "kill_switch_events_offer_id_idx" ON "kill_switch_events"("offer_id");

-- AddForeignKey
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kill_switch_configs" ADD CONSTRAINT "kill_switch_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kill_switch_configs" ADD CONSTRAINT "kill_switch_configs_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kill_switch_events" ADD CONSTRAINT "kill_switch_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kill_switch_events" ADD CONSTRAINT "kill_switch_events_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
