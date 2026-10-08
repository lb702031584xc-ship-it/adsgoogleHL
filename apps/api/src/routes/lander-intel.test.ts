/**
 * Lander Intel ① — route contract tests.
 * In-memory fake Prisma + Fastify inject; fetch and LLM are mocked.
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
  assertAiSettingsPepperConfigured,
  encryptSecret,
} from "../ai/crypto.js";
import type { ChatJsonArgs } from "../ai/llm.js";
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
    count: async ({ where }: any) =>
      rows.filter((r) => matches(r, where)).length,
  };
}

const GOOD_HTML = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>超值跑鞋</title><style>@media (max-width:768px){.a{color:red}}</style>
</head><body class="md:flex">
<h1>超轻透气跑鞋，跑步更轻松</h1>
<p>原价 ¥899，现价 ¥499，限时优惠！</p>
<button>立即购买</button><a href="/t">免费试用</a>
<p>用户评价 ★★★★★ 4.9分</p><p>官方认证 · 正品保障</p>
<p>电话：400-123-4567 <a href="mailto:a@b.c">a@b.c</a></p>
<footer><a href="/privacy">隐私政策</a></footer>
</body></html>`;

function makeFakeFetch(html: string = GOOD_HTML): (
  url: string
) => Promise<FetchedHtmlPage> {
  return async (url: string) => ({
    finalUrl: url,
    html,
    text: "text",
    statusCode: 200,
    redirectChain: [],
    fetchMs: 150,
  });
}

function makeFakeChatJson(suggestions: unknown = { suggestions: [{ text: "在 H1 下方增加价格锚点" }] }) {
  return async (_args: ChatJsonArgs) => suggestions;
}

function makeFakePrisma() {
  const tenants: Row[] = [];
  const users: Row[] = [];
  const sessions: Row[] = [];
  const aiSettings: Row[] = [];
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
    aiSetting: {
      findMany: async () => [...aiSettings],
    },
    landerAnalysis: mkStore([]),
  };
  return { ...stores, aiSettings };
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

function cookie(token: string) {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

async function seedAuth(fake: FakePrisma) {
  const tenantId = randomUUID();
  await (fake as any).tenant.create({
    data: { id: tenantId, name: "t", slug: "t", status: "ACTIVE" },
  });
  const user = await (fake as any).user.create({
    data: {
      id: randomUUID(),
      tenantId,
      email: "u@example.com",
      name: "u",
      role: "member",
      status: "ACTIVE",
    },
  });
  const session = await createSession(fake as unknown as PrismaClient, user.id);
  return { tenantId, token: session.token };
}

function seedAiSettings(fake: FakePrisma) {
  const pepper = assertAiSettingsPepperConfigured();
  fake.aiSettings.push(
    { key: "llm.baseUrl", value: "https://fake-llm.example/v1" },
    { key: "llm.model", value: "fake-model" },
    { key: "llm.apiKeyEnc", value: encryptSecret("fake-key", pepper) }
  );
}

async function buildApp(
  fake: FakePrisma,
  opts: {
    fetch?: (url: string) => Promise<FetchedHtmlPage>;
    chatJson?: (args: ChatJsonArgs) => Promise<unknown>;
  } = {}
): Promise<any> {
  const app = Fastify({ logger: false });
  app.setErrorHandler(createObservabilityErrorHandler());
  await registerLanderIntelRoutes(app, {
    prisma: fake as unknown as PrismaClient,
    fetchPageHtmlImpl: (opts.fetch ?? makeFakeFetch()) as any,
    chatJsonImpl: (opts.chatJson ?? makeFakeChatJson()) as any,
  });
  return app;
}

describe("POST /api/v1/landing-pages/analyze", () => {
  let fake: FakePrisma;
  let auth: { tenantId: string; token: string };
  beforeEach(async () => {
    fake = makeFakePrisma();
    auth = await seedAuth(fake);
    seedAiSettings(fake);
  });

  it("analyzes, stores and returns the full report", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/analyze",
      headers: cookie(auth.token),
      payload: { url: "https://shop.example/product" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeTruthy();
    expect(body.url).toBe("https://shop.example/product");
    expect(body.domain).toBe("shop.example");
    expect(typeof body.overallScore).toBe("number");
    expect(body.scores.cta).toBeGreaterThanOrEqual(85);
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.suggestions).toHaveLength(1);
    expect(body.suggestions[0].dataQuality).toBe("PREDICTED");
    expect(body.analyzedAt).toBeTruthy();

    // persisted and tenant-scoped
    const rows = await (fake as any).landerAnalysis.findMany({});
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantId).toBe(auth.tenantId);
  });

  it("works without LLM configured (suggestions skipped)", async () => {
    const noLlm = makeFakePrisma();
    const a2 = await seedAuth(noLlm);
    const app = await buildApp(noLlm);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/analyze",
      headers: cookie(a2.token),
      payload: { url: "https://shop.example/product" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestions).toEqual([]);
  });

  it("rejects non-http(s) URLs", async () => {
    const app = await buildApp(fake);
    for (const bad of ["ftp://example.com/x", "not a url", "javascript:alert(1)"]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/landing-pages/analyze",
        headers: cookie(auth.token),
        payload: { url: bad },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it("rejects missing url", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/analyze",
      headers: cookie(auth.token),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a session", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/analyze",
      payload: { url: "https://shop.example/product" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /api/v1/landing-pages/analyses", () => {
  it("lists with pagination and isolates tenants", async () => {
    const fake = makeFakePrisma();
    const a = await seedAuth(fake);
    const b = await seedAuth(fake);
    seedAiSettings(fake);
    const app = await buildApp(fake);

    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: "POST",
        url: "/api/v1/landing-pages/analyze",
        headers: cookie(a.token),
        payload: { url: `https://a.example/p${i}` },
      });
    }
    await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/analyze",
      headers: cookie(b.token),
      payload: { url: "https://b.example/other" },
    });

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/landing-pages/analyses?page=1&pageSize=2",
      headers: cookie(a.token),
    });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(2);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(2);
    expect(
      body.items.every((i: any) => i.url.startsWith("https://a.example"))
    ).toBe(true);

    const listB = await app.inject({
      method: "GET",
      url: "/api/v1/landing-pages/analyses",
      headers: cookie(b.token),
    });
    expect(listB.json().total).toBe(1);
  });

  it("returns 401 without a session", async () => {
    const fake = makeFakePrisma();
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/landing-pages/analyses",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /api/v1/landing-pages/analyses/:id", () => {
  it("returns the analysis, 404 for other tenants or unknown ids", async () => {
    const fake = makeFakePrisma();
    const a = await seedAuth(fake);
    const b = await seedAuth(fake);
    seedAiSettings(fake);
    const app = await buildApp(fake);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/analyze",
      headers: cookie(a.token),
      payload: { url: "https://a.example/p1" },
    });
    const id = created.json().id;

    const got = await app.inject({
      method: "GET",
      url: `/api/v1/landing-pages/analyses/${id}`,
      headers: cookie(a.token),
    });
    expect(got.statusCode).toBe(200);
    expect(got.json().id).toBe(id);

    const other = await app.inject({
      method: "GET",
      url: `/api/v1/landing-pages/analyses/${id}`,
      headers: cookie(b.token),
    });
    expect(other.statusCode).toBe(404);

    const missing = await app.inject({
      method: "GET",
      url: `/api/v1/landing-pages/analyses/${randomUUID()}`,
      headers: cookie(a.token),
    });
    expect(missing.statusCode).toBe(404);
  });
});
