/**
 * 功能 1 — 返利比例监控（rate-watch）契约测试。
 * In-memory fake Prisma + 内存 RateCheckStore + 桩 fetchImpl，
 * Fastify inject。真实的 fetchPageHtml / SQL 由 store/fetch 注入点隔离。
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import {
  SESSION_COOKIE_NAME,
  createSession,
} from "../auth/sessions.js";
import { createObservabilityErrorHandler } from "../observability/index.js";
import {
  checkAllActiveOffers,
  compareRates,
  parseRate,
  type RateCheckRow,
  type RateCheckStore,
  type RateCheckWithOffer,
  type RatePageFetch,
} from "../services/cashback-rate-watch-service.js";
import { registerCashbackRateWatchRoutes } from "./cashback-rate-watch.js";

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      const rv = row[k];
      if ("gte" in v && !(rv >= (v as any).gte)) return false;
      if ("gt" in v && !(rv > (v as any).gt)) return false;
      if ("lt" in v && !(rv < (v as any).lt)) return false;
      if ("lte" in v && !(rv <= (v as any).lte)) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}

function mkStore(rows: Row[]) {
  function pick(row: Row, select: any): Row {
    if (!select) return { ...row };
    const out: Row = {};
    for (const k of Object.keys(select))
      if (select[k] && k in row) out[k] = row[k];
    return out;
  }
  return {
    findFirst: async ({ where, select }: any) => {
      const row = rows.find((r) => matches(r, where)) ?? null;
      return row ? pick(row, select) : null;
    },
    findUnique: async ({ where, select }: any) => {
      const row = rows.find((r) => matches(r, where)) ?? null;
      return row ? pick(row, select) : null;
    },
    findMany: async ({ where, select }: any) => {
      const out = rows.filter((r) => matches(r, where));
      if (!select) return out.map((r) => ({ ...r }));
      return out.map((r) => {
        const o: Row = {};
        for (const k of Object.keys(select))
          if (select[k] && k in r) o[k] = r[k];
        return o;
      });
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
    _rows: rows,
  };
}

interface Fake {
  tenant: ReturnType<typeof mkStore>;
  user: ReturnType<typeof mkStore>;
  session: ReturnType<typeof mkStore>;
  cashbackOffer: ReturnType<typeof mkStore>;
  alert: ReturnType<typeof mkStore>;
}

/** 内存 RateCheckStore：复用与 SQL 实现相同的语义。 */
function makeMemoryStore(): RateCheckStore & { rows: RateCheckRow[] } {
  const rows: RateCheckRow[] = [];
  const store: RateCheckStore & { rows: RateCheckRow[] } = {
    rows,
    async insert(tenantId, input) {
      const row: RateCheckRow = {
        id: randomUUID(),
        tenantId,
        cashbackOfferId: input.cashbackOfferId,
        advertisedRate: input.advertisedRate,
        detectedRate: input.detectedRate,
        rateUrl: input.rateUrl,
        status: input.status,
        checkedAt: new Date(),
      };
      rows.push(row);
      return { ...row };
    },
    async latestForOffer(tenantId, cashbackOfferId) {
      const hit = rows
        .filter((r) => r.tenantId === tenantId && r.cashbackOfferId === cashbackOfferId)
        .sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime())[0];
      return hit ? { ...hit } : null;
    },
    async latestForTenant(tenantId) {
      const latest = new Map<string, RateCheckRow>();
      for (const r of rows) {
        if (r.tenantId !== tenantId) continue;
        const cur = latest.get(r.cashbackOfferId);
        if (!cur || r.checkedAt.getTime() > cur.checkedAt.getTime())
          latest.set(r.cashbackOfferId, r);
      }
      const out: RateCheckWithOffer[] = [];
      for (const r of latest.values()) {
        const offer = (fake.cashbackOffer as any)._rows.find(
          (o: Row) => o.id === r.cashbackOfferId
        );
        if (!offer || offer.deletedAt) continue;
        out.push({
          ...r,
          cashbackNetwork: offer.cashbackNetwork,
          originalUrl: offer.originalUrl,
          offerStatus: offer.status,
        });
      }
      return out;
    },
    async historyForOffer(tenantId, cashbackOfferId, limit) {
      return rows
        .filter((r) => r.tenantId === tenantId && r.cashbackOfferId === cashbackOfferId)
        .sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime())
        .slice(0, limit)
        .map((r) => ({ ...r }));
    },
  };
  return store;
}

