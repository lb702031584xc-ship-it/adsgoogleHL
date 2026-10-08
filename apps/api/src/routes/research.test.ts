/**
 * Phase 4 Research Lab — route contract tests.
 * In-memory fake Prisma + Fastify inject; injected fake fetcher (no network).
 * Covers: create → run → finding persistence, tenant isolation, simulate.
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
import { registerResearchRoutes } from "./research.js";
import { CLASSIFICATIONS } from "../research/classifier.js";
import type {
  RequestVariant,
  VariantFetchResult,
} from "../research/fetcher.js";

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
      if ("in" in v && !((v as any).in as any[]).includes(rv)) return false;
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
    findMany: async ({ where, orderBy, skip, take }: any) => {
      const sorted = sortRows(rows.filter((r) => matches(r, where)), orderBy);
      const sliced =
        typeof skip === "number" ? sorted.slice(skip) : sorted;
      return (typeof take === "number" ? sliced.slice(0, take) : sliced).map(
        (r) => ({ ...r })
      );
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
      if (!row) throw new Error("fake: row not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return { ...row };
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of rows) {
        if (matches(row, where)) {
          Object.assign(row, data, { updatedAt: new Date() });
          count += 1;
        }
      }
      return { count };
    },
    count: async ({ where }: any) => rows.filter((r) => matches(r, where)).length,
  };
}

function makeFakePrisma() {
  const tenants: Row[] = [];
  const users: Row[] = [];
  const sessions: Row[] = [];
  const offers: Row[] = [];
  const tests: Row[] = [];
  const responses: Row[] = [];
  const findings: Row[] = [];
  return {
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
      delete: async ({ where }: any) => {
        const idx = sessions.findIndex((r) => matches(r, where));
        if (idx >= 0) sessions.splice(idx, 1);
        return {};
      },
    },
    offer: mkStore(offers),
    researchTest: mkStore(tests),
    researchResponse: mkStore(responses),
    cloakingFinding: mkStore(findings),
    _rows: { tenants, users, sessions, offers, tests, responses, findings },
  };
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

function cookie(token: string) {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

async function seedAuth(
  fake: FakePrisma,
  role: "admin" | "member" | "researcher" = "member"
) {
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

/** Fake fetcher: distinct HTML per variant, no network. */
function cannedFetch(
  url: string,
  variants: RequestVariant[]
): Promise<VariantFetchResult[]> {
  const texts = [
    "buy cheap running shoes free shipping sale",
    "kaufen billige laufschuhe versandkostenfrei",
    "buy cheap running shoes free shipping sale",
  ];
  return Promise.resolve(
    variants.map((v, i) => ({
      variantName: v.name,
      httpStatus: 200,
      finalUrl: url,
      redirectChain: [],
      headers: { "content-type": "text/html" },
      htmlHash: `hash-${i}`,
      contentHash: `content-${i}`,
      textExcerpt: texts[i % texts.length]!,
      linksCount: 10,
      scriptsCount: 2,
      meta: {},
      fetchedAt: new Date(),
    }))
  );
}

async function buildApp(fake: FakePrisma): Promise<any> {
  const app = Fastify({ logger: false });
  app.setErrorHandler(createObservabilityErrorHandler());
  await registerResearchRoutes(app, {
    prisma: fake as unknown as PrismaClient,
    fetchVariantsImpl: cannedFetch,
  });
  return app;
}

