/**
 * 功能5 — 测试点击链路验证.
 *
 * Part A: POST /api/v1/tracking/test-click route tests (fake prisma +
 *         mock fetch): hop report structure, isTest Click write, test
 *         marker propagation, no conversion postback.
 * Part B: isolation tests — test clicks are excluded from every
 *         stats / profit / monitoring aggregation:
 *         getOfferPerformance, runMonitorScan, evaluateKillSwitch,
 *         buildAuditReport, orchestrator trafficSummary / planKeywords.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fakes need loose rows */
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
  registerTestClickRoutes,
  extractAffiliateLink,
  withTestMarker,
  TEST_CLICK_HEADER,
  TEST_CLICK_MARKER_PARAM,
  type FetchLike,
} from "./test-click.js";
import { getOfferPerformance } from "../stats/offer-performance.js";
import { runMonitorScan } from "../monitoring/monitor-service.js";
import { evaluateKillSwitch } from "../killswitch/engine.js";
import { buildAuditReport } from "./traffic-intel.js";
import { trafficSummary, planKeywords } from "../ai/orchestrator.js";

type Row = Record<string, any>;

/* ------------------------------------------------------------------ */
/* In-memory prisma fake (matches() extended for isTest + click join)  */
/* ------------------------------------------------------------------ */

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    // Prisma relation filter used by aggregations:
    // click: { offerId?, trackingLinkId?, isTest?: { not: true } }
    // Conversion/order rows carry denormalized offerId + clickIsTest.
    if (k === "click" && v !== null && typeof v === "object") {
      const rel = v as Row;
      if (
        typeof rel.offerId === "string" &&
        row.offerId !== rel.offerId
      )
        return false;
      if (
        typeof rel.trackingLinkId === "string" &&
        row.trackingLinkId !== rel.trackingLinkId
      )
        return false;
      if (
        rel.isTest !== null &&
        typeof rel.isTest === "object" &&
        "not" in (rel.isTest as Row)
      ) {
        if (row.clickIsTest === (rel.isTest as Row).not) return false;
      }
      return true;
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      const rv = row[k];
      if ("gte" in v && !(rv >= (v as any).gte)) return false;
      if ("lt" in v && !(rv < (v as any).lt)) return false;
      if ("lte" in v && !(rv <= (v as any).lte)) return false;
      if ("in" in v && !((v as any).in as any[]).includes(rv)) return false;
      if ("not" in v) {
        const n = (v as any).not;
        if (n === null) return rv !== null && rv !== undefined;
        return rv !== n;
      }
      if ("notIn" in v && ((v as any).notIn as any[]).includes(rv))
        return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}

function sortRows(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows;
  const [key, dir] = Object.entries(orderBy)[0] as [string, string];
  const out = [...rows];
  out.sort((a, b) => {
    const av = a[key] instanceof Date ? a[key].getTime() : a[key];
    const bv = b[key] instanceof Date ? b[key].getTime() : b[key];
    if (av === bv) return 0;
    return dir === "desc" ? (bv > av ? 1 : -1) : av > bv ? 1 : -1;
  });
  return out;
}

