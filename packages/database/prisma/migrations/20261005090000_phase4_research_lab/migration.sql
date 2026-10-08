-- Phase 4 Research Lab (additive only; no changes to existing tables' behavior)
-- New tables: research_tests, research_responses, cloaking_findings
-- Relation-only additions on tenants/offers require no DDL (back-references)

-- CreateTable
CREATE TABLE "research_tests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "target_url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "variants" JSONB NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "research_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_responses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "research_test_id" UUID NOT NULL,
    "variant_name" TEXT NOT NULL,
    "http_status" INTEGER,
    "final_url" TEXT,
    "redirect_chain" JSONB NOT NULL DEFAULT '[]',
    "headers" JSONB NOT NULL DEFAULT '{}',
    "html_hash" TEXT,
    "content_hash" TEXT,
    "text_excerpt" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "links_count" INTEGER,
    "scripts_count" INTEGER,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "research_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cloaking_findings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "research_test_id" UUID NOT NULL,
    "offer_id" UUID,
    "differential_score" DOUBLE PRECISION NOT NULL,
    "band" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "ai_summary" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "cloaking_findings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "research_tests" ADD CONSTRAINT "research_tests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "research_responses" ADD CONSTRAINT "research_responses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "research_responses" ADD CONSTRAINT "research_responses_research_test_id_fkey" FOREIGN KEY ("research_test_id") REFERENCES "research_tests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cloaking_findings" ADD CONSTRAINT "cloaking_findings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cloaking_findings" ADD CONSTRAINT "cloaking_findings_research_test_id_fkey" FOREIGN KEY ("research_test_id") REFERENCES "research_tests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cloaking_findings" ADD CONSTRAINT "cloaking_findings_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- CreateIndex
CREATE INDEX "research_tests_tenant_id_idx" ON "research_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "research_tests_status_idx" ON "research_tests"("status");

-- CreateIndex
CREATE INDEX "research_responses_tenant_id_idx" ON "research_responses"("tenant_id");

-- CreateIndex
CREATE INDEX "research_responses_research_test_id_idx" ON "research_responses"("research_test_id");

-- CreateIndex
CREATE INDEX "cloaking_findings_tenant_id_idx" ON "cloaking_findings"("tenant_id");

-- CreateIndex
CREATE INDEX "cloaking_findings_research_test_id_idx" ON "cloaking_findings"("research_test_id");

-- CreateIndex
CREATE INDEX "cloaking_findings_offer_id_idx" ON "cloaking_findings"("offer_id");
