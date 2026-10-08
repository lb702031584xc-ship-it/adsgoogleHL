/**
 * Lander Intel ② — competitor watch route contract tests.
 * In-memory fake Prisma + Fastify inject; fetch is mocked.
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
import type { FetchedHtmlPage } from "../ai/fetch-page.js";
import { registerLanderIntelRoutes } from "./lander-intel.js";

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
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
      if (!row) throw new Error("row not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return { ...row };
    },
    count: async ({ where }: any) =>
      rows.filter((r) => matches(r, where)).length,
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
    competitorWatch: mkStore([]),
    competitorChange: mkStore([]),
    alert: mkStore([]),
  };
  return stores;
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

function cookie(token: string) {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

async function seedAuth(fake: FakePrisma, email = "u@example.com") {
  const tenantId = randomUUID();
  await (fake as any).tenant.create({
    data: { id: tenantId, name: "t", slug: `t-${tenantId.slice(0, 8)}`, status: "ACTIVE" },
  });
  const user = await (fake as any).user.create({
    data: {
      id: randomUUID(),
      tenantId,
      email,
      name: "u",
      role: "member",
      status: "ACTIVE",
    },
  });
  const session = await createSession(fake as unknown as PrismaClient, user.id);
  return { tenantId, token: session.token };
}

const HTML_V1 = `<html><head><title>Shoes Sale</title></head><body>
<h1>Buy shoes</h1><p>Price $99.99</p><button>Buy Now</button></body></html>`;
const HTML_V2 = `<html><head><title>Shoes Sale - New</title></head><body>
<h1>Buy shoes</h1><p>Price $79.99</p><button>Buy Now</button></body></html>`;

function makeFakeFetch(getHtml: () => string) {
  return async (url: string): Promise<FetchedHtmlPage> => {
    if (new URL(url).pathname === "/robots.txt") {
      throw new Error("robots fetch failed (status 404)");
    }
    const html = getHtml();
    return {
      finalUrl: url,
      html,
      text: "t",
      statusCode: 200,
      redirectChain: [],
      fetchMs: 5,
    };
  };
}

async function buildApp(
  fake: FakePrisma,
  fetchImpl?: (url: string) => Promise<FetchedHtmlPage>
): Promise<any> {
  const app = Fastify({ logger: false });
  app.setErrorHandler(createObservabilityErrorHandler());
  await registerLanderIntelRoutes(app, {
    prisma: fake as unknown as PrismaClient,
    fetchPageHtmlImpl: (fetchImpl ?? makeFakeFetch(() => HTML_V1)) as any,
  });
  return app;
}

async function seedWatch(
  fake: FakePrisma,
  tenantId: string,
  overrides: Partial<Row> = {}
): Promise<Row> {
  return (fake as any).competitorWatch.create({
    data: {
      id: randomUUID(),
      tenantId,
      name: "Competitor A",
      url: "https://competitor.example/landing",
      checkInterval: 3600,
      lastHash: null,
      lastCheckedAt: null,
      isActive: true,
      ...overrides,
    },
  });
}

describe("POST /api/v1/landing-pages/watches", () => {
  let fake: FakePrisma;
  let auth: { tenantId: string; token: string };
  beforeEach(async () => {
    fake = makeFakePrisma();
    auth = await seedAuth(fake);
  });

  it("rejects unauthenticated requests (401)", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/watches",
      payload: { name: "A", url: "https://example.com/" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects checkInterval below 3600 (400)", async () => {
    const app = await buildApp(fake);
    for (const bad of [1, 3599, 0, -5]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/landing-pages/watches",
        headers: cookie(auth.token),
        payload: { name: "A", url: "https://example.com/", checkInterval: bad },
      });
      expect(res.statusCode).toBe(400);
    }
    await app.close();
  });

  it("rejects non-http(s) URLs (400)", async () => {
    const app = await buildApp(fake);
    for (const bad of ["ftp://example.com/x", "javascript:alert(1)", "not a url"]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/landing-pages/watches",
        headers: cookie(auth.token),
        payload: { name: "A", url: bad },
      });
      expect(res.statusCode).toBe(400);
    }
    await app.close();
  });

  it("rejects missing name (400)", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/watches",
      headers: cookie(auth.token),
      payload: { url: "https://example.com/" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("creates a watch with defaults", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/watches",
      headers: cookie(auth.token),
      payload: { name: "Competitor A", url: "https://competitor.example/landing" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeTruthy();
    expect(body.name).toBe("Competitor A");
    expect(body.url).toBe("https://competitor.example/landing");
    expect(body.checkInterval).toBe(3600);
    expect(body.isActive).toBe(true);
    expect(body.lastHash).toBeNull();
    expect(body.changeCount).toBe(0);
    await app.close();
  });

  it("accepts a custom checkInterval >= 3600", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/watches",
      headers: cookie(auth.token),
      payload: {
        name: "A",
        url: "https://example.com/",
        checkInterval: 86400,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().checkInterval).toBe(86400);
    await app.close();
  });
});

describe("GET /api/v1/landing-pages/watches", () => {
  let fake: FakePrisma;
  let auth: { tenantId: string; token: string };
  beforeEach(async () => {
    fake = makeFakePrisma();
    auth = await seedAuth(fake);
  });

  it("rejects unauthenticated requests (401)", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/landing-pages/watches",
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("lists tenant watches with change counts and isolates tenants", async () => {
    const other = await seedAuth(fake, "other@example.com");
    const w1 = await seedWatch(fake, auth.tenantId);
    await seedWatch(fake, other.tenantId, {
      name: "Other tenant watch",
      url: "https://other.example/",
    });
    await (fake as any).competitorChange.create({
      data: {
        id: randomUUID(),
        tenantId: auth.tenantId,
        watchId: w1.id,
        changedAt: new Date(),
        diffSummary: { title: { before: null, after: "x" } },
      },
    });

    const app = await buildApp(fake);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/landing-pages/watches",
      headers: cookie(auth.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe(w1.id);
    expect(body.items[0].changeCount).toBe(1);
    await app.close();
  });

  it("excludes soft-deleted watches", async () => {
    await seedWatch(fake, auth.tenantId, { deletedAt: new Date() });
    await seedWatch(fake, auth.tenantId);
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/landing-pages/watches",
      headers: cookie(auth.token),
    });
    expect(res.json().total).toBe(1);
    await app.close();
  });
});

describe("PATCH /api/v1/landing-pages/watches/:id", () => {
  let fake: FakePrisma;
  let auth: { tenantId: string; token: string };
  beforeEach(async () => {
    fake = makeFakePrisma();
    auth = await seedAuth(fake);
  });

  it("updates name / isActive / checkInterval", async () => {
    const app = await buildApp(fake);
    const watch = await seedWatch(fake, auth.tenantId);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/landing-pages/watches/${watch.id}`,
      headers: cookie(auth.token),
      payload: { name: "Renamed", isActive: false, checkInterval: 7200 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("Renamed");
    expect(body.isActive).toBe(false);
    expect(body.checkInterval).toBe(7200);
    await app.close();
  });

  it("rejects checkInterval below 3600 (400)", async () => {
    const app = await buildApp(fake);
    const watch = await seedWatch(fake, auth.tenantId);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/landing-pages/watches/${watch.id}`,
      headers: cookie(auth.token),
      payload: { checkInterval: 600 },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("404s on another tenant's watch", async () => {
    const other = await seedAuth(fake, "other@example.com");
    const app = await buildApp(fake);
    const watch = await seedWatch(fake, other.tenantId);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/landing-pages/watches/${watch.id}`,
      headers: cookie(auth.token),
      payload: { name: "hijack" },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("DELETE /api/v1/landing-pages/watches/:id", () => {
  let fake: FakePrisma;
  let auth: { tenantId: string; token: string };
  beforeEach(async () => {
    fake = makeFakePrisma();
    auth = await seedAuth(fake);
  });

  it("soft-deletes the watch", async () => {
    const app = await buildApp(fake);
    const watch = await seedWatch(fake, auth.tenantId);
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/landing-pages/watches/${watch.id}`,
      headers: cookie(auth.token),
    });
    expect(res.statusCode).toBe(200);
    const row = await (fake as any).competitorWatch.findFirst({
      where: { id: watch.id },
    });
    expect(row.deletedAt).toBeInstanceOf(Date);
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/landing-pages/watches",
      headers: cookie(auth.token),
    });
    expect(list.json().total).toBe(0);
    await app.close();
  });

  it("404s on another tenant's watch", async () => {
    const other = await seedAuth(fake, "other@example.com");
    const app = await buildApp(fake);
    const watch = await seedWatch(fake, other.tenantId);
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/landing-pages/watches/${watch.id}`,
      headers: cookie(auth.token),
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("GET /api/v1/landing-pages/watches/:id/changes", () => {
  let fake: FakePrisma;
  let auth: { tenantId: string; token: string };
  beforeEach(async () => {
    fake = makeFakePrisma();
    auth = await seedAuth(fake);
  });

  it("returns the paginated change timeline", async () => {
    const app = await buildApp(fake);
    const watch = await seedWatch(fake, auth.tenantId);
    for (let i = 0; i < 3; i++) {
      await (fake as any).competitorChange.create({
        data: {
          id: randomUUID(),
          tenantId: auth.tenantId,
          watchId: watch.id,
          changedAt: new Date(Date.now() - i * 1000),
          diffSummary: { title: { before: `t${i}`, after: `t${i + 1}` } },
        },
      });
    }
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/landing-pages/watches/${watch.id}/changes?page=1&pageSize=2`,
      headers: cookie(auth.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].diffSummary.title.after).toBe("t1");
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(2);
    await app.close();
  });

  it("404s on another tenant's watch", async () => {
    const other = await seedAuth(fake, "other@example.com");
    const app = await buildApp(fake);
    const watch = await seedWatch(fake, other.tenantId);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/landing-pages/watches/${watch.id}/changes`,
      headers: cookie(auth.token),
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("POST /api/v1/landing-pages/watches/:id/check", () => {
  let fake: FakePrisma;
  let auth: { tenantId: string; token: string };
  beforeEach(async () => {
    fake = makeFakePrisma();
    auth = await seedAuth(fake);
  });

  it("runs a scan synchronously: baseline then detected change", async () => {
    let current = HTML_V1;
    const app = await buildApp(fake, makeFakeFetch(() => current));
    const watch = await seedWatch(fake, auth.tenantId);

    const r1 = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/watches/${watch.id}/check`,
      headers: cookie(auth.token),
    });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().changed).toBe(false);
    expect(r1.json().baseline).toBe(true);

    current = HTML_V2;
    const r2 = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/watches/${watch.id}/check`,
      headers: cookie(auth.token),
    });
    expect(r2.statusCode).toBe(200);
    const body = r2.json();
    expect(body.changed).toBe(true);
    expect(body.changeId).toBeTruthy();
    expect(body.diff.title.after).toBe("Shoes Sale - New");

    const timeline = await app.inject({
      method: "GET",
      url: `/api/v1/landing-pages/watches/${watch.id}/changes`,
      headers: cookie(auth.token),
    });
    expect(timeline.json().total).toBe(1);
    await app.close();
  });

  it("404s on another tenant's watch", async () => {
    const other = await seedAuth(fake, "other@example.com");
    const app = await buildApp(fake);
    const watch = await seedWatch(fake, other.tenantId);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/watches/${watch.id}/check`,
      headers: cookie(auth.token),
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("rejects unauthenticated requests (401)", async () => {
    const app = await buildApp(fake);
    const watch = await seedWatch(fake, auth.tenantId);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/watches/${watch.id}/check`,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
