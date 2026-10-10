import type { SyncJobType } from "@adlinklab/shared";

/**
 * Phase 8.3.1 — BullMQ job.data contracts.
 * Payload lives on the queue (Prisma SyncJob has no payload column).
 * Worker (8.3.2) must still verify tenantId against DB authority.
 */
export interface UrlChangeJobData {
  type: "urlChange";
  tenantId: string;
  requestId: string;
  idempotencyKey: string;
  /** Matches SyncJob.jobId / BullMQ jobId */
  jobId: string;
  syncJobId?: string;
}

export interface ConversionUploadJobData {
  type: "conversionUpload";
  tenantId: string;
  conversionId: string;
  idempotencyKey: string;
  jobId: string;
  syncJobId?: string;
  customerId?: string;
  googleAccountId?: string;
}

export type AdLinkLabJobData = UrlChangeJobData | ConversionUploadJobData;

/**
 * Phase 3 — kill-switch scan job. No SyncJob backing: the evaluation is
 * idempotent by construction (pause only flips non-paused links; alert
 * creation is deduped 24h), so it skips the SyncJob machinery.
 */
export interface KillSwitchJobData {
  type: "killSwitch";
  triggeredBy: "schedule" | "manual";
  /** When set, restrict the scan to one tenant (manual runs). */
  tenantId?: string;
}

/**
 * P1 — traffic monitor scan job. No SyncJob backing: the scan is idempotent
 * by construction (alert dedupe), so it skips the SyncJob machinery.
 */
export interface TrafficMonitorJobData {
  type: "trafficMonitor";
  triggeredBy: "schedule" | "manual";
  /** When set, restrict the scan to one tenant (manual runs). */
  tenantId?: string;
}

/**
 * Lander Intel ② — competitor watch scan job. No SyncJob backing: the scan
 * is idempotent by construction (SHA-256 hash compare; alert dedupe 24h),
 * so it skips the SyncJob machinery — same pattern as trafficMonitor.
 */
