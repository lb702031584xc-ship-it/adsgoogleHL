-- LP AI rewriter: AI-generated before/after rewrite drafts for landing pages.
-- The user reviews each draft in the optimization-queue UI and confirms
-- before it is applied to the LandingPage (apply writes the original HTML
-- back into rewritten_content.originalBackup first).

CREATE TABLE "landing_page_rewrites" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "landing_page_id" UUID NOT NULL,
  "original_score" INTEGER NOT NULL,
  "issues" JSONB NOT NULL DEFAULT '[]',
  "rewritten_content" JSONB NOT NULL,
  "new_score" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "landing_page_rewrites_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "landing_page_rewrites_tenant_id_landing_page_id_idx" ON "landing_page_rewrites"("tenant_id", "landing_page_id");
