/**
 * Offer rotation worker (feature 3: 返利网换链).
 *
 * Semantics: a RotationGroup bundles several CashbackOffers (each with its
 * own TrackingLink, auto-created). Rotating a group picks the next offer by
 * strategy and re-points EVERY tracking link in the group at the selected
 * offer's backing Offer — the ad-side short links stay stable while the
 * destination ("换链") swaps among the group's cashback offers.
 *
 * Worker-owned hourly schedule (registered by the parent in queue runtime,
 * like competitor-watch): scans enabled groups and rotates those whose
 * last rotation (group.updatedAt) is older than ROTATION_MIN_INTERVAL_MS.
 * Individual group failures never throw — one bad group cannot wedge the
 * hourly run.
 */
import type { PrismaClient } from "@adlinklab/database";

export const ROTATION_MIN_INTERVAL_MS = 3600_000;

/** strategies stored as plain string on RotationGroup.strategy */
export const ROTATION_STRATEGY_ROUND_ROBIN = "round_robin";
export const ROTATION_STRATEGY_WEIGHTED = "weighted";

export interface RotationLog {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

function defaultLog(prefix: string): RotationLog {
  return {
    info: (msg, meta) => console.log(`[${prefix}] ${msg}`, meta ?? ""),
    error: (msg, meta) => console.error(`[${prefix}] ${msg}`, meta ?? ""),
  };
}

export interface RotationCandidate {
  rotationGroupItemId: string;
  cashbackOfferId: string;
  /** backing Offer id of the candidate's own tracking link */
  backingOfferId: string;
  weight: number;
  sortOrder: number;
}

export interface SelectNextOfferInput {
  candidates: RotationCandidate[];
  strategy: string;
  /** cashbackOfferId currently selected (null/unknown → start of cycle) */
  currentOfferId?: string | null;
  /** Injectable RNG for tests (default Math.random). */
  rand?: () => number;
}

/**
 * Pure strategy selection — unit-tested.
 * - round_robin: cycle through sortOrder-sorted candidates starting after
 *   the current one (wraps around); unknown current → first.
 * - weighted: weighted-random by weight (clamped >= 1).
 * Unknown strategy falls back to round_robin. Empty list → null.
 */
export function selectNextOffer(input: SelectNextOfferInput): RotationCandidate | null {
  const items = [...(input.candidates ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder
  );
  if (items.length === 0) return null;

  const strategy = (input.strategy ?? "").trim().toLowerCase();
  if (strategy === ROTATION_STRATEGY_WEIGHTED) {
    const rand = input.rand ?? Math.random;
    const weights = items.map((c) =>
      Number.isFinite(c.weight) && c.weight > 0 ? Math.floor(c.weight) : 1
    );
    const total = weights.reduce((s, w) => s + w, 0);
    let roll = rand() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i];
      if (roll < 0) return items[i];
    }
    return items[items.length - 1];
  }

  // round_robin (default)
  const current = input.currentOfferId ?? null;
  if (!current) return items[0];
  const idx = items.findIndex((c) => c.cashbackOfferId === current);
  return items[(idx + 1 + items.length) % items.length];
}

// ---------------------------------------------------------------------------
// Group rotation (shared by the manual rotate-now route and the worker)
// ---------------------------------------------------------------------------

export interface TrackingLinkRotationWriter {
  update(
    id: string,
    data: { offerId: string }
  ): Promise<unknown>;
}

export interface RotateGroupResult {
  groupId: string;
  rotated: boolean;
  /** cashbackOfferId now selected (null when the group has no live offers) */
  selectedOfferId: string | null;
  /** tracking link ids re-pointed */
  updatedTrackingLinkIds: string[];
  skipped?: string;
}

interface GroupRow {
  id: string;
  tenantId: string;
  name: string;
  strategy: string;
  isActive: boolean;
  updatedAt: Date;
}

/**
 * Rotate one group: pick the next offer per strategy and re-point every
 * member tracking link at its backing offer.
 * Never throws for data problems (returns skipped reason); throws only on
 * unexpected prisma failures so the caller can decide (worker swallows).
 */
