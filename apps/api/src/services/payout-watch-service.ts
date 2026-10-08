/**
 * Automation pack ③ — payout (commission) change monitoring.
 *
 * Watches offer commission values (Offer.commissionValue) and raises a
 * tenant-scoped Alert when a watched offer's payout changes.
 *
 * NOTE on field mapping: the spec for this feature referenced an
 * `Offer.payout` field, which does not exist in the Prisma schema.
 * The actual commission field is `Offer.commissionValue` (Decimal(19,4));
 * this service compares that value (rounded to 4 decimals) against
 * PayoutWatch.lastPayout.
 *
 * Change detection:
 * - first check (lastPayout null) → record baseline, no alert
 * - payout changed              → append history (cap 20), raise alert
 *                                 (24h dedup per offer), advise re-running
 *                                 /ai/profit
 * - payout unchanged            → only touch lastCheckedAt
 *
 * Profitability recalculation: `computeProfitability()` in
 * ../ai/profitability.js needs an estimated CPC, which is not stored
 * per-offer, so instead of forcing a bogus recompute the alert message
 * advises re-running the /ai/profit measurement.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { NotFoundError, ValidationError } from "@adlinklab/shared";

/** Alert metric recorded on payout changes (stored in Alert.metric). */
export const PAYOUT_WATCH_ALERT_METRIC = "payout_change";

/** Alert dedupe window: one open alert per offer per 24h. */
const ALERT_DEDUPE_WINDOW_MS = 24 * 3600 * 1000;

/** Max change-history entries retained per watch. */
export const PAYOUT_WATCH_MAX_HISTORY = 20;

/** commissionValue has 4 decimals — round before comparing floats. */
const PAYOUT_PRECISION = 10000;