function mkStore(rows: Row[]) {
  return {
    /** Test-only: bulk-seed rows. */
    pushRows: (r: Row[]) => {
      rows.push(...r);
    },
    findFirst: async ({ where, orderBy }: any) =>
      sortRows(rows.filter((r) => matches(r, where)), orderBy)[0] ?? null,
    findUnique: async ({ where, include }: any) => {
      const row = rows.find((r) => matches(r, where)) ?? null;
      if (!row) return null;
      const out = { ...row };
      if (include?.merchant) out.merchant = (row as any).merchant ?? null;
      return out;
    },
    findMany: async ({ where, orderBy, take, skip, select, include }: any) => {
      let out = sortRows(rows.filter((r) => matches(r, where)), orderBy);
      if (typeof skip === "number") out = out.slice(skip);
      if (typeof take === "number") out = out.slice(0, take);
      return out.map((r) => ({ ...r }));
    },
    create: async ({ data }: any) => {
      const row = {
        id: data.id ?? randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...data,
      };
      rows.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return { ...row };
    },
    count: async ({ where }: any) =>
      rows.filter((r) => matches(r, where)).length,
    aggregate: async ({ _sum, where }: any) => {
      const out: any = { _sum: {} };
      if (_sum) {
        for (const field of Object.keys(_sum)) {
          const vals = rows
            .filter((r) => matches(r, where))
            .map((r) => Number(r[field] ?? 0));
          out._sum[field] = vals.length
            ? vals.reduce((a, b) => a + b, 0)
            : null;
        }
      }
      return out;
    },
    groupBy: async ({ by, where, _count, orderBy, take }: any) => {
      const filtered = rows.filter((r) => matches(r, where));
      const groups = new Map<string, Row>();
      for (const r of filtered) {
        const key = JSON.stringify(by.map((b: string) => r[b] ?? null));
        if (!groups.has(key)) {
          const g: Row = {};
          for (const b of by) g[b] = r[b] ?? null;
          g._count = {};
          groups.set(key, g);
        }
        const g = groups.get(key)!;
        if (_count?._all) g._count._all = (g._count._all ?? 0) + 1;
        for (const f of Object.keys(_count ?? {})) {
          if (f === "_all") continue;
          if (r[f] !== null && r[f] !== undefined) {
            g._count[f] = (g._count[f] ?? 0) + 1;
          }
        }
      }
      let out = [...groups.values()];
      if (typeof take === "number") out = out.slice(0, take);
      return out;
    },
  };
}

const TENANT = "11111111-1111-4111-8111-111111111111";
const OFFER = "22222222-2222-4222-8222-222222222222";
const TRACKING_LINK = "33333333-3333-4333-8333-333333333333";
const LANDING_PAGE = "44444444-4444-4444-8444-444444444444";
const LP_URL = "https://lp.example.com/page";
const AFF_URL = "https://aff.example.net/go?x=1";
const MERCHANT_URL = "https://merchant.example.com/product";

/* ------------------------------------------------------------------ */
/* Part A — route tests                                                */
/* ------------------------------------------------------------------ */

function makeRouteFake() {
  const users: Row[] = [];
  const sessions: Row[] = [];
  const createdClicks: Row[] = [];
  const conversionCalls: any[] = [];
  return {
    user: mkStore(users),
    session: {
      create: async ({ data }: any) => {
        const row = { createdAt: new Date(), ...data };
        sessions.push(row);
        return { ...row };
      },
      findUnique: async ({ where, include }: any) => {
        const row =
          sessions.find((r) => r.tokenHash === where.tokenHash) ?? null;
        if (!row) return null;
        const out = { ...row } as Row;
        if (include?.user) {
          out.user = users.find((u) => u.id === row.userId) ?? null;
        }
        return out;
      },
      delete: async () => null,
    },
    tenant: mkStore([]),
    trackingLink: mkStore([
      {
        id: TRACKING_LINK,
        tenantId: TENANT,
        publicId: "pub-test-1",
        status: "ACTIVE",
        offerId: OFFER,
        landingPageId: LANDING_PAGE,
        deletedAt: null,
      },
    ]),
    offer: mkStore([{ id: OFFER, tenantId: TENANT, status: "ACTIVE" }]),
    landingPage: mkStore([
      {
        id: LANDING_PAGE,
        tenantId: TENANT,
        status: "ACTIVE",
        url: LP_URL,
        offerId: OFFER,
      },
    ]),
    click: {
      create: async ({ data }: any) => {
        createdClicks.push(data);
        return { id: data.id, clickId: data.clickId };
      },
    },
    conversion: {
      create: async (args: any) => {
        conversionCalls.push(args);
        throw new Error("conversion postback must never fire for test clicks");
      },
    },
    _users: users,
    _createdClicks: createdClicks,
    _conversionCalls: conversionCalls,
  };
}
type RouteFake = ReturnType<typeof makeRouteFake>;

async function seedRouteAuth(fake: RouteFake): Promise<string> {
  const user = await (fake as any).user.create({
    data: {
      id: randomUUID(),
      tenantId: TENANT,
      email: "member@example.com",
      name: "member",
      role: "member",
      status: "ACTIVE",
    },
  });
  const session = await createSession(fake as unknown as PrismaClient, user.id);
  return session.token;
}

