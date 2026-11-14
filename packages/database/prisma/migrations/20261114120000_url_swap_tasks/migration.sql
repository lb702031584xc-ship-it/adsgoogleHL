-- AutoAds-style Google Ads Scripts 换链任务

CREATE TABLE "url_swap_tasks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "network" TEXT NOT NULL DEFAULT 'default',
    "campaign_name" TEXT NOT NULL,
    "links" JSONB NOT NULL,
    "landing_domain" TEXT NOT NULL,
    "proxy_type" TEXT NOT NULL DEFAULT 'none',
    "geo_verify_enabled" BOOLEAN NOT NULL DEFAULT false,
    "proxy_extract_url" TEXT NOT NULL DEFAULT '',
    "backup_proxy_extract_url" TEXT NOT NULL DEFAULT '',
    "target_regions" JSONB NOT NULL DEFAULT '[]',
    "ua_strategy" TEXT NOT NULL DEFAULT 'random',
    "ua_platform" TEXT NOT NULL DEFAULT 'desktop',
    "referers" JSONB NOT NULL DEFAULT '[]',
    "exec_interval_minutes" INTEGER NOT NULL DEFAULT 10,
    "rotate_interval_minutes" INTEGER NOT NULL DEFAULT 30,
    "rotation_enabled" BOOLEAN NOT NULL DEFAULT true,
    "current_link_index" INTEGER NOT NULL DEFAULT 0,
    "last_rotated_at" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "link_change_count" INTEGER NOT NULL DEFAULT 0,
    "last_exec_at" TIMESTAMPTZ(3),
    "last_exec_status" TEXT,
    "last_exec_message" TEXT,
    "last_proxy_line" TEXT,
    "active_template" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "url_swap_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "url_swap_tasks_tenant_id_campaign_name_key" ON "url_swap_tasks"("tenant_id", "campaign_name");
CREATE INDEX "url_swap_tasks_tenant_id_idx" ON "url_swap_tasks"("tenant_id");
CREATE INDEX "url_swap_tasks_tenant_id_status_idx" ON "url_swap_tasks"("tenant_id", "status");
ALTER TABLE "url_swap_tasks" ADD CONSTRAINT "url_swap_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "url_swap_auth" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "api_auth_code" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "url_swap_auth_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "url_swap_auth_tenant_id_key" ON "url_swap_auth"("tenant_id");
ALTER TABLE "url_swap_auth" ADD CONSTRAINT "url_swap_auth_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "url_swap_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "campaign_name" TEXT NOT NULL,
    "link_url" TEXT NOT NULL,
    "link_remark" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "proxy_line" TEXT,
    "referer" TEXT,
    "user_agent" TEXT,
    "final_domain" TEXT,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "url_swap_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "url_swap_logs_tenant_id_idx" ON "url_swap_logs"("tenant_id");
CREATE INDEX "url_swap_logs_task_id_created_at_idx" ON "url_swap_logs"("task_id", "created_at");
ALTER TABLE "url_swap_logs" ADD CONSTRAINT "url_swap_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "url_swap_logs" ADD CONSTRAINT "url_swap_logs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "url_swap_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
