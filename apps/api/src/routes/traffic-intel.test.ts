/**
 * Phase 2 Traffic Intelligence — route contract tests.
 * In-memory fake Prisma + Fastify inject, fake traffic-event service.
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
  registerTrafficIntelRoutes,
  type TrafficEventDto,
} from "./traffic-intel.js";

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      const rv = row[k];
      if ("in" in v) return ((v as any).in as any[]).includes(rv);
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

function sortRows(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows;
  const [key, dir] = Object.entries(orderBy)[0] as [string, string];
  const out = [...rows];
  out.sort((a, b) => {
    const av = a[key] instanceof Date ? a[key].getTime() : a[key];
    const bv = b[key] instanceof Date ? b[key].getTime() : b[key];
    return dir === "desc" ? (bv > av ? 1 : -1) : av > bv ? 1 : -1;
  });
  return out;
}

function mkStore(rows: Row[]) {
  return {
    findFirst: async (args: any = {}) =>
      sortRows(rows.filter((r) => matches(r, args.where)), args.orderBy)[0] ?? null,
    findMany: async (args: any = {}) => {
      let out = sortRows(rows.filter((r) => matches(r, args.where)), args.orderBy);
      if (typeof args.skip === "number") out = out.slice(args.skip);
      if (typeof args.take === "number") out = out.slice(0, args.take);
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
    count: async (args: any = {}) => rows.filter((r) => matches(r, args.where)).length,
  };
}

function makeFakePrisma() {
  const tenants: Row[] = [];
  const users: Row[] = [];
  const sessions: Row[] = [];
  const stores = {
    tenant: mkStore(tenants),
    user: mkStore(users),
    session: {
      create: async ({ data }: any) => {
        const row = { createdAt: new Date(), ...data };
        sessions.push(row);
        return { ...row };
      },
      findUnique: async ({ where, include }: any) => {
        const row = sessions.find((r) => matches(r, where)) ?? null;
        if (!row) return null;
        const out = { ...row };
        if (include?.user) {
          out.user = users.find((u) => u.id === row.userId) ?? null;
        }
        return out;
      },
    },
    merchant: mkStore([]),
    offer: mkStore([]),
    trackingLink: mkStore([]),
    click: mkStore([]),
    conversion: mkStore([]),
    offerPolicy: mkStore([]),
    policyEvidence: mkStore([]),
    profitModel: mkStore([]),
  };
  return stores;
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

function cookie(token: string) {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

async function seedAuth(fake: FakePrisma, role: "admin" | "member" = "member") {
  const tenantId = randomUUID();
  await (fake as any).tenant.create({
    data: { id: tenantId, name: `${role}@t`, slug: `u-${role}-${tenantId.slice(0, 8)}`, status: "ACTIVE" },
  });
  const user = await (fake as any).user.create({
    data: {
      id: randomUUID(),
      tenantId,
      email: `${role}-${tenantId.slice(0, 8)}@example.com`,
      name: role,
      role,
      status: "ACTIVE",
    },
  });
  const session = await createSession(fake as unknown as PrismaClient, user.id);
  return { tenantId, user, token: session.token };
}

function makeChain(clickId: string, trackingLinkId: string, conversionId: string | null): TrafficEventDto[] {
  const base = {
    clickId,
    trackingLinkId,
    timestamp: new Date("2026-10-04T10:00:00Z").toISOString(),
    source: "google",
    destination: "https://lp.example/a",
    metadata: {},
    dataQuality: "OBSERVED" as const,
  };
  return [
    { ...base, id: "e1", parentEventId: null, eventType: "AD_CLICK", conversionId: null },
    { ...base, id: "e2", parentEventId: "e1", eventType: "AFFILIATE_CLICK", conversionId: null },
    { ...base, id: "e3", parentEventId: "e2", eventType: "MERCHANT_VISIT", conversionId: null },
    { ...base, id: "e4", parentEventId: "e3", eventType: "CONVERSION", conversionId },
  ];
}

function makeFakeService(chain: TrafficEventDto[]) {
  const recorded: any[] = [];
  const calls: Array<{ tenantId: string; clickId: string }> = [];
  return {
    recorded,
    calls,
    getEventChain: async (tenantId: string, clickId: string) => {
      calls.push({ tenantId, clickId });
      return chain.map((e) => ({ ...e }));
    },
    recordTrafficEvent: async (input: any) => {
      recorded.push(input);
    },
  };
}

async function buildApp(
  fake: FakePrisma,
  svc: { getEventChain: any; recordTrafficEvent: any }
): Promise<any> {
  const app = Fastify({ logger: false });
  app.setErrorHandler(createObservabilityErrorHandler());
  await registerTrafficIntelRoutes(app, {
    prisma: fake as unknown as PrismaClient,
    getEventChainImpl: svc.getEventChain,
    recordTrafficEventImpl: svc.recordTrafficEvent,
  });
  return app;
}

interface Seed {
  tenantId: string;
  token: string;
  merchantId: string;
  offerId: string;
  trackingLinkId: string;
  clickId: string;
  conversionId: string;
}

/** Seeds a full Conversion → Click → TrackingLink → Offer → Merchant graph. */
async function seedGraph(fake: FakePrisma, tenantId: string): Promise<Seed> {
  const merchantId = randomUUID();
  const offerId = randomUUID();
  const trackingLinkId = randomUUID();
  const clickId = randomUUID();
  const conversionId = randomUUID();
  const campaignId = randomUUID();
  const adGroupId = randomUUID();
  const adId = randomUUID();
  const landingPageId = randomUUID();

  await (fake as any).merchant.create({
    data: { id: merchantId, tenantId, name: "Acme Merchant" },
  });
  await (fake as any).offer.create({
    data: {
      id: offerId,
      tenantId,
      name: "Acme Offer",
      network: "TestNet",
      destinationUrl: "https://merchant.example/offer",
      merchantId,
    },
  });
  const trackingLinkRow = {
    id: trackingLinkId,
    tenantId,
    publicId: "tl-pub-1",
    campaignId,
    adGroupId,
    adId,
    offerId,
    landingPageId,
    campaign: { id: campaignId, name: "Camp A" },
    adGroup: { id: adGroupId, name: "Group A" },
    ad: { id: adId, name: "Ad A" },
    landingPage: { id: landingPageId, name: "LP A", url: "https://lp.example/a" },
    offer: { id: offerId, name: "Acme Offer", merchantId },
  };
  await (fake as any).trackingLink.create({ data: trackingLinkRow });
  await (fake as any).click.create({
    data: {
      id: clickId,
      clickId,
      tenantId,
      trackingLinkId,
      offerId,
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "camp-a",
      utmTerm: "cheap shoes",
      utmContent: null,
      gclid: "gclid-1",
      occurredAt: new Date("2026-10-04T10:00:00Z"),
      trackingLink: {
        landingPage: { url: "https://lp.example/a" },
        offer: { destinationUrl: "https://merchant.example/offer" },
      },
    },
  });
  await (fake as any).conversion.create({
    data: {
      id: conversionId,
      tenantId,
      clickId,
      conversionAction: "purchase",
      conversionTime: new Date("2026-10-04T11:00:00Z"),
      value: "120.5000",
      currency: "USD",
      status: "ATTRIBUTED",
    },
  });
  const policyId = randomUUID();
  await (fake as any).offerPolicy.create({
    data: { id: policyId, tenantId, offerId, createdAt: new Date("2026-10-03T00:00:00Z") },
  });
  await (fake as any).policyEvidence.create({
    data: {
      id: randomUUID(),
      tenantId,
      offerPolicyId: policyId,
      rule: "PPC_FORBIDDEN",
      matchedText: "No PPC allowed.",
      confidence: 0.95,
    },
  });
  await (fake as any).profitModel.create({
    data: {
      id: randomUUID(),
      tenantId,
      offerId,
      commission: "15.0000",
      currency: "USD",
      createdAt: new Date("2026-10-03T00:00:00Z"),
    },
  });
  return { tenantId, token: "", merchantId, offerId, trackingLinkId, clickId, conversionId };
}