let fake: Fake;

function makeFakePrisma(): Fake {
  const tenants = mkStore([]);
  const users = mkStore([]);
  const sessions = mkStore([]);
  const cashbackOffers = mkStore([]);
  const alerts = mkStore([]);

  // Session findUnique with include.user (for auth).
  const baseSessionFindUnique = sessions.findUnique;
  (sessions as any).findUnique = async (args: any) => {
    const row = await baseSessionFindUnique(args);
    if (!row) return null;
    if (args?.include?.user) {
      return {
        ...row,
        user: (users._rows as Row[]).find((u) => u.id === row.userId) ?? null,
      };
    }
    return row;
  };

  return {
    tenant: tenants,
    user: users,
    session: sessions,
    cashbackOffer: cashbackOffers,
    alert: alerts,
  };
}

function cookie(token: string) {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

async function seedAuth(role: "admin" | "member" = "member") {
  const tenantId = randomUUID();
  await fake.tenant.create({
    data: { id: tenantId, name: `${role}@t`, slug: `u-${role}`, status: "ACTIVE" },
  });
  const user = await fake.user.create({
    data: {
      id: randomUUID(),
      tenantId,
      email: `${role}@example.com`,
      name: role,
      role,
      status: "ACTIVE",
    },
  });
  const session = await createSession(fake as unknown as PrismaClient, user.id);
  return { tenantId, user, token: session.token };
}

async function seedOffer(
  tenantId: string,
  extra: Partial<Row> = {}
): Promise<Row> {
  return fake.cashbackOffer.create({
    data: {
      id: randomUUID(),
      tenantId,
      cashbackNetwork: "rakuten",
      originalUrl: "https://www.merchant.example/item/123",
      trackingLinkId: null,
      adspowerProfileId: null,
      status: "active",
      deletedAt: null,
      ...extra,
    },
  });
}

async function buildApp(
  store: RateCheckStore,
  fetchImpl: RatePageFetch = async () => "本店返利 8% 回馈"
) {
  const app = Fastify({ logger: false });
  app.setErrorHandler(createObservabilityErrorHandler());
  await registerCashbackRateWatchRoutes(app, {
    prisma: fake as unknown as PrismaClient,
    rateCheckStore: store,
    fetchImpl,
  });
  return app;
}

// ---------------------------------------------------------------------------

describe("parseRate", () => {
  it("parses percent", () => {
    expect(parseRate("本店返利 8%")).toEqual({
      kind: "percent",
      value: 8,
      raw: "8%",
    });
  });
  it("parses decimal percent with space", () => {
    const r = parseRate("最高 5.5 % 返利");
    expect(r?.kind).toBe("percent");
    expect(r?.value).toBe(5.5);
  });
  it("takes the first percent", () => {
    const r = parseRate("返利 8%，限时提升至 12%");
    expect(r?.value).toBe(8);
  });
  it("parses dollar amount", () => {
    const r = parseRate("下单返 $12.5 现金");
    expect(r?.kind).toBe("amount");
    expect(r?.value).toBe(12.5);
  });
  it("returns null when nothing found", () => {
    expect(parseRate("欢迎光临本店")).toBeNull();
  });
});

describe("compareRates", () => {
  it("ok when equal", () => {
    expect(compareRates("8%", "返利 8% 回馈")).toEqual({
      status: "ok",
      detectedRate: "8%",
    });
  });
  it("mismatch on different values", () => {
    expect(compareRates("8%", "返利 3% 回馈").status).toBe("mismatch");
  });
  it("mismatch on different kinds", () => {
    expect(compareRates("8%", "下单返 $10").status).toBe("mismatch");
  });
  it("unreachable when page has no rate", () => {
    expect(compareRates("8%", "欢迎光临").status).toBe("unreachable");
  });
  it("throws on unparsable advertisedRate", () => {
    expect(() => compareRates("八个点", "返利 8%")).toThrow();
  });
});

describe("cashback rate-watch routes", () => {
  let token: string;
  let tenantId: string;
  let store: RateCheckStore & { rows: RateCheckRow[] };

  beforeEach(async () => {
    fake = makeFakePrisma();
    store = makeMemoryStore();
    ({ token, tenantId } = await seedAuth());
  });

  it("401 without session", async () => {
    const app = await buildApp(store);
    const res = await app.inject({ method: "GET", url: "/api/v1/cashback/rate-checks" });
    expect(res.statusCode).toBe(401);
  });



  it("GET returns latest check per offer", async () => {
    const offer = await seedOffer(tenantId);
    const app = await buildApp(store);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/cashback/offers/${offer.id}/rate`,
      headers: cookie(token),
      payload: { advertisedRate: "8%" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.check.status).toBe("ok");
    expect(body.check.detectedRate).toBe("8%");

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/cashback/rate-checks",
      headers: cookie(token),
    });
    expect(list.statusCode).toBe(200);
    const checks = list.json().checks as any[];
    expect(checks).toHaveLength(1);
    expect(checks[0].cashbackNetwork).toBe("rakuten");
    expect(checks[0].advertisedRate).toBe("8%");
  });

  it("POST mismatch writes an alert and dedupes within 24h", async () => {
    const offer = await seedOffer(tenantId);
    const app = await buildApp(store, async () => "返利只有 3% 啦");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/cashback/offers/${offer.id}/rate`,
      headers: cookie(token),
      payload: { advertisedRate: "8%" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.check.status).toBe("mismatch");
    expect(body.alertCreated).toBe(true);

    const alerts = (fake.alert as any)._rows as Row[];
    expect(alerts).toHaveLength(1);
    expect(alerts[0].metric).toBe("cashback_rate_mismatch");
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].data.cashbackOfferId).toBe(offer.id);

    // 第二次同样 mismatch → 24h 去重，不再写新告警。
    const res2 = await app.inject({
      method: "POST",
      url: `/api/v1/cashback/offers/${offer.id}/rate`,
      headers: cookie(token),
      payload: { advertisedRate: "8%" },
    });
    expect(res2.json().alertCreated).toBe(false);
    expect((fake.alert as any)._rows).toHaveLength(1);
  });

  it("POST unreachable when fetch throws", async () => {
    const offer = await seedOffer(tenantId);
    const app = await buildApp(store, async () => {
      throw new Error("network down");
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/cashback/offers/${offer.id}/rate`,
      headers: cookie(token),
      payload: { advertisedRate: "8%" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().check.status).toBe("unreachable");
  });

  it("POST rejects bad advertisedRate / bad rateUrl / unknown offer", async () => {
    const offer = await seedOffer(tenantId);
    const app = await buildApp(store);
    const bad1 = await app.inject({
      method: "POST",
      url: `/api/v1/cashback/offers/${offer.id}/rate`,
      headers: cookie(token),
      payload: { advertisedRate: "八个点" },
    });
    expect(bad1.statusCode).toBe(400);

    const bad2 = await app.inject({
      method: "POST",
      url: `/api/v1/cashback/offers/${offer.id}/rate`,
      headers: cookie(token),
      payload: { advertisedRate: "8%", rateUrl: "ftp://x.example/a" },
    });
    expect(bad2.statusCode).toBe(400);

    const notFound = await app.inject({
      method: "POST",
      url: `/api/v1/cashback/offers/${randomUUID()}/rate`,
      headers: cookie(token),
      payload: { advertisedRate: "8%" },
    });
    expect(notFound.statusCode).toBe(404);
  });

  it("tenant isolation: cannot set rate on another tenant's offer", async () => {
    const other = await seedAuth("member");
    const offer = await seedOffer(other.tenantId);
    const app = await buildApp(store);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/cashback/offers/${offer.id}/rate`,
      headers: cookie(token),
      payload: { advertisedRate: "8%" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("checkAllActiveOffers skips offers without advertisedRate and never throws", async () => {
    await seedOffer(tenantId); // 未设置 advertisedRate → 跳过
    const configured = await seedOffer(tenantId);
    await store.insert(tenantId, {
      cashbackOfferId: configured.id,
      advertisedRate: "8%",
      detectedRate: null,
      rateUrl: null,
      status: "ok",
    });
    const summary = await checkAllActiveOffers(
      fake as unknown as PrismaClient,
      tenantId,
      { store, fetchImpl: async () => "返利 8%" }
    );
    expect(summary.skippedNoConfig).toBe(1);
    expect(summary.checked).toBe(1);
    expect(summary.ok).toBe(1);
  });
});
