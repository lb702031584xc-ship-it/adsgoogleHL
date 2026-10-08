-- Automation Pack: dead link monitor, search term miner, payout watch, budget pacer, LP optimization queue

CREATE TABLE "link_health_checks" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "tracking_link_id" UUID NOT NULL,
  "checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status_code" INTEGER,
  "final_url" TEXT,
  "is_alive" BOOLEAN NOT NULL,
  "failure_reason" TEXT,
  "response_time_ms" INTEGER,
  CONSTRAINT "link_health_checks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "link_health_checks_tenant_id_tracking_link_id_checked_at_idx" ON "link_health_checks"("tenant_id", "tracking_link_id", "checked_at");

CREATE TYPE "SearchTermAction" AS ENUM ('ADD_NEGATIVE_EXACT', 'ADD_NEGATIVE_PHRASE', 'IGNORE');
CREATE TYPE "SearchTermSuggestionStatus" AS ENUM ('PENDING', 'APPLIED', 'DISMISSED');
CREATE TABLE "search_term_suggestions" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "search_term" TEXT NOT NULL,
  "campaign_name" TEXT,
  "match_type" TEXT,
  "suggested_action" "SearchTermAction" NOT NULL,
  "reason" TEXT,
  "status" "SearchTermSuggestionStatus" NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "search_term_suggestions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "search_term_suggestions_tenant_id_status_idx" ON "search_term_suggestions"("tenant_id", "status");

CREATE TABLE "payout_watches" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "offer_id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "last_payout" DOUBLE PRECISION,
  "last_checked_at" TIMESTAMPTZ(3),
  "change_history" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "payout_watches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payout_watches_tenant_id_offer_id_key" UNIQUE ("tenant_id", "offer_id")
);
CREATE INDEX "payout_watches_tenant_id_idx" ON "payout_watches"("tenant_id");

CREATE TABLE "budget_rules" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "google_account_id" UUID NOT NULL,
  "campaign_name" TEXT NOT NULL,
  "campaign_id" TEXT,
  "target_roas" DOUBLE PRECISION NOT NULL,
  "min_daily_budget" DOUBLE PRECISION NOT NULL,
  "max_daily_budget" DOUBLE PRECISION NOT NULL,
  "increase_pct" DOUBLE PRECISION NOT NULL DEFAULT 20,
  "decrease_pct" DOUBLE PRECISION NOT NULL DEFAULT 20,
  "check_interval_days" INTEGER NOT NULL DEFAULT 7,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "last_evaluated_at" TIMESTAMPTZ(3),
  "last_action" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "budget_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "budget_rules_tenant_id_enabled_idx" ON "budget_rules"("tenant_id", "enabled");

CREATE TYPE "OptimizationPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "OptimizationTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE');
CREATE TABLE "landing_page_optimization_tasks" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "landing_page_id" UUID NOT NULL,
  "score" INTEGER NOT NULL,
  "issues" JSONB NOT NULL DEFAULT '[]',
  "priority" "OptimizationPriority" NOT NULL,
  "status" "OptimizationTaskStatus" NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "landing_page_optimization_tasks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "landing_page_optimization_tasks_tenant_id_status_priority_idx" ON "landing_page_optimization_tasks"("tenant_id", "status", "priority");
