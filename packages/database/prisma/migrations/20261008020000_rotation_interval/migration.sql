-- Add configurable rotation interval to rotation groups (default 1 hour)
ALTER TABLE "rotation_groups" ADD COLUMN "rotation_interval_ms" INTEGER NOT NULL DEFAULT 3600000;