interface MockResp {
  status: number;
  location?: string;
  body?: string;
}

function makeMockFetch(scenario: Record<string, MockResp>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, headers: { ...(init?.headers ?? {}) } });
    const key = Object.keys(scenario).find((k) => url.startsWith(k));
    if (!key) throw new Error(`unexpected fetch in test: ${url}`);
    const s = scenario[key];
    return {
      status: s.status,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "location" ? (s.location ?? null) : null,
      },
      text: async () => s.body ?? "",
    };
  };
  return { fn, calls };
}

const FULL_CHAIN: Record<string, MockResp> = {
  [LP_URL]: {
    status: 200,
    body: `<html><body><a href="${AFF_URL}">Buy now</a></body></html>`,
  },
  [AFF_URL]: { status: 302, location: MERCHANT_URL },
  [MERCHANT_URL]: { status: 200, body: "<html><body>merchant</body></html>" },
};

describe("POST /api/v1/tracking/test-click", () => {
  let fake: RouteFake;
  let token: string;
  let app: any;

  async function buildApp(fetchImpl: FetchLike) {
    const a = Fastify({ logger: false });
    a.setErrorHandler(createObservabilityErrorHandler());
    await registerTestClickRoutes(a, {
      prisma: fake as unknown as PrismaClient,
      fetchImpl,
    });
    return a;
  }

  beforeEach(async () => {
    fake = makeRouteFake();
    token = await seedRouteAuth(fake);
    app = await buildApp(makeMockFetch(FULL_CHAIN).fn);
  });

  const authed = (body: unknown) => ({
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    payload: body,
  });

  it("requires session auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tracking/test-click",
      payload: { trackingLinkId: TRACKING_LINK },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an invalid trackingLinkId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tracking/test-click",
      ...authed({ trackingLinkId: "not-a-uuid" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("404s on an unknown tracking link", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tracking/test-click",
      ...authed({ trackingLinkId: randomUUID() }),
    });
    expect(res.statusCode).toBe(404);
  });

  it("simulates the full chain and returns a hop-by-hop report", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tracking/test-click",
      ...authed({ trackingLinkId: TRACKING_LINK }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.ok).toBe(true);
    expect(body.trackingLinkId).toBe(TRACKING_LINK);
    expect(body.publicId).toBe("pub-test-1");
    expect(body.isTestClick).toBe(true);
    expect(body.conversionPostbackSkipped).toBe(true);
    expect(body.chainOk).toBe(true);
    expect(typeof body.clickId).toBe("string");

    // Hop report structure: every hop carries the required fields.
    expect(Array.isArray(body.hops)).toBe(true);
    expect(body.hops.length).toBe(4);
    for (const h of body.hops) {
      expect(typeof h.hop).toBe("number");
      expect(typeof h.url).toBe("string");
      expect(h.httpStatus === null || typeof h.httpStatus === "number").toBe(
        true
      );
      expect(typeof h.ms).toBe("number");
      expect(typeof h.deviated).toBe("boolean");
    }

    const [tracking, landing, affiliate, final] = body.hops;
    expect(tracking.label).toBe("tracking");
    expect(tracking.httpStatus).toBe(302);
    expect(tracking.url).toContain("/api/v1/t/pub-test-1");
    expect(tracking.expectedUrl).toBe(LP_URL);
    expect(tracking.deviated).toBe(false);

    expect(landing.label).toBe("landing-page");
    expect(landing.httpStatus).toBe(200);
    expect(landing.url.startsWith(LP_URL)).toBe(true);
    expect(landing.expectedUrl).toBe(LP_URL);
    expect(landing.deviated).toBe(false);

    expect(affiliate.label).toBe("affiliate");
    expect(affiliate.httpStatus).toBe(302);
    expect(affiliate.deviated).toBe(false);

    expect(final.label).toBe("final");
    expect(final.httpStatus).toBe(200);
    expect(final.url.startsWith(MERCHANT_URL)).toBe(true);
    expect(final.deviated).toBe(false);
  });

  it("writes the Click with isTest=true and never fires conversion postback", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tracking/test-click",
      ...authed({ trackingLinkId: TRACKING_LINK }),
    });
    expect(res.statusCode).toBe(200);
    expect(fake._createdClicks.length).toBe(1);
    const data = fake._createdClicks[0];
    expect(data.isTest).toBe(true);
    expect(data.trackingLinkId).toBe(TRACKING_LINK);
    expect(data.tenantId).toBe(TENANT);
    expect(data.queryParameters[TEST_CLICK_MARKER_PARAM]).toBe("1");
    // No conversion / postback path was ever touched.
    expect(fake._conversionCalls.length).toBe(0);
  });

  it("propagates the test marker on every hop", async () => {
    const mock = makeMockFetch(FULL_CHAIN);
    const app2 = await buildApp(mock.fn);
    const res = await app2.inject({
      method: "POST",
      url: "/api/v1/tracking/test-click",
      ...authed({ trackingLinkId: TRACKING_LINK }),
    });
    expect(res.statusCode).toBe(200);
    // landing page + affiliate + final = 3 outbound fetches.
    expect(mock.calls.length).toBe(3);
    for (const c of mock.calls) {
      expect(new URL(c.url).searchParams.get("__adtlab_test")).toBe("1");
      expect(c.headers[TEST_CLICK_HEADER]).toBe("1");
    }
  });

  it("marks deviation when the landing page fails", async () => {
    const mock = makeMockFetch({ [LP_URL]: { status: 404 } });
    const app2 = await buildApp(mock.fn);
    const res = await app2.inject({
      method: "POST",
      url: "/api/v1/tracking/test-click",
      ...authed({ trackingLinkId: TRACKING_LINK }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.chainOk).toBe(false);
    const landing = body.hops.find((h: any) => h.label === "landing-page");
    expect(landing.httpStatus).toBe(404);
    expect(landing.deviated).toBe(true);
    // No affiliate hop without a landing page body.
    expect(body.hops.some((h: any) => h.label === "affiliate")).toBe(false);
    // The click is still recorded as a test click.
    expect(fake._createdClicks.length).toBe(1);
    expect(fake._createdClicks[0].isTest).toBe(true);
  });
});

