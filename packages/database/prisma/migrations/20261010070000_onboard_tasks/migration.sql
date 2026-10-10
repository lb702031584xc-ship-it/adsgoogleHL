-- 新手任务（第十二批）："7 天跑起来"
CREATE TABLE "onboard_tasks" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "day" INTEGER NOT NULL,
  "task_key" VARCHAR(64) NOT NULL,
  "deep_link" VARCHAR(256),
  "done_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "onboard_tasks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "onboard_tasks_tenant_id_task_key_key" ON "onboard_tasks"("tenant_id", "task_key");
CREATE INDEX "onboard_tasks_tenant_id_idx" ON "onboard_tasks"("tenant_id");
ALTER TABLE "onboard_tasks" ADD CONSTRAINT "onboard_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
