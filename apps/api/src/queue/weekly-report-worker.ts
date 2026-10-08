/**
 * Automation round 2 — weekly report worker.
 *
 * BullMQ worker. WIRING:
 *   - queue name: `weeklyReport` (QUEUE_NAMES.weeklyReport)
 *   - job name:   `weekly-report-generate`
 *   - repeat:     `0 8 * * 1` with tz America/New_York (Monday 8:00am NY)
 * Register in queue-catalog.ts with:
 *   queueName: QUEUE_NAMES.weeklyReport,
 *   processorModule: "weekly-report-worker.ts",
 *   processorExport: "processWeeklyReportJob",
 * and in runtime.ts (Worker + ensureWeeklyReportSchedule).
 *
 * The job generates one WeeklyReport per tenant for the previous full week
 * (Monday→Sunday, America/New_York). Per-tenant failures are logged and
 * skipped so one bad tenant cannot wedge the weekly run.
 */
import type { PrismaClient } from "@adlinklab/database";
import {
  generateWeeklyReport,
  getLastWeekRange,
} from "../services/weekly-report-service.js";

/** BullMQ repeatable job name. */
export const WEEKLY_REPORT_JOB_NAME = "weekly-report-generate";
/** Monday 08:00. */
export const WEEKLY_REPORT_REPEAT_PATTERN = "0 8 * * 1";
/** Cron fires in New York time. */
export const WEEKLY_REPORT_REPEAT_TZ = "America/New_York";

export interface WeeklyReportLog {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface WeeklyReportJobInput {
  prisma: PrismaClient;
  triggeredBy: "schedule" | "manual";
  /** When set, only this tenant is processed; otherwise all tenants. */
  tenantId?: string;
  /** Override the reporting window (manual runs); defaults to last week. */
  weekStart?: Date;
  weekEnd?: Date;
  log?: WeeklyReportLog;
}

export interface WeeklyReportJobSummary {
  reports: number;
  tenantIds: string[];
  failed: string[];
}

export async function processWeeklyReportJob(
  input: WeeklyReportJobInput,
): Promise<WeeklyReportJobSummary> {
  const log: WeeklyReportLog =
    input.log ??
    ({
      info: (msg: string, meta?: Record<string, unknown>) =>
        console.log(`[weekly-report] ${msg}`, meta ?? ""),
      error: (msg: string, meta?: Record<string, unknown>) =>
        console.error(`[weekly-report] ${msg}`, meta ?? ""),
    } as WeeklyReportLog);

  const summary: WeeklyReportJobSummary = {
    reports: 0,
    tenantIds: [],
    failed: [],
  };

  let tenantIds: string[];
  if (input.tenantId) {
    tenantIds = [input.tenantId];
  } else {
    const tenants = (await input.prisma.tenant.findMany({
      select: { id: true },
    })) as Array<{ id: string }>;
    tenantIds = tenants.map((t) => t.id);
  }

  const range =
    input.weekStart && input.weekEnd
      ? { weekStart: input.weekStart, weekEnd: input.weekEnd }
      : getLastWeekRange(new Date());

  for (const tenantId of tenantIds) {
    try {
      const report = await generateWeeklyReport(
        input.prisma,
        tenantId,
        range.weekStart,
        range.weekEnd,
      );
      summary.reports += 1;
      summary.tenantIds.push(tenantId);
      log.info("weekly report generated", {
        triggeredBy: input.triggeredBy,
        tenantId,
        reportId: report.id,
        weekStart: range.weekStart.toISOString(),
      });
    } catch (error) {
      summary.failed.push(tenantId);
      log.error("weekly report failed for tenant", {
        triggeredBy: input.triggeredBy,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  log.info("weekly-report run complete", {
    triggeredBy: input.triggeredBy,
    ...summary,
  });
  return summary;
}