describe("GET /api/v1/traffic/events", () => {
  let fake: FakePrisma;
  let token: string;
  let tenantId: string;
  let app: any;
  let svc: ReturnType<typeof makeFakeService>;

  beforeEach(async () => {
    fake = makeFakePrisma();
    ({ tenantId, token } = await seedAuth(fake));
    const seed = await seedGraph(fake, tenantId);
    seed.token = token;
    svc = makeFakeService(makeChain(seed.clickId, seed.trackingLinkId, seed.conversionId));
    app = await buildApp(fake, svc);
  });

  it("returns the service chain root→leaf in order, tenant-scoped", async () => {
    const clickId = (await (fake as any).click.findFirst({})).id;
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/traffic/events?clickId=${clickId}`,
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(4);
    expect(body.items.map((e: any) => e.id)).toEqual(["e1", "e2", "e3", "e4"]);
    expect(body.items.map((e: any) => e.eventType)).toEqual([
      "AD_CLICK",
      "AFFILIATE_CLICK",
      "MERCHANT_VISIT",
      "CONVERSION",
    ]);
    expect(svc.calls[0]).toEqual({ tenantId, clickId });
  });

  it("filters by eventType and paginates", async () => {
    const clickId = (await (fake as any).click.findFirst({})).id;
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/traffic/events?clickId=${clickId}&eventType=AFFILIATE_CLICK&page=1&pageSize=1`,
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].eventType).toBe("AFFILIATE_CLICK");
  });

  it("rejects an unknown eventType", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/traffic/events?clickId=x&eventType=BOGUS",
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(400);
  });

  it("lists latest tenant clicks as AD_CLICK events when clickId is absent", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/traffic/events",
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    const [item] = body.items;
    expect(item.eventType).toBe("AD_CLICK");
    expect(item.dataQuality).toBe("OBSERVED");
    expect(item.source).toBe("google"); // real stored value, never invented
    expect(item.destination).toBe("https://lp.example/a");
  });

  it("requires authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/traffic/events" });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /api/v1/traffic/events/merchant-visit", () => {
  let fake: FakePrisma;
  let token: string;
  let tenantId: string;
  let app: any;
  let svc: ReturnType<typeof makeFakeService>;
  let clickId: string;
  let trackingLinkId: string;

  beforeEach(async () => {
    fake = makeFakePrisma();
    ({ tenantId, token } = await seedAuth(fake));
    const seed = await seedGraph(fake, tenantId);
    clickId = seed.clickId;
    trackingLinkId = seed.trackingLinkId;
    svc = makeFakeService(makeChain(clickId, trackingLinkId, null));
    app = await buildApp(fake, svc);
  });

  it("links parent to the latest AFFILIATE_CLICK", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/traffic/events/merchant-visit",
      headers: cookie(token),
      payload: {
        clickId,
        destination: "https://merchant.example/checkout",
        metadata: { note: "postback" },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.eventType).toBe("MERCHANT_VISIT");
    expect(body.parentEventId).toBe("e2");
    expect(svc.recorded).toHaveLength(1);
    expect(svc.recorded[0]).toMatchObject({
      tenantId,
      clickId,
      parentEventId: "e2",
      eventType: "MERCHANT_VISIT",
      trackingLinkId,
      destination: "https://merchant.example/checkout",
      metadata: { note: "postback" },
    });
  });

  it("falls back to the latest AD_CLICK when no AFFILIATE_CLICK exists", async () => {
    svc = makeFakeService(
      makeChain(clickId, trackingLinkId, null).filter((e) => e.eventType === "AD_CLICK")
    );
    app = await buildApp(fake, svc);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/traffic/events/merchant-visit",
      headers: cookie(token),
      payload: { clickId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().parentEventId).toBe("e1");
    expect(svc.recorded[0].parentEventId).toBe("e1");
  });

  it("404s for a click in another tenant", async () => {
    const other = await seedAuth(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/traffic/events/merchant-visit",
      headers: cookie(other.token),
      payload: { clickId },
    });
    expect(res.statusCode).toBe(404);
  });

  it("400s when clickId is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/traffic/events/merchant-visit",
      headers: cookie(token),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/v1/traffic/provenance/:conversionId", () => {
  let fake: FakePrisma;
  let token: string;
  let tenantId: string;
  let app: any;
  let seed: Seed;

  beforeEach(async () => {
    fake = makeFakePrisma();
    ({ tenantId, token } = await seedAuth(fake));
    seed = await seedGraph(fake, tenantId);
    seed.token = token;
    const svc = makeFakeService(makeChain(seed.clickId, seed.trackingLinkId, seed.conversionId));
    app = await buildApp(fake, svc);
  });

  it("returns the full provenance JSON contract", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/traffic/provenance/${seed.conversionId}`,
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.conversionId).toBe(seed.conversionId);
    // chain preserved root→leaf
    expect(body.chain.map((e: any) => e.id)).toEqual(["e1", "e2", "e3", "e4"]);

    const s = body.summary;
    expect(s.trafficSource).toBe("google");
    expect(s.trafficMedium).toBe("cpc");
    expect(s.keyword).toBe("cheap shoes"); // real Click.utmTerm
    expect(s.clickId).toBe(seed.clickId);
    expect(s.campaign).toEqual({ id: expect.any(String), name: "Camp A" });
    expect(s.adGroup).toEqual({ id: expect.any(String), name: "Group A" });
    expect(s.ad).toEqual({ id: expect.any(String), name: "Ad A" });
    expect(s.landingPage).toEqual({
      id: expect.any(String),
      name: "LP A",
      url: "https://lp.example/a",
    });
    expect(s.trackingLink).toEqual({ id: seed.trackingLinkId, publicId: "tl-pub-1" });
    expect(s.offer).toEqual({ id: seed.offerId, name: "Acme Offer" });
    expect(s.merchant).toEqual({ id: seed.merchantId, name: "Acme Merchant" });
    expect(s.conversion).toEqual({
      id: seed.conversionId,
      action: "purchase",
      time: new Date("2026-10-04T11:00:00Z").toISOString(),
      value: "120.5000", // Decimal → string
      currency: "USD",
      status: "ATTRIBUTED",
    });
    expect(s.commission).toEqual({ value: "15.0000", currency: "USD" });

    expect(body.policyEvidence).toEqual([
      { rule: "PPC_FORBIDDEN", matchedText: "No PPC allowed.", confidence: 0.95 },
    ]);
    expect(typeof body.generatedAt).toBe("string");
  });

  it("returns empty policyEvidence when the offer has no policy", async () => {
    // remove the policy + evidence
    (fake as any).offerPolicy = mkStore([]);
    (fake as any).policyEvidence = mkStore([]);
    const svc = makeFakeService(makeChain(seed.clickId, seed.trackingLinkId, seed.conversionId));
    app = await buildApp(fake, svc);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/traffic/provenance/${seed.conversionId}`,
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().policyEvidence).toEqual([]);
  });

  it("is tenant-isolated: tenant B cannot read tenant A's conversion", async () => {
    const other = await seedAuth(fake);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/traffic/provenance/${seed.conversionId}`,
      headers: cookie(other.token),
    });
    expect(res.statusCode).toBe(404);
  });

  it("404s for an unknown conversion", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/traffic/provenance/${randomUUID()}`,
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/v1/traffic/provenance/:conversionId/export", () => {
  let fake: FakePrisma;
  let token: string;
  let app: any;
  let seed: Seed;

  beforeEach(async () => {
    fake = makeFakePrisma();
    ({ token } = await seedAuth(fake));
    seed = await seedGraph(fake, (await (fake as any).tenant.findFirst({})).id);
    const svc = makeFakeService(makeChain(seed.clickId, seed.trackingLinkId, seed.conversionId));
    app = await buildApp(fake, svc);
  });

  it("exports the chain as CSV with the contract header and attachment disposition", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/traffic/provenance/${seed.conversionId}/export?format=csv`,
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain(`provenance-${seed.conversionId}.csv`);
    const lines = res.body.split("\n");
    expect(lines[0]).toBe(
      "eventType,timestamp,source,destination,clickId,conversionId,metadataJson"
    );
    expect(lines).toHaveLength(5); // header + 4 chain events
    expect(lines[1].startsWith("AD_CLICK,")).toBe(true);
    expect(lines[4].startsWith("CONVERSION,")).toBe(true);
  });

  it("rejects a non-csv format", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/traffic/provenance/${seed.conversionId}/export?format=json`,
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/v1/traffic/audit-report", () => {
  let fake: FakePrisma;
  let token: string;
  let tenantId: string;
  let app: any;
  let seed: Seed;

  async function seedAuditExtra() {
    // second merchant with its own click/conversion (for scoping tests)
    const m2 = randomUUID();
    const o2 = randomUUID();
    const tl2 = randomUUID();
    const c2 = randomUUID();
    await (fake as any).merchant.create({ data: { id: m2, tenantId, name: "Other Merchant" } });
    await (fake as any).offer.create({
      data: { id: o2, tenantId, name: "Other Offer", network: "Net2", destinationUrl: "https://o2.example", merchantId: m2 },
    });
    await (fake as any).trackingLink.create({
      data: { id: tl2, tenantId, publicId: "tl-pub-2", offerId: o2 },
    });
    await (fake as any).click.create({
      data: {
        id: c2, clickId: c2, tenantId, trackingLinkId: tl2, offerId: o2,
        utmSource: "facebook", gclid: null,
        occurredAt: new Date("2026-10-04T12:00:00Z"),
      },
    });
    await (fake as any).conversion.create({
      data: {
        id: randomUUID(), tenantId, clickId: c2, conversionAction: "purchase",
        conversionTime: new Date("2026-10-04T13:00:00Z"), value: "50.0000", currency: "USD",
        status: "ATTRIBUTED",
      },
    });
    // click outside the period (must be excluded)
    const cold = randomUUID();
    await (fake as any).click.create({
      data: {
        id: cold, clickId: cold, tenantId, trackingLinkId: seed.trackingLinkId, offerId: seed.offerId,
        utmSource: "google", gclid: "old",
        occurredAt: new Date("2025-01-01T00:00:00Z"),
      },
    });
    // click without a source (counted in totals, absent from trafficSources)
    const nosrc = randomUUID();
    await (fake as any).click.create({
      data: {
        id: nosrc, clickId: nosrc, tenantId, trackingLinkId: seed.trackingLinkId, offerId: seed.offerId,
        utmSource: null, gclid: null,
        occurredAt: new Date("2026-10-04T14:00:00Z"),
      },
    });
  }

  beforeEach(async () => {
    fake = makeFakePrisma();
    ({ tenantId, token } = await seedAuth(fake));
    seed = await seedGraph(fake, tenantId);
    await seedAuditExtra();
    const svc = makeFakeService([]);
    app = await buildApp(fake, svc);
  });

  const qs = (p: Record<string, string>) =>
    `/api/v1/traffic/audit-report?${new URLSearchParams(p).toString()}`;

  it("returns the audit JSON contract, scoped by merchant", async () => {
    const res = await app.inject({
      method: "GET",
      url: qs({ merchantId: seed.merchantId, from: "2026-10-01", to: "2026-10-05" }),
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.merchant).toEqual({ id: seed.merchantId, name: "Acme Merchant" });
    expect(body.offer).toBeNull();
    expect(body.period).toEqual({
      from: new Date("2026-10-01").toISOString(),
      to: new Date("2026-10-05").toISOString(),
    });

    // 2 in-period clicks for this merchant (google + null source); outside-period excluded
    expect(body.totals.clicks).toBe(2);
    expect(body.totals.conversions).toBe(1);
    // commission = 1 conversion × 15.0000 (latest ProfitModel), exact decimal math
    expect(body.totals.commission).toBe("15.0000");

    // trafficSources aggregates REAL utm_source values only
    expect(body.trafficSources).toEqual([{ source: "google", clicks: 1 }]);

    expect(body.policyEvidence).toEqual([
      { rule: "PPC_FORBIDDEN", matchedText: "No PPC allowed.", confidence: 0.95 },
    ]);

    expect(body.attributions).toHaveLength(1);
    expect(body.attributions[0]).toEqual({
      conversionId: seed.conversionId,
      clickId: seed.clickId,
      timestamp: new Date("2026-10-04T11:00:00Z").toISOString(),
      trackingLinkPublicId: "tl-pub-1",
      trafficSource: "google",
      gclid: "gclid-1",
      value: "120.5000",
      currency: "USD",
    });
    expect(typeof body.generatedAt).toBe("string");
  });

  it("scopes by offerId across the tenant", async () => {
    const res = await app.inject({
      method: "GET",
      url: qs({ offerId: seed.offerId, from: "2026-10-01", to: "2026-10-05" }),
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.offer).toEqual({ id: seed.offerId, name: "Acme Offer" });
    expect(body.merchant).toBeNull();
    expect(body.totals.clicks).toBe(2);
    expect(body.totals.conversions).toBe(1);
  });

  it("rejects an offer that does not belong to the given merchant", async () => {
    const otherOffer = await (fake as any).offer.findFirst({ where: { name: "Other Offer" } });
    const res = await app.inject({
      method: "GET",
      url: qs({ merchantId: seed.merchantId, offerId: otherOffer.id }),
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an invalid date range", async () => {
    const res = await app.inject({
      method: "GET",
      url: qs({ from: "2026-10-05", to: "2026-10-01" }),
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(400);
  });

  it("is tenant-isolated: tenant B sees none of tenant A's data", async () => {
    const other = await seedAuth(fake);
    const res = await app.inject({
      method: "GET",
      url: qs({ merchantId: seed.merchantId, from: "2026-10-01", to: "2026-10-05" }),
      headers: cookie(other.token),
    });
    expect(res.statusCode).toBe(404); // merchant not found in B's tenant
  });
});

describe("GET /api/v1/traffic/audit-report/export", () => {
  let fake: FakePrisma;
  let token: string;
  let tenantId: string;
  let app: any;
  let seed: Seed;

  beforeEach(async () => {
    fake = makeFakePrisma();
    ({ tenantId, token } = await seedAuth(fake));
    seed = await seedGraph(fake, tenantId);
    const svc = makeFakeService([]);
    app = await buildApp(fake, svc);
  });

  it("exports one CSV row per attribution with the contract header", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/traffic/audit-report/export?format=csv&merchantId=${seed.merchantId}&from=2026-10-01&to=2026-10-05`,
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain("audit-report.csv");
    const lines = res.body.split("\n");
    expect(lines[0]).toBe(
      "conversionId,clickId,timestamp,trackingLinkPublicId,trafficSource,gclid,value,currency"
    );
    expect(lines).toHaveLength(2);
    const cols = lines[1].split(",");
    expect(cols[0]).toBe(seed.conversionId);
    expect(cols[1]).toBe(seed.clickId);
    expect(cols[3]).toBe("tl-pub-1");
    expect(cols[4]).toBe("google");
    expect(cols[5]).toBe("gclid-1");
    expect(cols[6]).toBe("120.5000");
    expect(cols[7]).toBe("USD");
  });
});
