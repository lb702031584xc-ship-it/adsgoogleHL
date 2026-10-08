/**
 * 功能 1 — 返利比例监控（rate-watch）worker。
 *
 * BullMQ worker. WIRING（由协调器完成，本文件不做注册 — queue-catalog.ts /
 * runtime.ts 由协调器统一维护）：
 *   - queue name: `cashback-rate-watch`
 *   - job name:   `cashback-rate-watch-check`
 *   - repeat:     `0 * * * *`（每小时）
 *
 * Job 输入：
 *   { prisma, triggeredBy: "schedule" | "manual", tenantId?: string, log? }
 * tenantId 省略时扫描全部租户；指定时只扫描该租户。
 *
 * 行为：对每个 status=active 的 CashbackOffer，用 SSRF-safe 抓取其返利页面
 * （rateUrl，默认 offer.originalUrl），解析返利比例并与 advertisedRate 比对；
 * mismatch → 写 Alert（24h 去重）。单个 offer 失败只记 unreachable/跳过，
 * 整个 job 永不 throw —— 坏链接不能卡住每小时的定时任务。
 */
import type { PrismaClient } from "@adlinklab/database";
import {
  checkAllActiveOffers,
  type RateWatchScanSummary,
} from "../services/cashback-rate-watch-service.js";

export interface CashbackRateWatchLog {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface CashbackRateWatchJobInput {
  prisma: PrismaClient;
  triggeredBy: "schedule" | "manual";
  /** When set, only this tenant is scanned; otherwise all tenants. */
  tenantId?: string;
  log?: CashbackRateWatchLog;
}

/**
 * BullMQ processor for the `cashback-rate-watch-check` job on the
 * `cashback-rate-watch` queue. Returns the scan summary for observability.
 * Never throws.
 */
export async function processCashbackRateWatchJob(
  input: CashbackRateWatchJobInput
): Promise<RateWatchScanSummary> {
  const log: CashbackRateWatchLog =
    input.log ??
    ({
      info: (msg: string, meta?: Record<string, unknown>) =>
        console.log(`[cashback-rate-watch] ${msg}`, meta ?? ""),
      error: (msg: string, meta?: Record<string, unknown>) =>
        console.error(`[cashback-rate-watch] ${msg}`, meta ?? ""),
    } as CashbackRateWatchLog);

  let summary: RateWatchScanSummary;
  try {
    summary = await checkAllActiveOffers(input.prisma, input.tenantId);
  } catch (error) {
    // Defensive: the service already swallows per-offer errors, but the
    // worker must never fail the repeatable job either.
    log.error("cashback-rate-watch scan aborted", {
      triggeredBy: input.triggeredBy,
      tenantId: input.tenantId ?? "all",
      error: error instanceof Error ? error.message : String(error),
    });
    summary = {
      checked: 0,
      ok: 0,
      mismatch: 0,
      unreachable: 0,
      alertsCreated: 0,
      skippedNoConfig: 0,
    };
  }

  log.info("cashback-rate-watch scan complete", {
    triggeredBy: input.triggeredBy,
    tenantId: input.tenantId ?? "all",
    ...summary,
  });
  return summary;
}