describe("test-click helpers", () => {
  it("withTestMarker appends the marker once", () => {
    expect(withTestMarker("https://x.example/a")).toBe(
      "https://x.example/a?__adtlab_test=1"
    );
    expect(withTestMarker("https://x.example/a?b=2")).toBe(
      "https://x.example/a?b=2&__adtlab_test=1"
    );
    expect(withTestMarker("https://x.example/a?__adtlab_test=1")).toBe(
      "https://x.example/a?__adtlab_test=1"
    );
  });

  it("extractAffiliateLink prefers the offsite link", () => {
    const html = [
      `<a href="https://lp.example.com/page#top">top</a>`,
      `<a href="https://aff.example.net/go?x=1">buy</a>`,
      `<a href="mailto:a@b.c">mail</a>`,
      `<a href="/relative">rel</a>`,
    ].join("");
    expect(extractAffiliateLink(html, LP_URL)).toBe(
      "https://aff.example.net/go?x=1"
    );
  });

  it("extractAffiliateLink returns null when there is no outbound link", () => {
    expect(extractAffiliateLink("<html><body>none</body></html>", LP_URL)).toBe(
      null
    );
    expect(extractAffiliateLink("", LP_URL)).toBe(null);
  });
});

/* ------------------------------------------------------------------ */
/* Part B — isolation: test clicks excluded from all aggregations       */
/* ------------------------------------------------------------------ */