export interface PayoutWatchLog {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface PayoutChangeEntry {
  oldPayout: number | null;
  newPayout: number | null;
  changedAt: string;
}

export interface PayoutWatchRow {
  id: string;
  tenantId: string;
  offerId: string;
  enabled: boolean;
  lastPayout: number | null;
  lastCheckedAt: Date | null;
  changeHistory: PayoutChangeEntry[];
}

export interface PayoutWatchItem extends PayoutWatchRow {
  changeCount: number;
  offerName: string | null;
  offerNetwork: string | null;
  commissionType: string | null;
  /** Offer's current commissionValue as a number (null when unset). */
  currentPayout: number | null;
}

export interface PayoutWatchCheckSummary {
  checked: number;
  baselined: number;
  changed: number;
  alertsCreated: number;
}

/** Normalize a Prisma Decimal/number/null into a comparable number. */
export function toPayoutNumber(
  value: unknown
): number | null {
  if (value === null || value === undefined) return null;
  const n =
    typeof value === "number"
      ? value
      : Number((value as { toString?: () => string }).toString?.() ?? value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * PAYOUT_PRECISION) / PAYOUT_PRECISION;
}

function getHistory(watch: {
  changeHistory?: unknown;
}): PayoutChangeEntry[] {
  const raw = (watch as { changeHistory?: unknown }).changeHistory;
  return Array.isArray(raw) ? (raw as PayoutChangeEntry[]) : [];
}

function defaultLog(): PayoutWatchLog {
  return {
    info: (msg, meta) => console.log(`[payout-watch] ${msg}`, meta ?? ""),
    error: (msg, meta) => console.error(`[payout-watch] ${msg}`, meta ?? ""),
  };
}

async function touchChecked(
  prisma: PrismaClient,
  watchId: string
): Promise<void> {
  await prisma.payoutWatch.update({
    where: { id: watchId },
    data: { lastCheckedAt: new Date() },
  });
}

function buildAlertMessage(
  offerName: string,
  oldPayout: number,
  newPayout: number
): string {
  const direction = newPayout > oldPayout ? "上涨" : "下跌";
  const pct =
    oldPayout > 0
      ? `（${direction} ${(
          (Math.abs(newPayout - oldPayout) / oldPayout) *
          100
        ).toFixed(1)}%）`
      : "";
  return `佣金监控「${offerName}」：佣金从 ${oldPayout} 变为 ${newPayout}${pct}。佣金变化可能影响盈亏测算，建议重新跑 /ai/profit 测算。`;
}

/**
 * Create the payout_change alert unless an open one exists for this offer
 * within the 24h dedupe window.
 */
async function maybeCreatePayoutAlert(
  prisma: PrismaClient,
  tenantId: string,
  watch: { id: string; offerId: string },
  offerName: string,
  oldPayout: number,
  newPayout: number,
  log: PayoutWatchLog
): Promise<boolean> {
  const since = new Date(Date.now() - ALERT_DEDUPE_WINDOW_MS);
  const openAlerts = (await prisma.alert.findMany({
    where: {
      tenantId,
      metric: PAYOUT_WATCH_ALERT_METRIC,
      status: "open",
      createdAt: { gt: since },
    },
    select: { id: true, data: true },
  })) as Array<{ id: string; data: unknown }>;
  const dup = openAlerts.some(
    (a) =>
      typeof a.data === "object" &&
      a.data !== null &&
      (a.data as { offerId?: unknown }).offerId === watch.offerId
  );
  if (dup) {
    log.info("payout-watch alert deduped (24h)", {
      watchId: watch.id,
      offerId: watch.offerId,
      tenantId,
    });
    return false;
  }
  await prisma.alert.create({
    data: {
      id: randomUUID(),
      tenantId,
      ruleId: null,
      metric: PAYOUT_WATCH_ALERT_METRIC,
      severity: "medium",
      message: buildAlertMessage(offerName, oldPayout, newPayout),
      // Deep-clone to plain JSON for the Prisma Json field.
      data: JSON.parse(
        JSON.stringify({
          offerId: watch.offerId,
          watchId: watch.id,
          oldPayout,
          newPayout,
        })
      ),
      status: "open",
    },
  });
  return true;
}

/**
 * Check one watch against the offer's current commissionValue.
 * Never throws: callers may run this in a loop over many watches.
 */
export async function checkPayoutWatch(
  prisma: PrismaClient,
  watch: PayoutWatchRow,
  offer: {
    id: string;
    name: string;
    commissionValue: unknown;
  } | null,
  opts: { log?: PayoutWatchLog } = {}
): Promise<{ baselined: boolean; changed: boolean; alertCreated: boolean }> {
  const log = opts.log ?? defaultLog();
  const now = new Date();

  if (!offer) {
    log.error("payout-watch skipped: offer not found", {
      watchId: watch.id,
      offerId: watch.offerId,
      tenantId: watch.tenantId,
    });
    await touchChecked(prisma, watch.id);
    return { baselined: false, changed: false, alertCreated: false };
  }

  const current = toPayoutNumber(offer.commissionValue);

  // First check → record baseline, no alert.
  if (watch.lastPayout === null || watch.lastPayout === undefined) {
    await prisma.payoutWatch.update({
      where: { id: watch.id },
      data: { lastPayout: current, lastCheckedAt: now },
    });
    log.info("payout-watch baseline established", {
      watchId: watch.id,
      offerId: watch.offerId,
      tenantId: watch.tenantId,
      payout: current,
    });
    return { baselined: true, changed: false, alertCreated: false };
  }

  const baseline = toPayoutNumber(watch.lastPayout);
  if (current === null || baseline === null || current === baseline) {
    await touchChecked(prisma, watch.id);
    return { baselined: false, changed: false, alertCreated: false };
  }

  // Changed → append history (cap 20), update lastPayout, alert (24h dedup).
  const entry: PayoutChangeEntry = {
    oldPayout: baseline,
    newPayout: current,
    changedAt: now.toISOString(),
  };
  const history = [...getHistory(watch), entry].slice(
    -PAYOUT_WATCH_MAX_HISTORY
  );
  await prisma.payoutWatch.update({
    where: { id: watch.id },
    data: {
      lastPayout: current,
      lastCheckedAt: now,
      changeHistory: JSON.parse(JSON.stringify(history)),
    },
  });
  const alertCreated = await maybeCreatePayoutAlert(
    prisma,
    watch.tenantId,
    watch,
    offer.name,
    baseline,
    current,
    log
  );
  log.info("payout-watch change detected", {
    watchId: watch.id,
    offerId: watch.offerId,
    tenantId: watch.tenantId,
    oldPayout: baseline,
    newPayout: current,
    alertCreated,
  });
  return { baselined: false, changed: true, alertCreated };
}

/**
 * Check all enabled payout watches (optionally scoped to one tenant).
 * Per-watch failures are logged and never thrown.
 */
export async function checkAllWatches(
  prisma: PrismaClient,
  tenantId?: string,
  opts: { log?: PayoutWatchLog } = {}
): Promise<PayoutWatchCheckSummary> {
  const log = opts.log ?? defaultLog();
  const watches = (await prisma.payoutWatch.findMany({
    where: {
      enabled: true,
      ...(tenantId ? { tenantId } : {}),
    },
    orderBy: { createdAt: "asc" },
  })) as unknown as PayoutWatchRow[];

  const summary: PayoutWatchCheckSummary = {
    checked: 0,
    baselined: 0,
    changed: 0,
    alertsCreated: 0,
  };

  for (const watch of watches) {
    try {
      const offer = (await prisma.offer.findFirst({
        where: {
          id: watch.offerId,
          tenantId: watch.tenantId,
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          commissionValue: true,
        },
      })) as {
        id: string;
        name: string;
        commissionValue: unknown;
      } | null;
      const result = await checkPayoutWatch(prisma, watch, offer, { log });
      summary.checked += 1;
      if (result.baselined) summary.baselined += 1;
      if (result.changed) summary.changed += 1;
      if (result.alertCreated) summary.alertsCreated += 1;
    } catch (error) {
      // Never throw: one bad watch must not wedge the scan.
      log.error("payout-watch check failed", {
        watchId: watch.id,
        offerId: watch.offerId,
        tenantId: watch.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        await touchChecked(prisma, watch.id);
      } catch {
        /* best effort */
      }
    }
  }

  log.info("payout-watch scan complete", {
    tenantId: tenantId ?? "all",
    ...summary,
  });
  return summary;
}

/**
 * Enable (or create) a watch for an offer. Creates the watch with
 * lastPayout seeded from the offer's current commissionValue so enabling
 * never fires an immediate change alert.
 */
export async function enableWatch(
  prisma: PrismaClient,
  tenantId: string,
  offerId: string
): Promise<PayoutWatchRow> {
  if (!offerId || typeof offerId !== "string") {
    throw new ValidationError("offerId is required");
  }
  const offer = (await prisma.offer.findFirst({
    where: { id: offerId, tenantId, deletedAt: null },
    select: { id: true, commissionValue: true },
  })) as { id: string; commissionValue: unknown } | null;
  if (!offer) {
    throw new NotFoundError("Offer", offerId);
  }
  const row = (await prisma.payoutWatch.upsert({
    where: { tenantId_offerId: { tenantId, offerId } },
    create: {
      id: randomUUID(),
      tenantId,
      offerId,
      enabled: true,
      lastPayout: toPayoutNumber(offer.commissionValue),
    },
    update: { enabled: true },
  })) as unknown as PayoutWatchRow;
  return row;
}

/** Disable a watch (keeps history). Throws when the watch does not exist. */
export async function disableWatch(
  prisma: PrismaClient,
  tenantId: string,
  offerId: string
): Promise<PayoutWatchRow> {
  const existing = (await prisma.payoutWatch.findFirst({
    where: { tenantId, offerId },
  })) as PayoutWatchRow | null;
  if (!existing) {
    throw new NotFoundError("PayoutWatch", offerId);
  }
  const row = (await prisma.payoutWatch.update({
    where: { id: existing.id },
    data: { enabled: false },
  })) as unknown as PayoutWatchRow;
  return row;
}

/**
 * List a tenant's watches joined with offer name / current payout.
 * PayoutWatch has no Prisma relation to Offer, so offers are fetched in
 * one batch query and joined in code.
 */
export async function listWatches(
  prisma: PrismaClient,
  tenantId: string
): Promise<PayoutWatchItem[]> {
  const watches = (await prisma.payoutWatch.findMany({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
  })) as unknown as PayoutWatchRow[];
  const offerIds = [...new Set(watches.map((w) => w.offerId))];
  const offers = (
    offerIds.length > 0
      ? await prisma.offer.findMany({
          where: { id: { in: offerIds }, tenantId },
          select: {
            id: true,
            name: true,
            network: true,
            commissionType: true,
            commissionValue: true,
          },
        })
      : []
  ) as Array<{
    id: string;
    name: string;
    network: string;
    commissionType: string | null;
    commissionValue: unknown;
  }>;
  const byId = new Map(offers.map((o) => [o.id, o]));
  return watches.map((w) => {
    const offer = byId.get(w.offerId);
    const history = getHistory(w);
    return {
      ...w,
      changeHistory: history,
      changeCount: history.length,
      offerName: offer?.name ?? null,
      offerNetwork: offer?.network ?? null,
      commissionType: offer?.commissionType ?? null,
      currentPayout: offer ? toPayoutNumber(offer.commissionValue) : null,
    };
  });
}
