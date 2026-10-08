/**
 * Automation pack ③ — payout-watch service tests.
 * In-memory fake Prisma; no network, no database.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import {
  checkAllWatches,
  checkPayoutWatch,
  disableWatch,
  enableWatch,
  listWatches,
  PAYOUT_WATCH_ALERT_METRIC,
  toPayoutNumber,
} from "./payout-watch-service.js";

type Row = Record<string, any>;

const TENANT = randomUUID();
const OFFER = randomUUID();

function matchesWhere(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    const rv = row[k];
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      return Object.entries(v).every(([op, ov]) => {
        const a = rv instanceof Date ? rv.getTime() : rv;
        const b = (ov as any) instanceof Date ? (ov as any).getTime() : ov;
        switch (op) {
          case "gt":
            return a > b;
          case "in":
            return Array.isArray(ov) && ov.includes(rv);
          default:
            return true;
        }
      });
    }
    if (v === null) return rv === null || rv === undefined;
    return rv === v;
  });
}

function mkStore(rows: Row[]) {
  return {
    findFirst: async ({ where }: any) =>
      rows.filter((r) => matchesWhere(r, where)).map((r) => ({ ...r }))[0] ??
      null,
    findMany: async ({ where, orderBy }: any) => {
      let out = rows.filter((r) => matchesWhere(r, where));
      if (orderBy) {
        const [key, dir] = Object.entries(orderBy)[0] as [string, string];
        out = [...out].sort((a, b) =>
          dir === "desc" ? (b[key] > a[key] ? 1 : -1) : a[key] > b[key] ? 1 : -1
        );
      }
      return out.map((r) => ({ ...r }));
    },
    create: async ({ data }: any) => {
      const row = {
        id: data.id ?? randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      rows.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchesWhere(r, where));
      if (!row) throw new Error("row not found");
      Object.assign(row, data);
      return { ...row };
    },
    upsert: async ({ where, create, update }: any) => {
      const row = rows.find((r) => matchesWhere(r, where));
      if (row) {
        Object.assign(row, update);
        return { ...row };
      }
      const created = {
        id: create.id ?? randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        changeHistory: [],
        lastCheckedAt: null,
        ...create,
      };
      rows.push(created);
      return { ...created };
    },
  };
}

function mkPrisma(state: { watches: Row[]; offers: Row[]; alerts: Row[] }) {
  return {
    payoutWatch: mkStore(state.watches),
    offer: mkStore(state.offers),
    alert: mkStore(state.alerts),
  } as unknown as PrismaClient;
}

function seedOffer(offers: Row[], payout: number | null) {
  offers.push({
    id: OFFER,
    tenantId: TENANT,
    name: "测试Offer",
    network: "Impact",
    commissionType: "flat",
    commissionValue: payout,
    deletedAt: null,
  });
}

function seedWatch(watches: Row[], lastPayout: number | null, enabled = true) {
  watches.push({
    id: randomUUID(),
    tenantId: TENANT,
    offerId: OFFER,
    enabled,
    lastPayout,
    lastCheckedAt: null,
    changeHistory: [],
    createdAt: new Date(),
  });
}

describe("toPayoutNumber", () => {
  it("rounds Decimal-like values to 4 decimals and handles null", () => {
    expect(toPayoutNumber(null)).toBeNull();
    expect(toPayoutNumber(undefined)).toBeNull();
    expect(toPayoutNumber(10.123456)).toBe(10.1235);
    // Decimal.js-style object with toString
    expect(toPayoutNumber({ toString: () => "7.25" })).toBe(7.25);
  });
});

describe("checkPayoutWatch", () => {
  let watches: Row[];
  let offers: Row[];
  let alerts: Row[];
  let prisma: PrismaClient;

  beforeEach(() => {
    watches = [];
    offers = [];
    alerts = [];
    prisma = mkPrisma({ watches, offers, alerts });
  });

  it("first check only records the baseline, no alert", async () => {
    seedOffer(offers, 10);
    seedWatch(watches, null);
    const summary = await checkAllWatches(prisma, TENANT);
    expect(summary.checked).toBe(1);
    expect(summary.baselined).toBe(1);
    expect(summary.changed).toBe(0);
    expect(summary.alertsCreated).toBe(0);
    expect(alerts).toHaveLength(0);
    expect(watches[0].lastPayout).toBe(10);
    expect(watches[0].lastCheckedAt).not.toBeNull();
  });

  it("payout change appends history and creates an alert", async () => {
    seedOffer(offers, 12.5);
    seedWatch(watches, 10);
    const summary = await checkAllWatches(prisma, TENANT);
    expect(summary.changed).toBe(1);
    expect(summary.alertsCreated).toBe(1);
    expect(watches[0].lastPayout).toBe(12.5);
    expect(watches[0].changeHistory).toHaveLength(1);
    expect(watches[0].changeHistory[0].oldPayout).toBe(10);
    expect(watches[0].changeHistory[0].newPayout).toBe(12.5);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].metric).toBe(PAYOUT_WATCH_ALERT_METRIC);
    expect(alerts[0].severity).toBe("medium");
    expect(alerts[0].status).toBe("open");
    expect(alerts[0].message).toContain("12.5");
    expect(alerts[0].message).toContain("10");
    expect(alerts[0].message).toContain("/ai/profit");
  });

  it("dedupes alerts within 24h for the same offer", async () => {
    seedOffer(offers, 12.5);
    seedWatch(watches, 10);
    await checkAllWatches(prisma, TENANT);
    expect(alerts).toHaveLength(1);

    // Second change (12.5 → 13) must update the watch but NOT alert again.
    offers[0].commissionValue = 13;
    const summary = await checkAllWatches(prisma, TENANT);
    expect(summary.changed).toBe(1);
    expect(summary.alertsCreated).toBe(0);
    expect(alerts).toHaveLength(1);
    expect(watches[0].lastPayout).toBe(13);
    expect(watches[0].changeHistory).toHaveLength(2);
  });

  it("creates a new alert after the 24h window expires", async () => {
    seedOffer(offers, 12.5);
    seedWatch(watches, 10);
    await checkAllWatches(prisma, TENANT);
    expect(alerts).toHaveLength(1);
    // Age the alert beyond the dedupe window.
    alerts[0].createdAt = new Date(Date.now() - 25 * 3600 * 1000);
    offers[0].commissionValue = 14;
    const summary = await checkAllWatches(prisma, TENANT);
    expect(summary.alertsCreated).toBe(1);
    expect(alerts).toHaveLength(2);
  });

  it("skips disabled watches", async () => {
    seedOffer(offers, 99);
    seedWatch(watches, 10, false);
    const summary = await checkAllWatches(prisma, TENANT);
    expect(summary.checked).toBe(0);
    expect(alerts).toHaveLength(0);
    expect(watches[0].lastPayout).toBe(10);
  });

  it("no change only touches lastCheckedAt", async () => {
    seedOffer(offers, 10);
    seedWatch(watches, 10);
    const summary = await checkAllWatches(prisma, TENANT);
    expect(summary.changed).toBe(0);
    expect(summary.alertsCreated).toBe(0);
    expect(alerts).toHaveLength(0);
    expect(watches[0].lastCheckedAt).not.toBeNull();
  });

  it("scopes scans to the requested tenant", async () => {
    seedOffer(offers, 11);
    seedWatch(watches, 10);
    const other = randomUUID();
    const summary = await checkAllWatches(prisma, other);
    expect(summary.checked).toBe(0);
  });

  it("history is capped at 20 entries", async () => {
    seedOffer(offers, 12);
    seedWatch(watches, 10);
    watches[0].changeHistory = Array.from({ length: 20 }, (_, i) => ({
      oldPayout: i,
      newPayout: i + 1,
      changedAt: new Date().toISOString(),
    }));
    await checkAllWatches(prisma, TENANT);
    expect(watches[0].changeHistory).toHaveLength(20);
    expect(watches[0].changeHistory[19].newPayout).toBe(12);
  });
});

describe("enableWatch / disableWatch", () => {
  let watches: Row[];
  let offers: Row[];
  let alerts: Row[];
  let prisma: PrismaClient;

  beforeEach(() => {
    watches = [];
    offers = [];
    alerts = [];
    prisma = mkPrisma({ watches, offers, alerts });
  });

  it("enable creates a watch seeded with the current payout", async () => {
    seedOffer(offers, 8.75);
    const row = await enableWatch(prisma, TENANT, OFFER);
    expect(row.enabled).toBe(true);
    expect(row.lastPayout).toBe(8.75);
    expect(watches).toHaveLength(1);
  });

  it("enable on an existing disabled watch re-enables without resetting lastPayout", async () => {
    seedOffer(offers, 9);
    seedWatch(watches, 8, false);
    const row = await enableWatch(prisma, TENANT, OFFER);
    expect(row.enabled).toBe(true);
    expect(row.lastPayout).toBe(8);
    expect(watches).toHaveLength(1);
  });

  it("enable throws for an unknown offer", async () => {
    await expect(enableWatch(prisma, TENANT, randomUUID())).rejects.toThrow();
  });

  it("disable flips enabled=false and skips later checks", async () => {
    seedOffer(offers, 50);
    seedWatch(watches, 10);
    const row = await disableWatch(prisma, TENANT, OFFER);
    expect(row.enabled).toBe(false);
    const summary = await checkAllWatches(prisma, TENANT);
    expect(summary.checked).toBe(0);
    expect(alerts).toHaveLength(0);
  });

  it("disable throws for a nonexistent watch", async () => {
    seedOffer(offers, 10);
    await expect(disableWatch(prisma, TENANT, OFFER)).rejects.toThrow();
  });
});

describe("listWatches", () => {
  it("joins offer name and current payout", async () => {
    const watches: Row[] = [];
    const offers: Row[] = [];
    const alerts: Row[] = [];
    const prisma = mkPrisma({ watches, offers, alerts });
    seedOffer(offers, 15);
    seedWatch(watches, 10);
    watches[0].changeHistory = [
      { oldPayout: 9, newPayout: 10, changedAt: new Date().toISOString() },
    ];
    const items = await listWatches(prisma, TENANT);
    expect(items).toHaveLength(1);
    expect(items[0].offerName).toBe("测试Offer");
    expect(items[0].currentPayout).toBe(15);
    expect(items[0].lastPayout).toBe(10);
    expect(items[0].changeCount).toBe(1);
  });

  it("returns empty list for a tenant with no watches", async () => {
    const prisma = mkPrisma({ watches: [], offers: [], alerts: [] });
    expect(await listWatches(prisma, TENANT)).toEqual([]);
  });
});
