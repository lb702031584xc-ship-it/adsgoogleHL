-- Lander Intel trio (additive only; no changes to existing tables)
-- New tables: lander_analyses, competitor_watches, competitor_changes, lander_templates

-- CreateTable
CREATE TABLE "lander_analyses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "overall_score" DOUBLE PRECISION NOT NULL,
    "scores" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "suggestions" JSONB NOT NULL,
    "analyzed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "lander_analyses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "lander_analyses_tenant_id_idx" ON "lander_analyses"("tenant_id");

-- CreateTable
CREATE TABLE "competitor_watches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "check_interval" INTEGER NOT NULL DEFAULT 3600,
    "last_hash" TEXT,
    "last_checked_at" TIMESTAMPTZ(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "competitor_watches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "competitor_watches_tenant_id_idx" ON "competitor_watches"("tenant_id");

-- CreateTable
CREATE TABLE "competitor_changes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "watch_id" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diff_summary" JSONB NOT NULL,

    CONSTRAINT "competitor_changes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "competitor_changes_tenant_id_idx" ON "competitor_changes"("tenant_id");
CREATE INDEX "competitor_changes_watch_id_idx" ON "competitor_changes"("watch_id");

-- CreateTable
CREATE TABLE "lander_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "html_template" TEXT NOT NULL,
    "thumbnail_url" TEXT,
    "is_built_in" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "lander_templates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "lander_templates_tenant_id_idx" ON "lander_templates"("tenant_id");

-- AddForeignKey
ALTER TABLE "lander_analyses" ADD CONSTRAINT "lander_analyses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_watches" ADD CONSTRAINT "competitor_watches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_changes" ADD CONSTRAINT "competitor_changes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_changes" ADD CONSTRAINT "competitor_changes_watch_id_fkey" FOREIGN KEY ("watch_id") REFERENCES "competitor_watches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lander Intel: template-created landing pages store rendered HTML (additive, nullable)
ALTER TABLE "landing_pages" ADD COLUMN "html_content" TEXT;
