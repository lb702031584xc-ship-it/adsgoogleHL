/**
 * 功能 2 — terms-watch service tests.
 * In-memory fake Prisma; no network, no database.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import {
  checkAllTermsWatches,
  checkTermsWatch,
  classifyTermsText,
  computeTermsHash,
  normalizeMerchantDomain,
  TERMS_WATCH_ALERT_METRIC,
  type CashbackTermsWatchRow,
  type TermsWatchLog,
} from "./cashback-terms-watch-service.js";

const TENANT = randomUUID();
const DOMAIN = "www.merchant.example";

const silentLog: TermsWatchLog = {
  info: () => undefined,
  error: () => undefined,
};

function matchesWhere(row: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    const rv = row?.[k];
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const ops = ["gt", "gte", "lt", "lte", "contains", "in"];
      if (Object.keys(v).some((op) => ops.includes(op))) {
        return Object.entries(v).every(([op, ov]) => {
          const a = rv instanceof Date ? rv.getTime() : rv;
          const b = ov instanceof Date ? (ov as Date).getTime() : ov;
          switch (op) {
            case "gt":
              return a > b;
            case "gte":
              return a >= b;
            case "lt":
              return a < b;
            case "lte":
              return a <= b;
            case "contains":
              return typeof rv === "string" && rv.includes(ov as string);
            case "in":
              return Array.isArray(ov) && ov.includes(rv);
            default:
              return true;
          }
        });
      }
      return matchesWhere(rv, v); // nested relation filter (e.g. offer: {...})
    }
    if (v === null) return rv === null || rv === undefined;
    return rv === v;
  });
}

function mkWatchStore(rows: CashbackTermsWatchRow[]) {
  return {
    findMany: async ({ where }: any = {}) =>
      rows.filter((r) => matchesWhere(r, where)).map((r) => ({ ...r })),
    findFirst: async ({ where }: any = {}) => {
      const r = rows.find((r) => matchesWhere(r, where));
      return r ? { ...r } : null;
    },
    create: async ({ data }: any) => {
      const now = new Date();
      const row = { ...data, createdAt: now, updatedAt: now };
      rows.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("watch not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return { ...row };
    },
  };
}

function mkLinkStore(rows: any[]) {
  return {
    findMany: async ({ where, select }: any = {}) => {
      let out = rows.filter((r) => matchesWhere(r, where));
      if (select) {
        out = out.map((r) => {
          const o: any = {};
          for (const k of Object.keys(select)) if (select[k]) o[k] = r[k];
          return o;
        });
      }
      return out;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("link not found");
      Object.assign(row, data);
      return { ...row };
    },
  };
}

function mkAlertStore(rows: any[]) {
  return {
    findMany: async ({ where, select }: any = {}) => {
      let out = rows.filter((r) => matchesWhere(r, where));
      if (select) {
        out = out.map((r) => {
          const o: any = {};
          for (const k of Object.keys(select)) if (select[k]) o[k] = r[k];
          return o;
        });
      }
      return out;
    },
    create: async ({ data }: any) => {
      const now = new Date();
      const row = { ...data, createdAt: now, updatedAt: now };
      rows.push(row);
      return { ...row };
    },
  };
}

function mkWatch(overrides: Partial<CashbackTermsWatchRow> = {}): CashbackTermsWatchRow {
  const now = new Date();
  return {
    id: randomUUID(),
    tenantId: TENANT,
    merchantName: "Test Merchant",
    merchantDomain: DOMAIN,
    termsUrl: "https://www.merchant.example/terms",
    termsHash: null,
    cashbackAllowed: null,
    lastChecked: null,
    status: "ok",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function mkPrisma(watches: CashbackTermsWatchRow[], links: any[], alerts: any[]) {
  return {
    cashbackTermsWatch: mkWatchStore(watches),
    trackingLink: mkLinkStore(links),
    alert: mkAlertStore(alerts),
  } as unknown as PrismaClient;
}

function textFetcher(text: string) {
  return async () => ({ text, finalUrl: "https://www.merchant.example/terms" });
}

const ALLOWED_TEXT =
  "Our affiliate program welcomes cashback websites. Cashback traffic is allowed and encouraged.";
const PROHIBITED_TEXT =
  "Cashback websites are strictly prohibited. Incentivized traffic is not allowed on this program.";
const PROHIBITED_CN_TEXT =
  "本计划禁止返利流量，任何返利网站不得参与，违者将被移除。";
const NEUTRAL_TEXT = "Welcome to our partner program. Please read the terms carefully.";

describe("classifyTermsText", () => {
  it("detects prohibited cashback terms (EN)", () => {
    const c = classifyTermsText(PROHIBITED_TEXT);
    expect(c.cashbackAllowed).toBe(false);
    expect(c.prohibitedSignals.length).toBeGreaterThan(0);
  });

  it("detects prohibited cashback terms (CN)", () => {
    expect(classifyTermsText(PROHIBITED_CN_TEXT).cashbackAllowed).toBe(false);
  });

  it("detects incentivized + prohibit combination", () => {
    expect(
      classifyTermsText("Incentivized traffic is forbidden for all partners.").cashbackAllowed
    ).toBe(false);
  });

  it("detects allowed cashback terms", () => {
    expect(classifyTermsText(ALLOWED_TEXT).cashbackAllowed).toBe(true);
  });

  it("returns null for unknown text", () => {
    expect(classifyTermsText(NEUTRAL_TEXT).cashbackAllowed).toBe(null);
  });

  it("returns null when text mentions nothing about cashback", () => {
    expect(classifyTermsText("All affiliates are welcome here.").cashbackAllowed).toBe(null);
  });
});

describe("computeTermsHash / normalizeMerchantDomain", () => {
  it("is deterministic and sensitive to content", () => {
    const a = computeTermsHash("hello");
    expect(computeTermsHash("hello")).toBe(a);
    expect(computeTermsHash("hello ")).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("normalizes domains", () => {
    expect(normalizeMerchantDomain("https://WWW.Foo.com/terms?a=1")).toBe("www.foo.com");
    expect(normalizeMerchantDomain("bar.example")).toBe("bar.example");
    expect(normalizeMerchantDomain("not a domain")).toBe(null);
    expect(normalizeMerchantDomain("")).toBe(null);
  });
});

describe("checkTermsWatch", () => {
  let watches: CashbackTermsWatchRow[];
  let links: any[];
  let alerts: any[];

  beforeEach(() => {
    watches = [];
    links = [];
    alerts = [];
  });

  it("first check stores hash (baseline), status changed, no alert/pause", async () => {
    watches.push(mkWatch());
    const prisma = mkPrisma(watches, links, alerts);
    const result = await checkTermsWatch(prisma, watches[0]!, {
      fetchPage: textFetcher(ALLOWED_TEXT),
      log: silentLog,
    });
    // 首次检查无历史 hash → 视为变化并建立基线，但非禁止条款不告警
    expect(result.status).toBe("changed");
    expect(result.hashChanged).toBe(true);
    expect(result.cashbackAllowed).toBe(true);
    expect(result.prohibitedNewly).toBe(false);
    expect(result.alertCreated).toBe(false);
    expect(result.pausedLinks).toBe(0);
    expect(watches[0]!.termsHash).toBe(computeTermsHash(ALLOWED_TEXT));
    expect(watches[0]!.lastChecked).not.toBe(null);
  });

  it("unchanged hash → ok, no alert", async () => {
    watches.push(mkWatch({ termsHash: computeTermsHash(ALLOWED_TEXT), cashbackAllowed: true }));
    const prisma = mkPrisma(watches, links, alerts);
    const result = await checkTermsWatch(prisma, watches[0]!, {
      fetchPage: textFetcher(ALLOWED_TEXT),
      log: silentLog,
    });
    expect(result.status).toBe("ok");
    expect(result.hashChanged).toBe(false);
    expect(alerts).toHaveLength(0);
  });

  it("hash changed + newly prohibited → critical alert + pause matching links", async () => {
    watches.push(
      mkWatch({ termsHash: computeTermsHash(ALLOWED_TEXT), cashbackAllowed: true })
    );
    links.push(
      { id: randomUUID(), tenantId: TENANT, status: "ACTIVE", offer: { destinationUrl: `https://${DOMAIN}/p/1` } },
      { id: randomUUID(), tenantId: TENANT, status: "ACTIVE", offer: { destinationUrl: `https://${DOMAIN}/p/2` } },
      { id: randomUUID(), tenantId: TENANT, status: "ACTIVE", offer: { destinationUrl: "https://other.example/x" } },
      { id: randomUUID(), tenantId: TENANT, status: "PAUSED", offer: { destinationUrl: `https://${DOMAIN}/p/3` } }
    );
    const prisma = mkPrisma(watches, links, alerts);
    const result = await checkTermsWatch(prisma, watches[0]!, {
      fetchPage: textFetcher(PROHIBITED_TEXT),
      log: silentLog,
    });
    expect(result.status).toBe("changed");
    expect(result.hashChanged).toBe(true);
    expect(result.cashbackAllowed).toBe(false);
    expect(result.prohibitedNewly).toBe(true);
    expect(result.pausedLinks).toBe(2);
    expect(result.alertCreated).toBe(true);

    // only the two ACTIVE matching links paused
    expect(links.filter((l) => l.status === "PAUSED")).toHaveLength(3);
    expect(
      links.find((l) => l.offer.destinationUrl.includes("other.example"))!.status
    ).toBe("ACTIVE");

    expect(alerts).toHaveLength(1);
    expect(alerts[0].metric).toBe(TERMS_WATCH_ALERT_METRIC);
    expect(alerts[0].severity).toBe("critical");
    expect(alerts[0].tenantId).toBe(TENANT);
    expect(alerts[0].data.watchId).toBe(watches[0]!.id);
    expect(alerts[0].data.pausedLinkIds).toHaveLength(2);
  });

  it("does not alert twice within 24h for the same watch", async () => {
    const watchId = randomUUID();
    watches.push(
      mkWatch({ id: watchId, termsHash: computeTermsHash("old text"), cashbackAllowed: null })
    );
    alerts.push({
      id: randomUUID(),
      tenantId: TENANT,
      metric: TERMS_WATCH_ALERT_METRIC,
      severity: "critical",
      status: "open",
      createdAt: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
      data: { watchId },
    });
    const prisma = mkPrisma(watches, links, alerts);
    const result = await checkTermsWatch(prisma, watches[0]!, {
      fetchPage: textFetcher(PROHIBITED_TEXT),
      log: silentLog,
    });
    expect(result.prohibitedNewly).toBe(true);
    expect(result.alertCreated).toBe(false);
    expect(alerts).toHaveLength(1);
  });

  it("does not re-alert when terms were already prohibited (no new appearance)", async () => {
    watches.push(
      mkWatch({ termsHash: computeTermsHash("older text"), cashbackAllowed: false })
    );
    const prisma = mkPrisma(watches, links, alerts);
    const result = await checkTermsWatch(prisma, watches[0]!, {
      fetchPage: textFetcher(PROHIBITED_TEXT),
      log: silentLog,
    });
    expect(result.status).toBe("changed");
    expect(result.prohibitedNewly).toBe(false);
    expect(result.alertCreated).toBe(false);
    expect(alerts).toHaveLength(0);
  });

  it("fetch failure → blocked, no throw", async () => {
    watches.push(mkWatch({ termsHash: computeTermsHash(ALLOWED_TEXT), cashbackAllowed: true }));
    const prisma = mkPrisma(watches, links, alerts);
    const result = await checkTermsWatch(prisma, watches[0]!, {
      fetchPage: async () => {
        throw new Error("network error");
      },
      log: silentLog,
    });
    expect(result.status).toBe("blocked");
    expect(result.error).toBe("network error");
    expect(result.pausedLinks).toBe(0);
    expect(watches[0]!.status).toBe("blocked");
    // hash 不应被覆盖
    expect(watches[0]!.termsHash).toBe(computeTermsHash(ALLOWED_TEXT));
  });
});

describe("checkAllTermsWatches", () => {
  it("isolates per-watch failures and summarizes", async () => {
    const w1 = mkWatch({ merchantName: "ok-watch" });
    const w2 = mkWatch({ merchantName: "blocked-watch" });
    const prisma = mkPrisma([w1, w2], [], []);
    let calls = 0;
    const summary = await checkAllTermsWatches(prisma, TENANT, {
      log: silentLog,
      fetchPage: async () => {
        calls += 1;
        if (calls === 2) throw new Error("boom");
        return { text: ALLOWED_TEXT, finalUrl: "https://x" };
      },
    });
    expect(summary.checked).toBe(2);
    expect(summary.blocked).toBe(1);
    expect(summary.criticalAlerts).toBe(0);
  });
});
