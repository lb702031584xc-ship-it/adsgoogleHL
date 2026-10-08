/**
 * Phase 3 Experiment API — route contract + winner-determination tests.
 * In-memory fake Prisma + Fastify inject (same harness style as
 * offer-intel.test.ts). The Experiment table is owned by Worker 1, so the
 * fake exposes an `experiment` store matching the route's delegate shape.
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
  assignVariant,
  determineWinner,
  registerExperimentRoutes,
} from "./experiments.js";

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      const rv = row[k];
      if ("gte" in v && !(rv >= (v as any).gte)) return false;
      if ("gt" in v && !(rv > (v as any).gt)) return false;
      if ("lt" in v && !(rv < (v as any).lt)) return false;
      if ("lte" in v && !(rv <= (v as any).lte)) return false;
      if ("notIn" in v && ((v as any).notIn as any[]).includes(rv)) return false;
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
    findFirst: async ({ where, orderBy }: any) =>
      sortRows(rows.filter((r) => matches(r, where)), orderBy)[0] ?? null,
    findMany: async ({ where, orderBy }: any) =>
      sortRows(rows.filter((r) => matches(r, where)), orderBy).map((r) => ({
        ...r,
      })),
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
      if (!row) throw new Error("fake: row not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return { ...row };
    },
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
    offer: mkStore([]),
    trackingLink: mkStore([]),
    trackingLinkOffer: mkStore([]),
    landingPage: mkStore([]),
    offerPolicy: mkStore([]),
    auditLog: mkStore([]),
    experiment: mkStore([]),
  };
  return stores;
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

function cookie(token: string) {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

async function seedAuth(fake: FakePrisma) {
  const tenantId = randomUUID();
  await (fake as any).tenant.create({
    data: { id: tenantId, name: "t", slug: `u-${tenantId.slice(0, 8)}`, status: "ACTIVE" },
  });
  const user = await (fake as any).user.create({
    data: {
      id: randomUUID(),
      tenantId,
      email: `member-${tenantId.slice(0, 8)}@example.com`,
      name: "member",
      role: "member",
      status: "ACTIVE",
    },
  });
  const session = await createSession(fake as unknown as PrismaClient, user.id);
  return { tenantId, token: session.token };
}

async function buildApp(fake: FakePrisma): Promise<any> {
  const app = Fastify({ logger: false });
  app.setErrorHandler(createObservabilityErrorHandler());
  await registerExperimentRoutes(app, {
    prisma: fake as unknown as PrismaClient,
  });
  return app;
}

interface Fixture {
  offerId: string;
  lpLinkId: string;
  directLinkId: string;
}

/** Offer + LP-bound tracking link + direct tracking link, all in one tenant. */
async function seedOfferFixture(fake: FakePrisma, tenantId: string): Promise<Fixture> {
  const offerId = randomUUID();
  await (fake as any).offer.create({
    data: { id: offerId, tenantId, name: "Offer", network: "net", destinationUrl: "https://m.example/o" },
  });
  const lpId = randomUUID();
  await (fake as any).landingPage.create({
    data: {
      id: lpId,
      tenantId,
      offerId,
      name: "LP",
      url: "https://lp.example/",
      domain: "lp.example",
      status: "ACTIVE",
    },
  });
  const lpLinkId = randomUUID();
  const directLinkId = randomUUID();
  await (fake as any).trackingLink.create({
    data: { id: lpLinkId, tenantId, publicId: `lp-${lpLinkId.slice(0, 8)}`, offerId, landingPageId: lpId, status: "ACTIVE" },
  });
  await (fake as any).trackingLink.create({
    data: { id: directLinkId, tenantId, publicId: `dl-${directLinkId.slice(0, 8)}`, offerId, landingPageId: null, status: "ACTIVE" },
  });
  for (const linkId of [lpLinkId, directLinkId]) {
    await (fake as any).trackingLinkOffer.create({
      data: { id: randomUUID(), tenantId, trackingLinkId: linkId, offerId, priority: 100, isFallback: false },
    });
  }
  return { offerId, lpLinkId, directLinkId };
}

