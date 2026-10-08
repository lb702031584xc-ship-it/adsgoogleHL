/**
 * P1 — offer performance stats (profitability v2 inputs).
 *
 * Aggregates clicks → conversions → revenue per offer over a trailing window:
 * clicks, conversions, CVR, revenue (+dominant currency), EPC, and order
 * refund stats. Money comes from Decimal(19,4) columns — converted to number
 * only at the boundary.
 */
import type { PrismaClient } from "@adlinklab/database";

export interface OfferPerformance {
  offerId: string;
  days: number;
  clicks: number;
  conversions: number;
  /** Percent 0..100, null when no clicks. */
  cvrPct: number | null;
  revenue: number;
  revenueCurrency: string | null;
  /** Earnings per click; 0 when no clicks. */
  epc: number;
  ordersConfirmed: number;
  ordersRefunded: number;
  /** Percent 0..100, null when no decided orders. */
  refundRatePct: number | null;
}

/** Percent with 2dp; null when denominator is 0. */
export function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100 * 100) / 100;
}

/** Most frequent value; null when empty. Ties resolve to first-seen. */
export function mostCommon<T>(values: T[]): T | null {
  if (values.length === 0) return null;
  const counts = new Map<T, number>();
  let best: T = values[0];
  let bestCount = 0;
  for (const v of values) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestCount) {
      bestCount = c;
      best = v;
    }
  }
  return best;
}


export async function getOfferPerformance(
  prisma: PrismaClient,
  tenantId: string,
  offerId: string,
  days: number
): Promise<OfferPerformance> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  const clicks = await prisma.click.count({
    // Test clicks (link-chain verification) never count as real traffic.
    where: { tenantId, offerId, occurredAt: { gte: since }, isTest: { not: true } },
  });

  const convWhere = {
    tenantId,
    status: {
      notIn: ["FAILED", "ARCHIVED"] as Array<"FAILED" | "ARCHIVED">,
    },
    conversionTime: { gte: since },
    click: { offerId, isTest: { not: true } },
  };

  const [conversions, revenueAgg, currencyGroups] = await Promise.all([
    prisma.conversion.count({ where: convWhere }),
    prisma.conversion.aggregate({
      _sum: { value: true },
      where: convWhere,
    }),
    prisma.conversion.groupBy({
      by: ["currency"],
      where: convWhere,
      _count: { currency: true },
    }),
  ]);

  const revenue = Number(revenueAgg._sum.value ?? 0);
  let revenueCurrency: string | null = null;
  let bestCurrencyCount = 0;
  for (const g of currencyGroups) {
    if (g._count.currency > bestCurrencyCount) {
      bestCurrencyCount = g._count.currency;
      revenueCurrency = g.currency;
    }
  }

  const orderGroups = await prisma.order.groupBy({
    by: ["status"],
    where: {
      tenantId,
      createdAt: { gte: since },
      click: { offerId, isTest: { not: true } },
    },
    _count: { _all: true },
  });
  let ordersConfirmed = 0;
  let ordersRefunded = 0;
  for (const g of orderGroups) {
    if (g.status === "CONFIRMED") ordersConfirmed += g._count._all;
    if (g.status === "REFUNDED") ordersRefunded += g._count._all;
  }

  return {
    offerId,
    days,
    clicks,
    conversions,
    cvrPct: pct(conversions, clicks),
    revenue: Math.round(revenue * 100) / 100,
    revenueCurrency,
    epc: clicks > 0 ? Math.round((revenue / clicks) * 10000) / 10000 : 0,
    ordersConfirmed,
    ordersRefunded,
    refundRatePct: pct(ordersRefunded, ordersConfirmed + ordersRefunded),
  };
}