describe("research routes", () => {
  let fake: FakePrisma;
  let app: any;
  let token: string;

  beforeEach(async () => {
    fake = makeFakePrisma();
    ({ token } = await seedAuth(fake, "member"));
    app = await buildApp(fake);
  });

  it("requires authentication (401 without session)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/research/tests" });
    expect(res.statusCode).toBe(401);
  });

  it("creates a test with default variants", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/research/tests",
      headers: cookie(token),
      payload: { targetUrl: "https://example.com/offer" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("PENDING");
    expect(body.targetUrl).toBe("https://example.com/offer");
    expect(body.variants).toHaveLength(3);
    expect(body.variants.map((v: any) => v.name)).toEqual([
      "desktop-us",
      "mobile-us",
      "desktop-de",
    ]);
  });

  it("creates a test from an offer in the same tenant", async () => {
    const me = await seedAuth(fake, "member");
    const offer = await (fake as any).offer.create({
      data: {
        id: randomUUID(),
        tenantId: me.tenantId,
        name: "My offer",
        network: "net",
        destinationUrl: "https://merchant.example/landing",
        status: "ACTIVE",
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/research/tests",
      headers: cookie(me.token),
      payload: { offerId: offer.id, name: "offer test" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().targetUrl).toBe("https://merchant.example/landing");
  });

  it("rejects unknown offerId with 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/research/tests",
      headers: cookie(token),
      payload: { offerId: randomUUID() },
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects invalid targetUrl with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/research/tests",
      headers: cookie(token),
      payload: { targetUrl: "ftp://example.com/" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects duplicate variant names with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/research/tests",
      headers: cookie(token),
      payload: {
        targetUrl: "https://example.com/",
        variants: [
          { name: "a", userAgent: "ua", acceptLanguage: "en-US" },
          { name: "a", userAgent: "ua", acceptLanguage: "en-US" },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("lists tests and shows detail", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/research/tests",
      headers: cookie(token),
      payload: { targetUrl: "https://example.com/" },
    });
    const id = created.json().id;

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/research/tests",
      headers: cookie(token),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBe(1);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/research/tests/${id}`,
      headers: cookie(token),
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().responses).toEqual([]);
  });

  it("finding 404s before the test runs", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/research/tests",
      headers: cookie(token),
      payload: { targetUrl: "https://example.com/" },
    });
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/research/tests/${created.json().id}/finding`,
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(404);
  });

  it("run: fetches variants → persists responses → writes finding", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/research/tests",
      headers: cookie(token),
      payload: { targetUrl: "https://example.com/offer" },
    });
    const id = created.json().id;

    const run = await app.inject({
      method: "POST",
      url: `/api/v1/research/tests/${id}/run`,
      headers: cookie(token),
      payload: {},
    });
    expect(run.statusCode).toBe(200);
    const body = run.json();
    expect(body.test.status).toBe("COMPLETED");
    expect(body.responses).toHaveLength(3);
    expect(body.finding.differentialScore).toBeGreaterThan(0);
    expect(body.finding.differentialScore).toBeLessThanOrEqual(100);
    expect(["NORMAL", "MINOR", "SUSPICIOUS", "HIGH_RISK", "STRONG"]).toContain(
      body.finding.band
    );
    expect(CLASSIFICATIONS as readonly string[]).toContain(
      body.finding.classification
    );
    expect(body.finding.evidence.pairs.length).toBe(3);
    expect(body.finding.evidence.worstPair).not.toBeNull();

    // Persisted: GET finding returns the same row.
    const got = await app.inject({
      method: "GET",
      url: `/api/v1/research/tests/${id}/finding`,
      headers: cookie(token),
    });
    expect(got.statusCode).toBe(200);
    expect(got.json().id).toBe(body.finding.id);
  });

  it("run twice keeps a single active finding (soft-delete)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/research/tests",
      headers: cookie(token),
      payload: { targetUrl: "https://example.com/" },
    });
    const id = created.json().id;
    await app.inject({
      method: "POST",
      url: `/api/v1/research/tests/${id}/run`,
      headers: cookie(token),
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/research/tests/${id}/run`,
      headers: cookie(token),
      payload: {},
    });
    const active = (fake._rows.findings as Row[]).filter((f) => !f.deletedAt);
    expect(active).toHaveLength(1);
    const activeResponses = (fake._rows.responses as Row[]).filter(
      (r) => !r.deletedAt
    );
    expect(activeResponses).toHaveLength(3);
  });

  it("run on unknown test → 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/research/tests/${randomUUID()}/run`,
      headers: cookie(token),
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant isolation: another tenant cannot see the test", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/research/tests",
      headers: cookie(token),
      payload: { targetUrl: "https://example.com/" },
    });
    const id = created.json().id;
    const other = await seedAuth(fake, "member");
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/research/tests/${id}`,
      headers: cookie(other.token),
    });
    expect(res.statusCode).toBe(404);
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/research/tests",
      headers: cookie(other.token),
    });
    expect(list.json().total).toBe(0);
  });

  it("researcher role can use research endpoints", async () => {
    const r = await seedAuth(fake, "researcher");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/research/tests",
      headers: cookie(r.token),
    });
    expect(res.statusCode).toBe(200);
  });

  it("simulate runs the pipeline without DB writes", async () => {
    const html = "<html><body><p>hello world</p><a href='/x'>x</a></body></html>";
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/research/simulate",
      headers: cookie(token),
      payload: { htmlA: html, htmlB: html },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.score).toBe(0);
    expect(body.band).toBe("NORMAL");
    expect(body.classification.classification).toBe("NORMAL_AB_TEST");
    expect((fake._rows.tests as Row[])).toHaveLength(0);
  });

  it("simulate requires both htmlA and htmlB", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/research/simulate",
      headers: cookie(token),
      payload: { htmlA: "<p>x</p>" },
    });
    expect(res.statusCode).toBe(400);
  });
});