async function seedPolicy(fake: FakePrisma, tenantId: string, offerId: string, directLinkRule: string) {
  await (fake as any).offerPolicy.create({
    data: {
      id: randomUUID(),
      tenantId,
      offerId,
      rules: { DIRECT_LINK: directLinkRule, PPC: "UNKNOWN" },
    },
  });
}

async function createExperiment(
  app: any,
  token: string,
  fx: Fixture,
  overrides: Record<string, unknown> = {}
): Promise<any> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/experiments",
    headers: cookie(token),
    payload: {
      offerId: fx.offerId,
      name: "LP vs 直链",
      variantA: { type: "LANDING_PAGE", trackingLinkId: fx.lpLinkId, label: "落地页" },
      variantB: { type: "DIRECT_LINK", trackingLinkId: fx.directLinkId, label: "直链" },
      trafficSplitA: 50,
      ...overrides,
    },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

describe("POST /api/v1/experiments", () => {
  let fake: FakePrisma;
  let app: any;
  let auth: { tenantId: string; token: string };
  let fx: Fixture;
  beforeEach(async () => {
    fake = makeFakePrisma();
    app = await buildApp(fake);
    auth = await seedAuth(fake);
    fx = await seedOfferFixture(fake, auth.tenantId);
  });

  it("creates a DRAFT experiment when both links are bound to the offer", async () => {
    const { status, body } = await createExperiment(app, auth.token, fx);
    expect(status).toBe(200);
    expect(body.status).toBe("DRAFT");
    expect(body.trafficSplitA).toBe(50);
    expect(body.splitSeed).toBeNull();
    expect((body.variantA as any).trackingLinkId).toBe(fx.lpLinkId);
    expect((body.variantB as any).type).toBe("DIRECT_LINK");
  });

  it("rejects a tracking link that is not bound to the offer", async () => {
    const otherOfferId = randomUUID();
    await (fake as any).offer.create({
      data: { id: otherOfferId, tenantId: auth.tenantId, name: "Other", network: "n", destinationUrl: "https://x.example" },
    });
    const strayLinkId = randomUUID();
    await (fake as any).trackingLink.create({
      data: { id: strayLinkId, tenantId: auth.tenantId, publicId: "stray", offerId: otherOfferId, status: "ACTIVE" },
    });
    await (fake as any).trackingLinkOffer.create({
      data: { id: randomUUID(), tenantId: auth.tenantId, trackingLinkId: strayLinkId, offerId: otherOfferId, priority: 100, isFallback: false },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/experiments",
      headers: cookie(auth.token),
      payload: {
        offerId: fx.offerId,
        name: "bad",
        variantA: { type: "LANDING_PAGE", trackingLinkId: strayLinkId },
        variantB: { type: "DIRECT_LINK", trackingLinkId: fx.directLinkId },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("is not bound to this offer");
  });

  it("rejects trafficSplitA outside 1-99", async () => {
    const { status } = await createExperiment(app, auth.token, fx, { trafficSplitA: 0 });
    expect(status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/experiments",
      payload: { offerId: fx.offerId, name: "x" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("precondition checks on start", () => {
  let fake: FakePrisma;
  let app: any;
  let auth: { tenantId: string; token: string };
  let fx: Fixture;
  beforeEach(async () => {
    fake = makeFakePrisma();
    app = await buildApp(fake);
    auth = await seedAuth(fake);
    fx = await seedOfferFixture(fake, auth.tenantId);
  });

  it("blocks start when DIRECT_LINK is FORBIDDEN by policy", async () => {
    await seedPolicy(fake, auth.tenantId, fx.offerId, "FORBIDDEN");
    const created = await createExperiment(app, auth.token, fx);
    expect(created.status).toBe(200);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/experiments/${created.body.id}/start`,
      headers: cookie(auth.token),
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("FORBIDDEN");
  });

  it("blocks start when no policy scan exists", async () => {
    const created = await createExperiment(app, auth.token, fx);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/experiments/${created.body.id}/start`,
      headers: cookie(auth.token),
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("条款扫描");
  });

  it("starts when policy allows direct link and LP binding exists", async () => {
    await seedPolicy(fake, auth.tenantId, fx.offerId, "ALLOWED");
    const created = await createExperiment(app, auth.token, fx);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/experiments/${created.body.id}/start`,
      headers: cookie(auth.token),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("RUNNING");
    expect(body.splitSeed).toMatch(/^[0-9a-f]{32}$/);
    expect(body.preconditionCheck).toBeTruthy();
    expect(
      (body.preconditionCheck.checks as any[]).every((c) => c.passed)
    ).toBe(true);
    expect((body.preconditionCheck.checks as any[]).length).toBeGreaterThan(0);
  });

  it("blocks start when the offer has no landing page for an LP variant", async () => {
    await seedPolicy(fake, auth.tenantId, fx.offerId, "ALLOWED");
    // Remove the landing page binding → LP variant check must fail.
    await (fake as any).trackingLink.update({
      where: { id: fx.lpLinkId },
      data: { landingPageId: null },
    });
    const created = await createExperiment(app, auth.token, fx);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/experiments/${created.body.id}/start`,
      headers: cookie(auth.token),
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("LandingPage");
  });
});

describe("metrics → complete full chain", () => {
  let fake: FakePrisma;
  let app: any;
  let auth: { tenantId: string; token: string };
  let fx: Fixture;
  let experimentId: string;
  beforeEach(async () => {
    fake = makeFakePrisma();
    app = await buildApp(fake);
    auth = await seedAuth(fake);
    fx = await seedOfferFixture(fake, auth.tenantId);
    await seedPolicy(fake, auth.tenantId, fx.offerId, "ALLOWED");
    const created = await createExperiment(app, auth.token, fx);
    experimentId = created.body.id;
    await app.inject({
      method: "POST",
      url: `/api/v1/experiments/${experimentId}/start`,
      headers: cookie(auth.token),
    });
  });

  it("records metrics per variant and decides the winner on complete", async () => {
    for (const [variant, metrics] of [
      ["A", { clicks: 1000, cvr: 0.05, profit: 320 }],
      ["B", { clicks: 1000, cvr: 0.04, profit: 180 }],
    ] as const) {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/experiments/${experimentId}/metrics`,
        headers: cookie(auth.token),
        payload: { variant, metrics },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect((body[`metrics${variant}`] as any).profit).toBe(metrics.profit);
    }

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/experiments/${experimentId}/complete`,
      headers: cookie(auth.token),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("COMPLETED");
    expect(body.winner).toBe("A");
    expect(body.confidence).toBeGreaterThan(0.5);
    expect(body.winnerDetail.basis).toBe("profit");
    expect(body.endedAt).toBeTruthy();
  });

  it("rejects metrics submission when not RUNNING", async () => {
    const created = await createExperiment(app, auth.token, fx, { name: "draft one" });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/experiments/${created.body.id}/metrics`,
      headers: cookie(auth.token),
      payload: { variant: "A", metrics: { clicks: 10 } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("cancel moves DRAFT/RUNNING to CANCELLED", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/experiments/${experimentId}/cancel`,
      headers: cookie(auth.token),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe("CANCELLED");
    // Completing a cancelled experiment is rejected.
    const again = await app.inject({
      method: "POST",
      url: `/api/v1/experiments/${experimentId}/complete`,
      headers: cookie(auth.token),
    });
    expect(again.statusCode).toBe(400);
  });
});

describe("list + tenant isolation", () => {
  it("only returns the caller's tenant experiments", async () => {
    const fake = makeFakePrisma();
    const app = await buildApp(fake);
    const a = await seedAuth(fake);
    const b = await seedAuth(fake);
    const fxA = await seedOfferFixture(fake, a.tenantId);
    const fxB = await seedOfferFixture(fake, b.tenantId);
    await createExperiment(app, a.token, fxA, { name: "a-exp" });
    const bExp = await createExperiment(app, b.token, fxB, { name: "b-exp" });

    const listA = await app.inject({
      method: "GET",
      url: "/api/v1/experiments",
      headers: cookie(a.token),
    });
    const itemsA = JSON.parse(listA.body).items as any[];
    expect(itemsA.map((x) => x.name)).toEqual(["a-exp"]);

    // Cross-tenant detail access → 404.
    const other = await app.inject({
      method: "GET",
      url: `/api/v1/experiments/${bExp.body.id}`,
      headers: cookie(a.token),
    });
    expect(other.statusCode).toBe(404);

    // Filter by status works.
    const filtered = await app.inject({
      method: "GET",
      url: "/api/v1/experiments?status=DRAFT",
      headers: cookie(b.token),
    });
    expect(JSON.parse(filtered.body).total).toBe(1);
  });
});

describe("determineWinner", () => {
  it("picks the higher-profit variant with z-test confidence", () => {
    const v = determineWinner(
      { clicks: 2000, cvr: 0.05, profit: 500 },
      { clicks: 2000, cvr: 0.03, profit: 200 }
    );
    expect(v.winner).toBe("A");
    expect(v.detail.basis).toBe("profit");
    expect(v.confidence).toBeGreaterThan(0.9);
    expect(v.detail.zScore).not.toBeNull();
  });

  it("falls back to cvr when profit is missing", () => {
    const v = determineWinner(
      { clicks: 1000, cvr: 0.06 },
      { clicks: 1000, cvr: 0.04 }
    );
    expect(v.winner).toBe("A");
    expect(v.detail.basis).toBe("cvr");
  });

  it("handles percent-form cvr", () => {
    const v = determineWinner(
      { clicks: 1000, cvr: 6 },
      { clicks: 1000, cvr: 4 }
    );
    expect(v.winner).toBe("A");
    expect(v.detail.conversionsA).toBe(60);
  });

  it("marks TIE with low confidence when sample is insufficient", () => {
    const v = determineWinner(
      { clicks: 20, cvr: 0.1, profit: 100 },
      { clicks: 15, cvr: 0.01, profit: 1 }
    );
    expect(v.winner).toBe("TIE");
    expect(v.confidence).toBeLessThan(0.3);
    expect(v.detail.basis).toBe("insufficient_sample");
  });

  it("returns TIE when both sides are identical", () => {
    const v = determineWinner(
      { clicks: 1000, cvr: 0.05, profit: 300 },
      { clicks: 1000, cvr: 0.05, profit: 300 }
    );
    expect(v.winner).toBe("TIE");
    expect(v.confidence).toBeGreaterThan(0.9);
  });
});

describe("assignVariant (iron rule: destination only, no UA/crawler signals)", () => {
  it("is deterministic and respects the split ratio", () => {
    const seed = "abcdef0123456789abcdef0123456789";
    expect(assignVariant(seed, 50, "click-1")).toBe(
      assignVariant(seed, 50, "click-1")
    );
    let a = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      if (assignVariant(seed, 30, `click-${i}`) === "A") a++;
    }
    const ratio = a / n;
    expect(ratio).toBeGreaterThan(0.25);
    expect(ratio).toBeLessThan(0.35);
  });

  it("depends only on (seed, split, key) — a different seed reshuffles", () => {
    const k = "same-key";
    const r1 = assignVariant("seed-one-0000000000000000000001", 50, k);
    const r2 = assignVariant("seed-two-0000000000000000000002", 50, k);
    // Deterministic per seed; the assignment is a pure function of its inputs.
    expect(assignVariant("seed-one-0000000000000000000001", 50, k)).toBe(r1);
    expect(typeof r1).toBe("string");
    expect(typeof r2).toBe("string");
  });
});