function makeAnalyticsPrisma() {
  return {
    click: mkStore([]),
    conversion: mkStore([]),
    order: mkStore([]),
    trackingLink: mkStore([]),
    alertRule: mkStore([]),
    alert: mkStore([]),
    offer: mkStore([]),
    merchant: mkStore([]),
    killSwitchConfig: mkStore([]),
    profitModel: mkStore([]),
    offerPolicy: mkStore([]),
    policyEvidence: mkStore([]),
    offerRiskScore: mkStore([]),
  } as unknown as PrismaClient & {
    click: ReturnType<typeof mkStore>;
    conversion: ReturnType<typeof mkStore>;
    order: ReturnType<typeof mkStore>;
    trackingLink: ReturnType<typeof mkStore>;
    alertRule: ReturnType<typeof mkStore>;
    alert: ReturnType<typeof mkStore>;
    offer: ReturnType<typeof mkStore>;
    killSwitchConfig: ReturnType<typeof mkStore>;
    profitModel: ReturnType<typeof mkStore>;
    offerPolicy: ReturnType<typeof mkStore>;
    policyEvidence: ReturnType<typeof mkStore>;
  };
}

function seedClicks(
  fake: any,
  spec: {
    real: number;
    test: number;
    occurredAt?: Date;
    extra?: (i: number, isTest: boolean) => Row;
  }
): Row[] {
  const rows: Row[] = [];
  const at = spec.occurredAt ?? new Date();
  for (let i = 0; i < spec.real; i++) {
    rows.push({
      id: randomUUID(),
      tenantId: TENANT,
      trackingLinkId: TRACKING_LINK,
      offerId: OFFER,
      occurredAt: at,
      isTest: false,
      ...(spec.extra ? spec.extra(i, false) : {}),
    });
  }
  for (let i = 0; i < spec.test; i++) {
    rows.push({
      id: randomUUID(),
      tenantId: TENANT,
      trackingLinkId: TRACKING_LINK,
      offerId: OFFER,
      occurredAt: at,
      isTest: true,
      ...(spec.extra ? spec.extra(i, true) : {}),
    });
  }
  (fake.click as any).pushRows(rows);
  return rows;
}

describe("isolation: getOfferPerformance ignores test clicks", () => {
  it("clicks / conversions / CVR / orders exclude isTest rows", async () => {
    const fake = makeAnalyticsPrisma();
    const clicks = seedClicks(fake as any, { real: 5, test: 20 });
    const realIds = new Set(clicks.filter((c) => !c.isTest).map((c) => c.id));
    const convRows: Row[] = [
      {
        id: randomUUID(),
        tenantId: TENANT,
        clickId: [...realIds][0],
        offerId: OFFER,
        clickIsTest: false,
        status: "APPROVED",
        conversionTime: new Date(),
        value: 10,
        currency: "USD",
        deletedAt: null,
      },
      {
        id: randomUUID(),
        tenantId: TENANT,
        clickId: [...realIds][1],
        offerId: OFFER,
        clickIsTest: false,
        status: "APPROVED",
        conversionTime: new Date(),
        value: 10,
        currency: "USD",
        deletedAt: null,
      },
    ];
    (fake.conversion as any).pushRows(convRows);
    (fake.order as any).pushRows([
      ...[0, 1, 2].map(() => ({
        id: randomUUID(),
        tenantId: TENANT,
        status: "CONFIRMED",
        createdAt: new Date(),
        offerId: OFFER,
        clickIsTest: false,
      })),
      {
        id: randomUUID(),
        tenantId: TENANT,
        status: "REFUNDED",
        createdAt: new Date(),
        offerId: OFFER,
        clickIsTest: false,
      },
    ]);

    const perf = await getOfferPerformance(fake, TENANT, OFFER, 30);
    expect(perf.clicks).toBe(5);
    expect(perf.conversions).toBe(2);
    expect(perf.cvrPct).toBe(40);
    expect(perf.revenue).toBe(20);
    expect(perf.ordersConfirmed).toBe(3);
    expect(perf.ordersRefunded).toBe(1);
    expect(perf.refundRatePct).toBe(25);
  });
});

