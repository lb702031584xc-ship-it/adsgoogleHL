/**
 * Feature 5 — 返利比价（rate-compare）worker.
 *
 * BullMQ processor. WIRING (done by the coordinator, NOT in this file):
 *   - queue name:      `cashback-rate-compare`
 *   - job name:        `cashback-rate-compare-check`
 *   - repeat:          `0 5 * * *` (daily at 05:00)
 * Register in queue-catalog.ts with:
 *   queueName: "cashback-rate-compare",
 *   processorModule: "cashback-rate-compare-worker.ts",
 *   processorExport: "processCashbackRateCompareJob",
 *
 * The daily job checks every compare group (all tenants, or a single
 * tenant when the job data carries `tenantId`): it fetches each portal's
 * rate (SSRF-safe), writes a snapshot row per portal, and raises an
 * "info"-severity suggestion Alert when a non-primary portal beats the
 * primary (portals[0]) by >= 1 percentage point (24h dedupe per group).
 *
 * Never throws: per-group failures are logged and skipped so one bad
 * portal cannot wedge the daily run.
 */
import type { PrismaClient } from "@adlinklab/database";
import {
  runAllGroups,
  type FetchPageFn,
} from "../services/cashback-rate-compare-service.js";

export interface CashbackRateCompareLog {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface CashbackRateCompareJobInput {
  prisma: PrismaClient;
  triggeredBy: "schedule" | "manual";
  /** When set, only this tenant's groups are checked; otherwise all tenants. */
  tenantId?: string;
  /** Injectable for tests. Defaults to the SSRF-safe fetchPageHtml. */
  fetchPage?: FetchPageFn;
  log?: CashbackRateCompareLog;
}

export interface CashbackRateCompareJobSummary {
  groups: number;
  checked: number;
  alertsCreated: number;
}

/**
 * BullMQ processor for the `cashback-rate-compare-check` job on the
 * `cashback-rate-compare` queue. Returns the check summary. Never throws.
 */
export async function processCashbackRateCompareJob(
  input: CashbackRateCompareJobInput
): Promise<CashbackRateCompareJobSummary> {
  const log: CashbackRateCompareLog =
    input.log ??
    ({
      info: (msg: string, meta?: Record<string, unknown>) =>
        console.log(`[cashback-rate-compare] ${msg}`, meta ?? ""),
      error: (msg: string, meta?: Record<string, unknown>) =>
        console.error(`[cashback-rate-compare] ${msg}`, meta ?? ""),
    } as CashbackRateCompareLog);

  let summary: CashbackRateCompareJobSummary;
  try {
    summary = await runAllGroups(input.prisma, {
      fetchPage: input.fetchPage,
      tenantId: input.tenantId,
      log,
    });
  } catch (error) {
    // Defensive: the service already swallows per-group errors, but the
    // worker must never fail the repeatable job either.
    log.error("cashback-rate-compare run aborted", {
      triggeredBy: input.triggeredBy,
      tenantId: input.tenantId ?? "all",
      error: error instanceof Error ? error.message : String(error),
    });
    summary = { groups: 0, checked: 0, alertsCreated: 0 };
  }

  log.info("cashback-rate-compare run complete", {
    triggeredBy: input.triggeredBy,
    tenantId: input.tenantId ?? "all",
    ...summary,
  });
  return summary;
}
