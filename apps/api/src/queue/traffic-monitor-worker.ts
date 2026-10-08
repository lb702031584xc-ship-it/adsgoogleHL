import type { PrismaClient } from "@adlinklab/database";
import { runMonitorScan } from "../monitoring/monitor-service.js";

/**
 * P1 — traffic monitor worker entry (BullMQ Worker calls this on the
 * hourly repeatable schedule). The scan is idempotent by construction
 * (alert dedupe on rule+link+metric within 24h), so it does not go through
 * the SyncJob machinery used by mutation workflows.
 */
export async function processTrafficMonitorJob(input: {
  prisma: PrismaClient;
  triggeredBy: "schedule" | "manual";
  tenantId?: string;
  log?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
}): Promise<{ checked: number; alertsCreated: number }> {
  const log =
    input.log ??
    ({
      info: (msg: string, meta?: Record<string, unknown>) =>
        console.log(`[traffic-monitor] ${msg}`, meta ?? ""),
    } as NonNullable<typeof input.log>);
  const result = await runMonitorScan(input.prisma, {
    tenantId: input.tenantId,
    triggeredBy: input.triggeredBy,
  });
  log.info("scan complete", {
    triggeredBy: input.triggeredBy,
    tenantId: input.tenantId ?? "all",
    ...result,
  });
  return result;
}