describe("isolation: runMonitorScan ignores test clicks", () => {
  const HOUR = 3600 * 1000;
  async function seedMonitor(fake: any, windowReal: number, windowTest: number) {
    await fake.alertRule.create({
      data: {
        id: randomUUID(),
        tenantId: TENANT,
        createdAt: new Date(),
        enabled: true,
        name: "burst",
        metric: "click_burst",
        thresholdPct: 300,
        windowHours: 1,
        baselineHours: 24,
        minClicks: 1,
        autoPause: false,
      },
    });
    await fake.trackingLink.create({
      data: {
        id: TRACKING_LINK,
        tenantId: TENANT,
        publicId: "pub-1",
        status: "ACTIVE",
        deletedAt: null,
      },
    });
    const now = Date.now();
    // Baseline: 100 real clicks over the trailing 24h.
    for (let i = 0; i < 100; i++) {
      await fake.click.create({
        data: {
          tenantId: TENANT,
          trackingLinkId: TRACKING_LINK,
          offerId: OFFER,
          occurredAt: new Date(now - (2 + i * 0.2) * HOUR),
          isTest: false,
        },
      });
    }
    // Window: windowReal real + windowTest test clicks in the last hour.
    for (let i = 0; i < windowReal; i++) {
      await fake.click.create({
        data: {
          tenantId: TENANT,
          trackingLinkId: TRACKING_LINK,
          offerId: OFFER,
          occurredAt: new Date(now - 30 * 60 * 1000),
          isTest: false,
        },
      });
    }
    for (let i = 0; i < windowTest; i++) {
      await fake.click.create({
        data: {
          tenantId: TENANT,
          trackingLinkId: TRACKING_LINK,
          offerId: OFFER,
          occurredAt: new Date(now - 30 * 60 * 1000),
          isTest: true,
        },
      });
    }
  }

  it("a burst of test clicks alone creates no alert", async () => {
    const fake = makeAnalyticsPrisma();
    await seedMonitor(fake, 3, 200);
    const result = await runMonitorScan(fake, { triggeredBy: "manual" });
    expect(result.alertsCreated).toBe(0);
  });

  it("control: a burst of real clicks still alerts", async () => {
    const fake = makeAnalyticsPrisma();
    await seedMonitor(fake, 50, 0);
    const result = await runMonitorScan(fake, { triggeredBy: "manual" });
    expect(result.alertsCreated).toBe(1);
  });
});

describe("isolation: evaluateKillSwitch ignores test clicks", () => {
  async function seedKillSwitch(
    fake: any,
    realClicks: number,
    testClicks: number,
    conversions: number
  ) {
    await fake.offer.create({
      data: {
        id: OFFER,
        tenantId: TENANT,
        name: "o",
        deletedAt: null,
        merchantId: null,
      },
    });
    await fake.killSwitchConfig.create({
      data: {
        id: randomUUID(),
        tenantId: TENANT,
        offerId: OFFER,
        enabled: true,
        maxSpend: null,
        minExpectedProfit: null,
        minCvr: 0.5,
        maxPolicyRisk: null,
        pauseOnMerchantTerminated: false,
      },
    });
    for (let i = 0; i < realClicks; i++) {
      await fake.click.create({
        data: { tenantId: TENANT, offerId: OFFER, isTest: false },
      });
    }
    for (let i = 0; i < testClicks; i++) {
      await fake.click.create({
        data: { tenantId: TENANT, offerId: OFFER, isTest: true },
      });
    }
    for (let i = 0; i < conversions; i++) {
      await fake.conversion.create({
        data: {
          tenantId: TENANT,
          deletedAt: null,
          offerId: OFFER,
          clickIsTest: false,
        },
      });
    }
  }

  it("test clicks do not drag CVR below the floor", async () => {
    const fake = makeAnalyticsPrisma();
    // Real CVR = 6/10 = 60% >= 50% floor; with 90 test clicks counted it
    // would be 6/100 = 6% and wrongly trigger.
    await seedKillSwitch(fake, 10, 90, 6);
    const ev = await evaluateKillSwitch(fake, OFFER);
    expect(ev.triggers.some((t) => t.type === "CVR_FLOOR")).toBe(false);
  });

  it("control: a real CVR below the floor still triggers", async () => {
    const fake = makeAnalyticsPrisma();
    await seedKillSwitch(fake, 10, 0, 2);
    const ev = await evaluateKillSwitch(fake, OFFER);
    expect(ev.triggers.some((t) => t.type === "CVR_FLOOR")).toBe(true);
  });
});