export async function rotateGroup(input: {
  prisma: PrismaClient;
  trackingLinks: TrackingLinkRotationWriter;
  groupId: string;
  rand?: () => number;
  log?: RotationLog;
}): Promise<RotateGroupResult> {
  const { prisma, trackingLinks } = input;
  const log = input.log ?? defaultLog("rotation");
  const groupId = input.groupId;

  const group = (await prisma.rotationGroup.findUnique({
    where: { id: groupId },
    include: {
      items: {
        include: { cashbackOffer: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  })) as (GroupRow & {
    items: Array<{
      id: string;
      weight: number;
      sortOrder: number;
      cashbackOffer: {
        id: string;
        status: string;
        deletedAt: Date | null;
        trackingLinkId: string | null;
        originalUrl: string;
      } | null;
    }>;
  }) | null;

  if (!group) {
    return { groupId, rotated: false, selectedOfferId: null, updatedTrackingLinkIds: [], skipped: "group not found" };
  }

  // Only live offers with their own tracking link can be rotated to.
  const liveItems = (group.items ?? []).filter(
    (it) =>
      it.cashbackOffer &&
      it.cashbackOffer.status === "active" &&
      !it.cashbackOffer.deletedAt &&
      !!it.cashbackOffer.trackingLinkId
  );
  if (liveItems.length === 0) {
    return { groupId, rotated: false, selectedOfferId: null, updatedTrackingLinkIds: [], skipped: "no active offers with tracking links" };
  }

  // Resolve each offer's backing Offer id via its own tracking link.
  const linkIds = liveItems.map((it) => it.cashbackOffer!.trackingLinkId!);
  const links = (await prisma.trackingLink.findMany({
    where: { id: { in: linkIds } },
    select: { id: true, offerId: true },
  })) as Array<{ id: string; offerId: string }>;
  const linkIdToOfferId = new Map(links.map((l) => [l.id, l.offerId]));

  const candidates: RotationCandidate[] = [];
  for (const it of liveItems) {
    const backingOfferId = linkIdToOfferId.get(it.cashbackOffer!.trackingLinkId!);
    if (!backingOfferId) continue; // tracking link deleted out-of-band
    candidates.push({
      rotationGroupItemId: it.id,
      cashbackOfferId: it.cashbackOffer!.id,
      backingOfferId,
      weight: it.weight,
      sortOrder: it.sortOrder,
    });
  }
  if (candidates.length === 0) {
    return { groupId, rotated: false, selectedOfferId: null, updatedTrackingLinkIds: [], skipped: "tracking links missing" };
  }

  // Current selection = where the first (lowest sortOrder) member link points.
  const firstLiveItem = liveItems.find(
    (it) => it.cashbackOffer!.id === candidates[0].cashbackOfferId
  )!;
  const firstLinkId = firstLiveItem.cashbackOffer!.trackingLinkId!;
  const currentBackingOfferId = linkIdToOfferId.get(firstLinkId) ?? null;
  const currentOfferId =
    candidates.find((c) => c.backingOfferId === currentBackingOfferId)
      ?.cashbackOfferId ?? null;

  const selected = selectNextOffer({
    candidates,
    strategy: group.strategy,
    currentOfferId,
    rand: input.rand,
  });
  if (!selected) {
    return { groupId, rotated: false, selectedOfferId: null, updatedTrackingLinkIds: [], skipped: "selection failed" };
  }

  const updatedTrackingLinkIds: string[] = [];
  if (selected.backingOfferId !== currentBackingOfferId) {
    for (const c of candidates) {
      const linkId = liveItems.find(
        (it) => it.cashbackOffer!.id === c.cashbackOfferId
      )!.cashbackOffer!.trackingLinkId!;
      await trackingLinks.update(linkId, { offerId: selected.backingOfferId });
      updatedTrackingLinkIds.push(linkId);
    }
  }

  // Touch updatedAt so the hourly worker's cooldown sees this rotation.
  await prisma.rotationGroup.update({
    where: { id: group.id },
    data: { updatedAt: new Date() },
  });

  log.info("rotation group rotated", {
    groupId: group.id,
    tenantId: group.tenantId,
    strategy: group.strategy,
    selectedOfferId: selected.cashbackOfferId,
    rotated: updatedTrackingLinkIds.length > 0,
  });

  return {
    groupId: group.id,
    rotated: updatedTrackingLinkIds.length > 0,
    selectedOfferId: selected.cashbackOfferId,
    updatedTrackingLinkIds,
  };
}

// ---------------------------------------------------------------------------
// Worker entry (BullMQ calls this on the hourly repeatable schedule)
// ---------------------------------------------------------------------------

export interface RotationScanSummary {
  groupsChecked: number;
  groupsRotated: number;
  groupsSkipped: number;
  errors: number;
}

export async function processRotationJob(input: {
  prisma: PrismaClient;
  trackingLinks: TrackingLinkRotationWriter;
  triggeredBy: "schedule" | "manual";
  tenantId?: string;
  rand?: () => number;
  log?: RotationLog;
}): Promise<RotationScanSummary> {
  const log = input.log ?? defaultLog("rotation");
  const now = Date.now();

  const groups = (await input.prisma.rotationGroup.findMany({
    where: {
      isActive: true,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, tenantId: true, updatedAt: true, rotationIntervalMs: true },
  })) as Array<{ id: string; tenantId: string; updatedAt: Date; rotationIntervalMs: number | null }>;

  const due = groups.filter((g) => {
    const interval = g.rotationIntervalMs ?? ROTATION_MIN_INTERVAL_MS;
    // 0 or negative = manual only, never auto-rotate.
    if (interval <= 0) return false;
    return now - new Date(g.updatedAt).getTime() >= interval;
  });

  const summary: RotationScanSummary = {
    groupsChecked: 0,
    groupsRotated: 0,
    groupsSkipped: groups.length - due.length,
    errors: 0,
  };

  for (const g of due) {
    try {
      const result = await rotateGroup({
        prisma: input.prisma,
        trackingLinks: input.trackingLinks,
        groupId: g.id,
        rand: input.rand,
        log,
      });
      summary.groupsChecked += 1;
      if (result.rotated) summary.groupsRotated += 1;
      else if (result.skipped) summary.groupsSkipped += 1;
    } catch (error) {
      // Never throw: one bad group must not wedge the hourly run.
      summary.errors += 1;
      log.error("rotation group failed", {
        groupId: g.id,
        tenantId: g.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  log.info("rotation scan complete", {
    triggeredBy: input.triggeredBy,
    tenantId: input.tenantId ?? "all",
    ...summary,
  });
  return summary;
}

/** Default tracking-link writer backed by the existing Prisma update path. */
export function createPrismaTrackingLinkRotationWriter(
  prisma: PrismaClient
): TrackingLinkRotationWriter {
  return {
    async update(id: string, data: { offerId: string }) {
      await prisma.trackingLink.update({ where: { id }, data });
    },
  };
}
