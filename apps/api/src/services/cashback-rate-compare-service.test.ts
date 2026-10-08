/**
 * Feature 5 — rate-compare service tests.
 * In-memory fake Prisma ($queryRaw/$executeRaw + alert delegate); no network, no database.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import {
  CASHBACK_RATE_BETTER_DEAL_METRIC,
  createGroup,
  extractRateFromPage,
  getGroup,
  listGroups,
  parseRateNumber,
  pickBest,
  runGroupCheck,
  validateGroupInput,
  type CompareGroupRow,
  type FetchPageFn,
  type RateSnapshotRow,
} from "./cashback-rate-compare-service.js";

const TENANT = randomUUID();

interface Store {
  groups: any[];
  snapshots: any[];
  alerts: any[];
}

function makeFakePrisma(store: Store): PrismaClient {
  const fake: any = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: any[]) => {
      const sql = strings.raw.join("?");
      if (sql.includes("FROM cashback_compare_groups")) {
        const tenantId = values[0];
        let rows = store.groups.filter((g) => g.tenantId === tenantId);
        if (sql.includes("AND id =")) rows = rows.filter((g) => g.id === values[1]);
        return rows.map((g) => ({
          id: g.id,
          tenantId: g.tenantId,
          name: g.name,
          merchantDomain: g.merchantDomain,
          portals: g.portals,
          createdAt: g.createdAt,
        }));
      }
      if (sql.includes("FROM cashback_rate_snapshots")) {
        const tenantId = values[0];
        const merchantDomain = values[1];
        return store.snapshots
          .filter((s) => s.tenantId === tenantId && s.merchantDomain === merchantDomain)
          .map((s) => ({
            id: s.id,
            tenantId: s.tenantId,
            merchantDomain: s.merchantDomain,
            portal: s.portal,
            rate: s.rate,
            url: s.url,
            checkedAt: s.checkedAt,
          }));
      }
      throw new Error(`unhandled query: ${sql.slice(0, 80)}`);
    },
    $executeRaw: async (strings: TemplateStringsArray, ...values: any[]) => {
      const sql = strings.raw.join("?");
      if (sql.includes("INTO cashback_compare_groups")) {
        store.groups.push({
          id: values[0],
          tenantId: values[1],
          name: values[2],
          merchantDomain: values[3],
          portals: JSON.parse(values[4]),
          createdAt: values[5],
        });
        return 1;
      }
      if (sql.includes("INTO cashback_rate_snapshots")) {
        store.snapshots.push({
          id: values[0],
          tenantId: values[1],
          merchantDomain: values[2],
          portal: values[3],
          rate: values[4],
          url: values[5],
          checkedAt: values[6],
        });
        return 1;
      }
      throw new Error(`unhandled execute: ${sql.slice(0, 80)}`);
    },
    alert: {
      findMany: async ({ where }: any) => {
        const since = (where?.createdAt as any)?.gt as Date | undefined;
        return store.alerts
          .filter((a) => a.tenantId === where?.tenantId)
          .filter((a) => a.metric === where?.metric)
          .filter((a) => a.status === where?.status)
          .filter((a) => (since ? a.createdAt > since : true))
          .map((a) => ({ id: a.id, data: a.data }));
      },
      create: async ({ data }: any) => {
        const row = { ...data, createdAt: new Date() };
        store.alerts.push(row);
        return row;
      },
    },
  };
  return fake as PrismaClient;
}

/** Build a fetch stub from a map of url → page text (missing = throw). */
function fetchStub(pages: Record<string, string>): FetchPageFn {
  return async (url: string) => {
    if (!(url in pages)) throw new Error("network down");
    return {
      finalUrl: url,
      html: "",
      text: pages[url],
      statusCode: 200,
      redirectChain: [],
      fetchMs: 5,
    };
  };
}

let store: Store;
let prisma: PrismaClient;
let group: CompareGroupRow;

beforeEach(async () => {
  store = { groups: [], snapshots: [], alerts: [] };
  prisma = makeFakePrisma(store);
  group = await createGroup(prisma, TENANT, {
    name: "测试分组",
    merchantDomain: "shop.example.com",
    portals: [
      { name: "Rakuten", url: "https://portal.example/rakuten/shop" },
      { name: "55haitao", url: "https://portal.example/55/shop" },
      { name: "TopCashback", url: "https://portal.example/top/shop" },
    ],
  });
});

describe("parseRateNumber", () => {
  it("parses integer and decimal percentages", () => {
    expect(parseRateNumber("8%")).toBe(8);
    expect(parseRateNumber("8.5%")).toBe(8.5);
    expect(parseRateNumber("最高 12.25% 返利")).toBe(12.25);
  });
  it("returns null when unparseable", () => {
    expect(parseRateNumber(null)).toBeNull();
    expect(parseRateNumber("")).toBeNull();
    expect(parseRateNumber("暂无返利")).toBeNull();
  });
});

describe("extractRateFromPage", () => {
  it("takes the first percentage from text", () => {
    expect(extractRateFromPage({ text: "立即领取 8% cash back" })).toBe("8%");
    expect(extractRateFromPage({ text: "没有数字" })).toBeNull();
  });
});

