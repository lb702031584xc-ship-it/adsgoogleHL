/**
 * 功能 2 — 商家返利条款监控 (terms-watch) worker.
 *
 * WIRING（由协调方在 queue-catalog.ts / runtime.ts 中接入，本文件不注册）:
 * - queue 名称: `cashback-terms-watch`
 * - job 名称: `cashback-terms-watch-check`
 * - repeat: `0 2 * * *`（每天 02:00 一次）
 * 接入方式：import { processCashbackTermsWatchJob } from "./cashback-terms-watch-worker.js"，
 * 在 runtime processors 中加 `cashbackTermsWatch` 入口，并在 ensure*Schedule() 中按
 * 上述 repeat pattern 注册 repeatable（参考 payout-watch 的 worker-owned schedule 模式）。
 *
 * NOTE: 本文件故意不 import queue-catalog.ts / runtime.ts —— 队列注册归协调方所有。
 */
import type { PrismaClient } from "@adlinklab/database";
import {
  checkAllTermsWatches,
  type TermsWatchCheckSummary,
  type TermsWatchLog,
} from "../services/cashback-terms-watch-service.js";

/** BullMQ job name for the terms-watch scan. */
export const TERMS_WATCH_JOB_NAME = "cashback-terms-watch-check";

/** BullMQ repeat pattern for the daily schedule (02:00 local daily). */
export const TERMS_WATCH_REPEAT_PATTERN = "0 2 * * *";

export interface CashbackTermsWatchJobInput {
  prisma: PrismaClient;
  triggeredBy: "schedule" | "manual";
  tenantId?: string;
  log?: TermsWatchLog;
}

/**
 * Worker 入口（BullMQ 按 daily repeatable schedule 调用）。
 * 委托给 service；service 内部逐 watch 隔离错误且本函数顶层再兜底，
 * 因此永不 throw —— 单轮扫描的任何失败都只记日志。
 */
export async function processCashbackTermsWatchJob(
  input: CashbackTermsWatchJobInput
): Promise<TermsWatchCheckSummary> {
  const log: TermsWatchLog =
    input.log ??
    ({
      info: (msg: string, meta?: Record<string, unknown>) =>
        console.log(`[terms-watch] ${msg}`, meta ?? ""),
      error: (msg: string, meta?: Record<string, unknown>) =>
        console.error(`[terms-watch] ${msg}`, meta ?? ""),
    } as TermsWatchLog);

  try {
    log.info("terms-watch job received", {
      triggeredBy: input.triggeredBy,
      tenantId: input.tenantId ?? "all",
    });
    const summary = await checkAllTermsWatches(
      input.prisma,
      input.tenantId,
      { log }
    );
    log.info("terms-watch job complete", {
      triggeredBy: input.triggeredBy,
      ...summary,
    });
    return summary;
  } catch (error) {
    // 永不 throw：兜底返回空 summary。
    log.error("terms-watch job failed", {
      triggeredBy: input.triggeredBy,
      tenantId: input.tenantId ?? "all",
      error: error instanceof Error ? error.message : String(error),
    });
    return { checked: 0, changed: 0, blocked: 0, criticalAlerts: 0, pausedLinks: 0 };
  }
}