export interface CompetitorWatchJobData {
  type: "competitorWatch";
  triggeredBy: "schedule" | "manual";
  /** When set, restrict the scan to one tenant (manual runs). */
  tenantId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate inbound traffic-monitor job data (BullMQ payloads are untrusted). */
export function parseTrafficMonitorJobData(data: unknown): TrafficMonitorJobData {
  if (!isRecord(data) || data.type !== "trafficMonitor") {
    throw new Error("trafficMonitor job.data must be an object with type 'trafficMonitor'");
  }
  const triggeredBy = data.triggeredBy;
  if (triggeredBy !== "schedule" && triggeredBy !== "manual") {
    throw new Error("trafficMonitor job.data.triggeredBy must be 'schedule' or 'manual'");
  }
  const tenantId = data.tenantId;
  if (tenantId !== undefined && (typeof tenantId !== "string" || !tenantId.trim())) {
    throw new Error("trafficMonitor job.data.tenantId must be a non-empty string when set");
  }
  return {
    type: "trafficMonitor",
    triggeredBy,
    ...(typeof tenantId === "string" ? { tenantId: tenantId.trim() } : {}),
  };
}

/** Validate inbound kill-switch job data (BullMQ payloads are untrusted). */
export function parseKillSwitchJobData(data: unknown): KillSwitchJobData {
  if (!isRecord(data) || data.type !== "killSwitch") {
    throw new Error("killSwitch job.data must be an object with type 'killSwitch'");
  }
  const triggeredBy = data.triggeredBy;
  if (triggeredBy !== "schedule" && triggeredBy !== "manual") {
    throw new Error("killSwitch job.data.triggeredBy must be 'schedule' or 'manual'");
  }
  const tenantId = data.tenantId;
  if (tenantId !== undefined && (typeof tenantId !== "string" || !tenantId.trim())) {
    throw new Error("killSwitch job.data.tenantId must be a non-empty string when set");
  }
  return {
    type: "killSwitch",
    triggeredBy,
    ...(typeof tenantId === "string" ? { tenantId: tenantId.trim() } : {}),
  };
}

/** Validate inbound competitor-watch job data (BullMQ payloads are untrusted). */
export function parseCompetitorWatchJobData(
  data: unknown
): CompetitorWatchJobData {
  if (!isRecord(data) || data.type !== "competitorWatch") {
    throw new Error(
      "competitorWatch job.data must be an object with type 'competitorWatch'"
    );
  }
  const triggeredBy = data.triggeredBy;
  if (triggeredBy !== "schedule" && triggeredBy !== "manual") {
    throw new Error(
      "competitorWatch job.data.triggeredBy must be 'schedule' or 'manual'"
    );
  }
  const tenantId = data.tenantId;
  if (tenantId !== undefined && (typeof tenantId !== "string" || !tenantId.trim())) {
    throw new Error(
      "competitorWatch job.data.tenantId must be a non-empty string when set"
    );
  }
  return {
    type: "competitorWatch",
    triggeredBy,
    ...(typeof tenantId === "string" ? { tenantId: tenantId.trim() } : {}),
  };
}

export interface RotationJobData {
  type: "rotation";
  triggeredBy: "schedule" | "manual";
  /** When set, restrict the scan to one tenant (manual runs). */
  tenantId?: string;
}

/** Validate inbound rotation job data (BullMQ payloads are untrusted). */
export function parseRotationJobData(data: unknown): RotationJobData {
  if (!isRecord(data) || data.type !== "rotation") {
    throw new Error(
      "rotation job.data must be an object with type 'rotation'"
    );
  }
  const triggeredBy = data.triggeredBy;
  if (triggeredBy !== "schedule" && triggeredBy !== "manual") {
    throw new Error(
      "rotation job.data.triggeredBy must be 'schedule' or 'manual'"
    );
  }
  const tenantId = data.tenantId;
  if (tenantId !== undefined && (typeof tenantId !== "string" || !tenantId.trim())) {
    throw new Error(
      "rotation job.data.tenantId must be a non-empty string when set"
    );
  }
  return {
    type: "rotation",
    triggeredBy,
    ...(typeof tenantId === "string" ? { tenantId: tenantId.trim() } : {}),
  };
}

export type EnqueueableJobType = Extract<
  SyncJobType,
  "urlChange" | "conversionUpload"
>;

export interface EnqueueResult {
  enqueued: boolean;
  jobId: string;
  /** noop | duplicate | added | redis */
  reason: "noop" | "duplicate" | "added";
}

/** Automation pack: dead-link job data. */
export interface DeadLinkJobData {
  type: "deadLink";
  triggeredBy: "schedule" | "manual";
  tenantId?: string;
}

/** Validate inbound dead-link job data (BullMQ payloads are untrusted). */
export function parseDeadLinkJobData(data: unknown): DeadLinkJobData {
  if (!isRecord(data) || data.type !== "deadLink") {
    throw new Error("deadLink job.data must be an object with type 'deadLink'");
  }
  const triggeredBy = data.triggeredBy;
  if (triggeredBy !== "schedule" && triggeredBy !== "manual") {
    throw new Error("deadLink job.data.triggeredBy must be 'schedule' or 'manual'");
  }
  const tenantId = data.tenantId;
  if (tenantId !== undefined && (typeof tenantId !== "string" || !tenantId.trim())) {
    throw new Error("deadLink job.data.tenantId must be a non-empty string when set");
  }
  return {
    type: "deadLink",
    triggeredBy,
    ...(typeof tenantId === "string" ? { tenantId: tenantId.trim() } : {}),
  };
}

/** Automation pack: payout-watch job data. */
export interface PayoutWatchJobData {
  type: "payoutWatch";
  triggeredBy: "schedule" | "manual";
  tenantId?: string;
}

/** Validate inbound payout-watch job data (BullMQ payloads are untrusted). */
export function parsePayoutWatchJobData(data: unknown): PayoutWatchJobData {
  if (!isRecord(data) || data.type !== "payoutWatch") {
    throw new Error("payoutWatch job.data must be an object with type 'payoutWatch'");
  }
  const triggeredBy = data.triggeredBy;
  if (triggeredBy !== "schedule" && triggeredBy !== "manual") {
    throw new Error("payoutWatch job.data.triggeredBy must be 'schedule' or 'manual'");
  }
  const tenantId = data.tenantId;
  if (tenantId !== undefined && (typeof tenantId !== "string" || !tenantId.trim())) {
    throw new Error("payoutWatch job.data.tenantId must be a non-empty string when set");
  }
  return {
    type: "payoutWatch",
    triggeredBy,
    ...(typeof tenantId === "string" ? { tenantId: tenantId.trim() } : {}),
  };
}

/** Automation pack: budget-pacer job data. */
export interface BudgetPacerJobData {
  type: "budgetPacer";
  triggeredBy: "schedule" | "manual";
  tenantId?: string;
}

/** Validate inbound budget-pacer job data (BullMQ payloads are untrusted). */
export function parseBudgetPacerJobData(data: unknown): BudgetPacerJobData {
  if (!isRecord(data) || data.type !== "budgetPacer") {
    throw new Error("budgetPacer job.data must be an object with type 'budgetPacer'");
  }
  const triggeredBy = data.triggeredBy;
  if (triggeredBy !== "schedule" && triggeredBy !== "manual") {
    throw new Error("budgetPacer job.data.triggeredBy must be 'schedule' or 'manual'");
  }
  const tenantId = data.tenantId;
  if (tenantId !== undefined && (typeof tenantId !== "string" || !tenantId.trim())) {
    throw new Error("budgetPacer job.data.tenantId must be a non-empty string when set");
  }
  return {
    type: "budgetPacer",
    triggeredBy,
    ...(typeof tenantId === "string" ? { tenantId: tenantId.trim() } : {}),
  };
}

/** Network API framework: scheduled offer-pull job data. */
export interface NetworkPullJobData {
  type: "networkPull";
  triggeredBy: "schedule" | "manual";
  tenantId?: string;
}

/** Validate inbound network-pull job data (BullMQ payloads are untrusted). */
export function parseNetworkPullJobData(data: unknown): NetworkPullJobData {
  if (!isRecord(data) || data.type !== "networkPull") {
    throw new Error("networkPull job.data must be an object with type 'networkPull'");
  }
  const triggeredBy = data.triggeredBy;
  if (triggeredBy !== "schedule" && triggeredBy !== "manual") {
    throw new Error("networkPull job.data.triggeredBy must be 'schedule' or 'manual'");
  }
  const tenantId = data.tenantId;
  if (tenantId !== undefined && (typeof tenantId !== "string" || !tenantId.trim())) {
    throw new Error("networkPull job.data.tenantId must be a non-empty string when set");
  }
  return {
    type: "networkPull",
    triggeredBy,
    ...(typeof tenantId === "string" ? { tenantId: tenantId.trim() } : {}),
  };
}

/** Automation round 2: weekly-report job data. */
export interface WeeklyReportJobData {
  type: "weeklyReport";
  triggeredBy: "schedule" | "manual";
  tenantId?: string;
  /** ISO date strings; when set both must be valid (manual window override). */
  weekStart?: string;
  weekEnd?: string;
}

/** Validate inbound weekly-report job data (BullMQ payloads are untrusted). */
export function parseWeeklyReportJobData(data: unknown): WeeklyReportJobData {
  if (!isRecord(data) || data.type !== "weeklyReport") {
    throw new Error("weeklyReport job.data must be an object with type 'weeklyReport'");
  }
  const triggeredBy = data.triggeredBy;
  if (triggeredBy !== "schedule" && triggeredBy !== "manual") {
    throw new Error("weeklyReport job.data.triggeredBy must be 'schedule' or 'manual'");
  }
  const tenantId = data.tenantId;
  if (tenantId !== undefined && (typeof tenantId !== "string" || !tenantId.trim())) {
    throw new Error("weeklyReport job.data.tenantId must be a non-empty string when set");
  }
  const out: WeeklyReportJobData = {
    type: "weeklyReport",
    triggeredBy,
    ...(typeof tenantId === "string" ? { tenantId: tenantId.trim() } : {}),
  };
  for (const key of ["weekStart", "weekEnd"] as const) {
    const raw = data[key];
    if (raw !== undefined) {
      if (typeof raw !== "string" || Number.isNaN(Date.parse(raw))) {
        throw new Error(`weeklyReport job.data.${key} must be an ISO date string when set`);
      }
      out[key] = raw;
    }
  }
  if ((out.weekStart === undefined) !== (out.weekEnd === undefined)) {
    throw new Error("weeklyReport job.data.weekStart/weekEnd must be set together");
  }
  return out;
}

/** Cashback automation pack (2026-10-08): rate-watch job data. */
export interface CashbackRateWatchJobData {
  type: "cashbackRateWatch";
  triggeredBy: "schedule" | "manual";
  tenantId?: string;
}

/** Validate inbound cashback-rate-watch job data. */
export function parseCashbackRateWatchJobData(data: unknown): CashbackRateWatchJobData {
  if (!isRecord(data) || data.type !== "cashbackRateWatch") {
    throw new Error("cashbackRateWatch job.data must be an object with type 'cashbackRateWatch'");
  }
  const triggeredBy = data.triggeredBy;
  if (triggeredBy !== "schedule" && triggeredBy !== "manual") {
    throw new Error("cashbackRateWatch job.data.triggeredBy must be 'schedule' or 'manual'");
  }
  const tenantId = data.tenantId;
  if (tenantId !== undefined && (typeof tenantId !== "string" || !tenantId.trim())) {
    throw new Error("cashbackRateWatch job.data.tenantId must be a non-empty string when set");
  }
  return {
    type: "cashbackRateWatch",
    triggeredBy,
    ...(typeof tenantId === "string" ? { tenantId: tenantId.trim() } : {}),
  };
}

/** Cashback automation pack (2026-10-08): terms-watch job data. */
export interface CashbackTermsWatchJobData {
  type: "cashbackTermsWatch";
  triggeredBy: "schedule" | "manual";
  tenantId?: string;
}

/** Validate inbound cashback-terms-watch job data. */
export function parseCashbackTermsWatchJobData(data: unknown): CashbackTermsWatchJobData {
  if (!isRecord(data) || data.type !== "cashbackTermsWatch") {
    throw new Error("cashbackTermsWatch job.data must be an object with type 'cashbackTermsWatch'");
  }
  const triggeredBy = data.triggeredBy;
  if (triggeredBy !== "schedule" && triggeredBy !== "manual") {
    throw new Error("cashbackTermsWatch job.data.triggeredBy must be 'schedule' or 'manual'");
  }
  const tenantId = data.tenantId;
  if (tenantId !== undefined && (typeof tenantId !== "string" || !tenantId.trim())) {
    throw new Error("cashbackTermsWatch job.data.tenantId must be a non-empty string when set");
  }
  return {
    type: "cashbackTermsWatch",
    triggeredBy,
    ...(typeof tenantId === "string" ? { tenantId: tenantId.trim() } : {}),
  };
}

/** Cashback automation pack (2026-10-08): lp-score job data. */
export interface CashbackLpScoreJobData {
  type: "cashbackLpScore";
  triggeredBy: "schedule" | "manual";
  tenantId?: string;
}

/** Validate inbound cashback-lp-score job data. */
export function parseCashbackLpScoreJobData(data: unknown): CashbackLpScoreJobData {
  if (!isRecord(data) || data.type !== "cashbackLpScore") {
    throw new Error("cashbackLpScore job.data must be an object with type 'cashbackLpScore'");
  }
  const triggeredBy = data.triggeredBy;
  if (triggeredBy !== "schedule" && triggeredBy !== "manual") {
    throw new Error("cashbackLpScore job.data.triggeredBy must be 'schedule' or 'manual'");
  }
  const tenantId = data.tenantId;
  if (tenantId !== undefined && (typeof tenantId !== "string" || !tenantId.trim())) {
    throw new Error("cashbackLpScore job.data.tenantId must be a non-empty string when set");
  }
  return {
    type: "cashbackLpScore",
    triggeredBy,
    ...(typeof tenantId === "string" ? { tenantId: tenantId.trim() } : {}),
  };
}

/** Cashback automation pack (2026-10-08): redirect-check job data. */
export interface CashbackRedirectCheckJobData {
  type: "cashbackRedirectCheck";
  triggeredBy: "schedule" | "manual";
  tenantId?: string;
}

/** Validate inbound cashback-redirect-check job data. */
export function parseCashbackRedirectCheckJobData(data: unknown): CashbackRedirectCheckJobData {
  if (!isRecord(data) || data.type !== "cashbackRedirectCheck") {
    throw new Error("cashbackRedirectCheck job.data must be an object with type 'cashbackRedirectCheck'");
  }
  const triggeredBy = data.triggeredBy;
  if (triggeredBy !== "schedule" && triggeredBy !== "manual") {
    throw new Error("cashbackRedirectCheck job.data.triggeredBy must be 'schedule' or 'manual'");
  }
  const tenantId = data.tenantId;
  if (tenantId !== undefined && (typeof tenantId !== "string" || !tenantId.trim())) {
    throw new Error("cashbackRedirectCheck job.data.tenantId must be a non-empty string when set");
  }
  return {
    type: "cashbackRedirectCheck",
    triggeredBy,
    ...(typeof tenantId === "string" ? { tenantId: tenantId.trim() } : {}),
  };
}

/** Cashback automation pack (2026-10-08): rate-compare job data. */
export interface CashbackRateCompareJobData {
  type: "cashbackRateCompare";
  triggeredBy: "schedule" | "manual";
  tenantId?: string;
}

/** Validate inbound cashback-rate-compare job data. */
export function parseCashbackRateCompareJobData(data: unknown): CashbackRateCompareJobData {
  if (!isRecord(data) || data.type !== "cashbackRateCompare") {
    throw new Error("cashbackRateCompare job.data must be an object with type 'cashbackRateCompare'");
  }
  const triggeredBy = data.triggeredBy;
  if (triggeredBy !== "schedule" && triggeredBy !== "manual") {
    throw new Error("cashbackRateCompare job.data.triggeredBy must be 'schedule' or 'manual'");
  }
  const tenantId = data.tenantId;
  if (tenantId !== undefined && (typeof tenantId !== "string" || !tenantId.trim())) {
    throw new Error("cashbackRateCompare job.data.tenantId must be a non-empty string when set");
  }
  return {
    type: "cashbackRateCompare",
    triggeredBy,
    ...(typeof tenantId === "string" ? { tenantId: tenantId.trim() } : {}),
  };
}

/** ASIN 需求异动监控（第十批）：每日快照 job data. */
export interface AsinWatchJobData {
  type: "asinWatch";
  triggeredBy: "schedule" | "manual";
  tenantId?: string;
}

/** Validate inbound asin-watch job data. */
export function parseAsinWatchJobData(data: unknown): AsinWatchJobData {
  if (!isRecord(data) || data.type !== "asinWatch") {
    throw new Error("asinWatch job.data must be an object with type 'asinWatch'");
  }
  const triggeredBy = data.triggeredBy;
  if (triggeredBy !== "schedule" && triggeredBy !== "manual") {
    throw new Error("asinWatch job.data.triggeredBy must be 'schedule' or 'manual'");
  }
  const tenantId = data.tenantId;
  if (tenantId !== undefined && (typeof tenantId !== "string" || !tenantId.trim())) {
    throw new Error("asinWatch job.data.tenantId must be a non-empty string when set");
  }
  return {
    type: "asinWatch",
    triggeredBy,
    ...(typeof tenantId === "string" ? { tenantId: tenantId.trim() } : {}),
  };
}
