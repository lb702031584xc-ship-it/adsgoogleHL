/**
 * Automation pack ③ — payout (commission) change monitoring worker.
 *
 * Queue name: `payout-watch`
 * Job name: `payout-watch-check`
 * Repeat: daily (BullMQ `repeat: { pattern: "0 0 * * *" }`, i.e. once per
 * 24h — worker-owned repeatable schedule, same pattern as the hourly
 * worker-owned schedules in runtime.ts).
 *
 * NOTE: this worker is intentionally not wired into queue-catalog.ts or
 * runtime.ts by this file — queue registration is owned by the coordinator.
 * Import `processPayoutWatchJob` and add a `payoutWatch` entry in the
 * runtime processors + an `ensurePayoutWatchSchedule()` repeatable entry
 * (daily pattern above) to enable it.
 */
import type { PrismaClient } from "@adlinklab/database";
import {
  checkAllWatches,
  type PayoutWatchCheckSummary,
  type PayoutWatchLog,
} from "../services/payout-watch-service.js";

/** BullMQ job name for the payout-watch scan. */
export const PAYOUT_WATCH_JOB_NAME = "payout-watch-check";

/** BullMQ repeat pattern for the daily schedule (once per 24h). */
export const PAYOUT_WATCH_REPEAT_PATTERN = "0 0 * * *";

export interface PayoutWatchJobInput {
  prisma: PrismaClient;
  triggeredBy: "schedule" | "manual";
  tenantId?: string;
  log?: PayoutWatchLog;
}

/**
 * Worker entry (BullMQ calls this on the daily repeatable schedule).
 * Delegates to the service; per-watch failures are logged inside the
 * service and never thrown, so one bad watch cannot wedge the daily run.
 */
export async function processPayoutWatchJob(
  input: PayoutWatchJobInput
): Promise<PayoutWatchCheckSummary> {
  const log: PayoutWatchLog =
    input.log ??
    ({
      info: (msg: string, meta?: Record<string, unknown>) =>
        console.log(`[payout-watch] ${msg}`, meta ?? ""),
      error: (msg: string, meta?: Record<string, unknown>) =>
        console.error(`[payout-watch] ${msg}`, meta ?? ""),
    } as PayoutWatchLog);

  log.info("payout-watch job received", {
    triggeredBy: input.triggeredBy,
    tenantId: input.tenantId ?? "all",
  });
  const summary = await checkAllWatches(input.prisma, input.tenantId, {
    log,
  });
  log.info("payout-watch job complete", {
    triggeredBy: input.triggeredBy,
    ...summary,
  });
  return summary;
}