describe("pickBest", () => {
  it("ignores unparseable portals", () => {
    const best = pickBest([
      { portal: "A", url: "u", rate: null, rateValue: null, ok: false },
      { portal: "B", url: "u", rate: "5%", rateValue: 5, ok: true },
      { portal: "C", url: "u", rate: "7%", rateValue: 7, ok: true },
    ]);
    expect(best?.portal).toBe("C");
  });
  it("returns null when nothing is parseable", () => {
    expect(pickBest([])).toBeNull();
  });
});

describe("group CRUD", () => {
  it("creates, gets and lists groups within the tenant", async () => {
    const fetched = await getGroup(prisma, TENANT, group.id);
    expect(fetched.name).toBe("测试分组");
    expect(fetched.portals).toHaveLength(3);
    const items = await listGroups(prisma, TENANT);
    expect(items).toHaveLength(1);
    // Other tenants see nothing (isolation).
    expect(await listGroups(prisma, randomUUID())).toHaveLength(0);
  });

  it("rejects invalid input", () => {
    expect(() =>
      validateGroupInput({ name: "", merchantDomain: "x.com", portals: [{ name: "a", url: "https://a" }] })
    ).toThrow();
    expect(() =>
      validateGroupInput({ name: "n", merchantDomain: "x.com", portals: [] })
    ).toThrow();
    expect(() =>
      validateGroupInput({
        name: "n",
        merchantDomain: "x.com",
        portals: [{ name: "a", url: "ftp://a" }],
      })
    ).toThrow();
  });
});

describe("runGroupCheck", () => {
  it("records a snapshot per portal and reports the best", async () => {
    const result = await runGroupCheck(prisma, TENANT, group, {
      fetchPage: fetchStub({
        "https://portal.example/rakuten/shop": "earn 6% cash back today",
        "https://portal.example/55/shop": "返利 6.5% 高返",
        "https://portal.example/top/shop": "up to 5% back",
      }),
    });
    expect(result.results).toHaveLength(3);
    expect(result.results.map((r) => r.rate)).toEqual(["6%", "6.5%", "5%"]);
    expect(store.snapshots).toHaveLength(3);
    expect(result.bestPortal).toBe("55haitao");
    // Diff 0.5pp < 1 → no alert.
    expect(result.alertCreated).toBe(false);
    expect(store.alerts).toHaveLength(0);
  });

  it("raises a suggestion alert when the best beats the primary by >= 1pp", async () => {
    const result = await runGroupCheck(prisma, TENANT, group, {
      fetchPage: fetchStub({
        "https://portal.example/rakuten/shop": "6% cash back",
        "https://portal.example/55/shop": "8% 返利",
        "https://portal.example/top/shop": "5% back",
      }),
    });
    expect(result.bestPortal).toBe("55haitao");
    expect(result.alertCreated).toBe(true);
    expect(store.alerts).toHaveLength(1);
    const alert = store.alerts[0];
    expect(alert.metric).toBe(CASHBACK_RATE_BETTER_DEAL_METRIC);
    expect(alert.severity).toBe("info");
    expect(alert.message).toContain("shop.example.com");
    expect(alert.message).toContain("55haitao");
    expect(alert.message).toContain("8%");
    expect(alert.message).toContain("可考虑切换");
    expect(alert.data.groupId).toBe(group.id);
    expect(alert.data.diff).toBe(2);
  });

  it("does not alert when the primary portal is already the best", async () => {
    const result = await runGroupCheck(prisma, TENANT, group, {
      fetchPage: fetchStub({
        "https://portal.example/rakuten/shop": "10% cash back",
        "https://portal.example/55/shop": "8% 返利",
        "https://portal.example/top/shop": "5% back",
      }),
    });
    expect(result.bestPortal).toBe("Rakuten");
    expect(result.alertCreated).toBe(false);
    expect(store.alerts).toHaveLength(0);
  });

  it("a failed portal fetch is recorded as null and does not block others", async () => {
    const result = await runGroupCheck(prisma, TENANT, group, {
      fetchPage: fetchStub({
        "https://portal.example/rakuten/shop": "6% cash back",
        // 55haitao throws (missing from stub) → null rate
        "https://portal.example/top/shop": "5% back",
      }),
    });
    const failed = result.results.find((r) => r.portal === "55haitao");
    expect(failed?.rate).toBeNull();
    expect(failed?.rateValue).toBeNull();
    expect(store.snapshots).toHaveLength(3);
    expect(store.snapshots.find((s) => s.portal === "55haitao").rate).toBeNull();
    // Best must be chosen among the parseable ones.
    expect(result.bestPortal).toBe("Rakuten");
  });

  it("dedupes the suggestion alert within 24h for the same group", async () => {
    const fetch = fetchStub({
      "https://portal.example/rakuten/shop": "6% cash back",
      "https://portal.example/55/shop": "9% 返利",
      "https://portal.example/top/shop": "5% back",
    });
    const first = await runGroupCheck(prisma, TENANT, group, { fetchPage: fetch });
    const second = await runGroupCheck(prisma, TENANT, group, { fetchPage: fetch });
    expect(first.alertCreated).toBe(true);
    expect(second.alertCreated).toBe(false);
    expect(store.alerts).toHaveLength(1);
    // Snapshots are still written on the second run.
    expect(store.snapshots).toHaveLength(6);
  });
});
