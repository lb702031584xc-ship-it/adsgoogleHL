/**
 * Network API framework — scheduled offer-pull worker (2026-10-07).
 *
 * Queue name: `networkPull`
 * Job name: `network-pull-daily`
 * Repeat: daily at 03:00 America/New_York
 *   (BullMQ `repeat: { pattern: "0 3 * * *", tz: "America/New_York" }`,
 *   worker-owned repeatable schedule, same pattern as the other
 *   worker-owned schedules in runtime.ts).
 *
 * Scans all ACTIVE networks with an encrypted credential (apiKeyRef != null)
 * and pulls their offer catalogs. Per-network failures are recorded in
 * network_offer_pulls / affiliate_networks.pullStatus and never thrown, so
 * one bad network cannot wedge the daily run.
 */
import type { PrismaClient } from "@adlinklab/database";
import {
  pullAllConfiguredNetworks,
  type NetworkPullLog,
  type NetworkPullSummary,
} from "../services/network-pull-service.js";

/** BullMQ job name for the daily network-pull scan. */
export const NETWORK_PULL_JOB_NAME = "network-pull-daily";

/** BullMQ repeat pattern — 03:00 America/New_York daily. */
export const NETWORK_PULL_REPEAT_PATTERN = "0 3 * * *";
export const NETWORK_PULL_REPEAT_TZ = "America/New_York";

export interface NetworkPullJobInput {
  prisma: PrismaClient;
  triggeredBy: "schedule" | "manual";
  tenantId?: string;
  log?: NetworkPullLog;
}

/**
 * Worker entry (BullMQ calls this on the daily repeatable schedule).
 * Delegates to the pull service; per-network failures never throw.
 */
export async function processNetworkPullJob(
  input: NetworkPullJobInput
): Promise<{ networks: number; succeeded: number; failed: number }> {
  const log: NetworkPullLog =
    input.log ??
    ({
      info: (msg: string, meta?: Record<string, unknown>) =>
        console.log(`[network-pull-worker] ${msg}`, meta ?? ""),
      error: (msg: string, meta?: Record<string, unknown>) =>
        console.error(`[network-pull-worker] ${msg}`, meta ?? ""),
    } as NetworkPullLog);

  log.info("network-pull job received", {
    triggeredBy: input.triggeredBy,
    tenantId: input.tenantId ?? "all",
  });
  const results: NetworkPullSummary[] = await pullAllConfiguredNetworks(
    { prisma: input.prisma, log },
    { tenantId: input.tenantId }
  );
  const summary = {
    networks: results.length,
    succeeded: results.filter((r) => r.status === "SUCCESS").length,
    failed: results.filter((r) => r.status === "FAILED").length,
  };
  log.info("network-pull job complete", {
    triggeredBy: input.triggeredBy,
    ...summary,
  });
  return summary;
}
