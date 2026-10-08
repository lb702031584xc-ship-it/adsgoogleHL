/**
 * Feature 4 — 跳转链检测（redirect-check）worker.
 *
 * BullMQ worker. WIRING (done by the parent orchestrator, NOT in this file):
 *   - queue name: `cashback-redirect-check`
 *   - job name:   `cashback-redirect-check-check`
 *   - repeat:     `0 4 * * *` (daily)
 * Register in queue-catalog.ts with:
 *   queueName: "cashback-redirect-check",
 *   processorModule: "cashback-redirect-check-worker.ts",
 *   processorExport: "processCashbackRedirectCheckJob",
 *
 * The job scans every ACTIVE tracking link (all tenants, or a single tenant
 * when job data carries `tenantId`), follows each link's redirect chain with
 * the SSRF-safe fetcher, writes a RedirectChainCheck row per link, and
 * raises a `redirect_chain_issue` warning alert (24h dedupe per link) when
 * the chain is flagged. Per-link failures never throw — they are logged and
 * skipped so a bad link cannot wedge the daily run.
 */
import type { PrismaClient } from "@adlinklab/database";
import {
  checkAllRedirectChains,
  type RedirectCheckScanOpts,
  type RedirectCheckScanSummary,
} from "../services/cashback-redirect-check-service.js";

export interface CashbackRedirectCheckLog {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface CashbackRedirectCheckJobInput {
  prisma: PrismaClient;
  triggeredBy: "schedule" | "manual";
  /** When set, only this tenant is scanned; otherwise all tenants. */
  tenantId?: string;
  checkOpts?: RedirectCheckScanOpts;
  log?: CashbackRedirectCheckLog;
}

function emptySummary(): RedirectCheckScanSummary {
  return {
    checked: 0,
    clean: 0,
    warning: 0,
    error: 0,
    alertsCreated: 0,
    skippedNoUrl: 0,
  };
}

/**
 * BullMQ processor for the `cashback-redirect-check-check` job on the
 * `cashback-redirect-check` queue. Returns the scan summary for
 * observability. Never throws.
 */
export async function processCashbackRedirectCheckJob(
  input: CashbackRedirectCheckJobInput
): Promise<RedirectCheckScanSummary> {
  const log: CashbackRedirectCheckLog =
    input.log ??
    ({
      info: (msg: string, meta?: Record<string, unknown>) =>
        console.log(`[redirect-check] ${msg}`, meta ?? ""),
      error: (msg: string, meta?: Record<string, unknown>) =>
        console.error(`[redirect-check] ${msg}`, meta ?? ""),
    } as CashbackRedirectCheckLog);

  let summary: RedirectCheckScanSummary;
  try {
    summary = await checkAllRedirectChains(
      input.prisma,
      input.tenantId,
      input.checkOpts
    );
  } catch (error) {
    // Defensive: the service already swallows per-link errors, but the
    // worker must never fail the repeatable job either.
    log.error("redirect-check scan aborted", {
      triggeredBy: input.triggeredBy,
      tenantId: input.tenantId ?? "all",
      error: error instanceof Error ? error.message : String(error),
    });
    summary = emptySummary();
  }

  log.info("redirect-check scan complete", {
    triggeredBy: input.triggeredBy,
    tenantId: input.tenantId ?? "all",
    ...summary,
  });
  return summary;
}