describe("isolation: buildAuditReport ignores test clicks", () => {
  it("totals exclude isTest clicks and their conversions", async () => {
    const fake = makeAnalyticsPrisma();
    const clicks = seedClicks(fake as any, { real: 5, test: 20 });
    const realClick = clicks.find((c) => !c.isTest)!;
    const testClick = clicks.find((c) => c.isTest)!;
    await fake.trackingLink.create({
      data: {
        id: TRACKING_LINK,
        tenantId: TENANT,
        publicId: "pub-1",
        offerId: OFFER,
      },
    });
    await fake.conversion.create({
      data: {
        id: randomUUID(),
        tenantId: TENANT,
        clickId: realClick.id,
        conversionTime: new Date(),
        deletedAt: null,
        value: 5,
        currency: "USD",
      },
    });
    await fake.conversion.create({
      data: {
        id: randomUUID(),
        tenantId: TENANT,
        clickId: realClick.id,
        conversionTime: new Date(),
        deletedAt: null,
        value: 7,
        currency: "USD",
      },
    });
    // A conversion attributed to a test click must not leak in either.
    await fake.conversion.create({
      data: {
        id: randomUUID(),
        tenantId: TENANT,
        clickId: testClick.id,
        conversionTime: new Date(),
        deletedAt: null,
        value: 100,
        currency: "USD",
      },
    });

    const report = await buildAuditReport(fake, TENANT, {
      merchant: null,
      offer: null,
      offerIds: null,
      from: new Date(Date.now() - 24 * 3600 * 1000),
      to: new Date(),
    });
    expect(report.totals.clicks).toBe(5);
    expect(report.totals.conversions).toBe(2);
    expect(report.totals.commission).toBe("0.0000");
  });
});

describe("isolation: orchestrator traffic/keyword aggregations ignore test clicks", () => {
  it("trafficSummary topGeo/topDevice exclude isTest rows", async () => {
    const fake = makeAnalyticsPrisma();
    const mk = (isTest: boolean, extra: Row) => ({
      id: randomUUID(),
      tenantId: TENANT,
      offerId: OFFER,
      occurredAt: new Date(),
      isTest,
      ...extra,
    });
    const rows: Row[] = [
      ...[0, 1, 2].map(() => mk(false, { country: "US", deviceType: "desktop" })),
      ...[0, 1].map(() => mk(false, { country: "UK", deviceType: "mobile" })),
      ...Array.from({ length: 20 }, () =>
        mk(true, { country: "US", deviceType: "desktop" })
      ),
    ];
    for (const r of rows) await (fake.click as any).create({ data: r });

    const summary = await trafficSummary(fake, TENANT, OFFER);
    expect(summary.clicks).toBe(5);
    const geoTotal = summary.topGeo.reduce((n, g) => n + g.count, 0);
    expect(geoTotal).toBe(5);
    const deviceTotal = summary.topDevice.reduce((n, g) => n + g.count, 0);
    expect(deviceTotal).toBe(5);
  });

  it("planKeywords excludes terms seen only on test clicks", async () => {
    const fake = makeAnalyticsPrisma();
    const mk = (isTest: boolean, utmTerm: string) => ({
      id: randomUUID(),
      tenantId: TENANT,
      offerId: OFFER,
      occurredAt: new Date(),
      isTest,
      utmTerm,
    });
    for (const r of [
      mk(false, "realterm"),
      ...Array.from({ length: 20 }, () => mk(true, "zzz-test-only-term")),
    ]) {
      await (fake.click as any).create({ data: r });
    }
    const kws = await planKeywords(
      fake,
      TENANT,
      {
        id: OFFER,
        name: "Shoes",
        network: "Impact",
        merchantId: null,
        category: null,
        commissionValue: 50,
      },
      []
    );
    const texts = kws.map((k) => k.text);
    expect(texts).toContain("realterm");
    expect(texts.some((t) => t.includes("zzz-test-only-term"))).toBe(false);
    expect(kws.every((k) => k.dataQuality === "OBSERVED")).toBe(true);
  });
});
