/**
 * Lander Intel ③ — template library route contract tests.
 * In-memory fake Prisma + Fastify inject; pure additive endpoints.
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
import {
  TEST_AI_SETTINGS_PEPPER,
  encryptSecret,
} from "../ai/crypto.js";
import { createObservabilityErrorHandler } from "../observability/index.js";
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
    findFirst: async (args: any = {}) => {
      const { where, orderBy } = args;
      return (
        sortRows(
          rows.filter((r) => matches(r, where)),
          orderBy
        )[0] ?? null
      );
    },
    findMany: async (args: any = {}) => {
      const { where, orderBy, skip, take } = args;
      let out = sortRows(
        rows.filter((r) => matches(r, where)),
        orderBy
      );
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
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return { ...row };
    },
  };
}

function makeFakePrisma() {
  const tenants: Row[] = [];
  const users: Row[] = [];
  const sessions: Row[] = [];
  const aiSettings: Row[] = [];
  const landerTemplates: Row[] = [];
  const landingPages: Row[] = [];
  const landingPageRewrites: Row[] = [];
  const offers: Row[] = [];
  const stores = {
    tenant: mkStore(tenants),
    user: mkStore(users),
    aiSetting: mkStore(aiSettings),
    landerTemplate: mkStore(landerTemplates),
    landingPage: mkStore(landingPages),
    landingPageRewrite: mkStore(landingPageRewrites),
    offer: mkStore(offers),
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

async function seedOffer(fake: FakePrisma, tenantId: string) {
  return (fake as any).offer.create({
    data: {
      id: randomUUID(),
      tenantId,
      name: "Test Offer",
      network: "impact",
      destinationUrl: "https://merchant.example/offer",
      status: "ACTIVE",
    },
  });
}

async function buildApp(fake: FakePrisma): Promise<any> {
  const app = Fastify({ logger: false });
  app.setErrorHandler(createObservabilityErrorHandler());
  await registerLanderIntelRoutes(app, {
    prisma: fake as unknown as PrismaClient,
    fetchPageHtmlImpl: (async () => {
      throw new Error("not used");
    }) as any,
    chatJsonImpl: (async () => ({})) as any,
  });
  return app;
}

const CUSTOM_TEMPLATE_BODY = {
  name: "My Review",
  category: "review",
  description: "custom",
  htmlTemplate: "<h1>{{productName}}</h1><p>{{price}}</p>",
};

describe("GET /api/v1/landing-pages/templates", () => {
  let fake: FakePrisma;
  let auth: { tenantId: string; token: string };
  beforeEach(async () => {
    fake = makeFakePrisma();
    auth = await seedAuth(fake);
  });

  it("returns the built-in templates for a fresh tenant", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/landing-pages/templates",
      headers: cookie(auth.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(8);
    expect(body.items.map((i: any) => i.id)).toEqual([
      "builtin-review",
      "builtin-comparison",
      "builtin-listicle",
      "builtin-review-painstory",
      "builtin-comparison-showdown",
      "builtin-listicle-scenario",
      "builtin-coupon",
      "builtin-guide",
    ]);
    for (const item of body.items) {
      expect(item.isBuiltIn).toBe(true);
      expect(item.tenantId).toBeNull();
      expect(Array.isArray(item.variables)).toBe(true);
      expect(item.variables.length).toBeGreaterThan(0);
    }
  });

  it("filters by category", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/landing-pages/templates?category=review",
      headers: cookie(auth.token),
    });
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.items.map((i: any) => i.id).sort()).toEqual(
      ["builtin-review", "builtin-review-painstory"].sort()
    );
  });

  it("filters by the new coupon/guide categories", async () => {
    const app = await buildApp(fake);
    const coupon = await app.inject({
      method: "GET",
      url: "/api/v1/landing-pages/templates?category=coupon",
      headers: cookie(auth.token),
    });
    expect(coupon.json().items.map((i: any) => i.id)).toEqual([
      "builtin-coupon",
    ]);
    const guide = await app.inject({
      method: "GET",
      url: "/api/v1/landing-pages/templates?category=guide",
      headers: cookie(auth.token),
    });
    expect(guide.json().items.map((i: any) => i.id)).toEqual([
      "builtin-guide",
    ]);
  });

  it("rejects an invalid category", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/landing-pages/templates?category=nope",
      headers: cookie(auth.token),
    });
    expect(res.statusCode).toBe(400);
  });

  it("merges the tenant's custom templates but hides other tenants'", async () => {
    const otherTenant = randomUUID();
    await (fake as any).landerTemplate.create({
      data: {
        id: randomUUID(),
        tenantId: otherTenant,
        name: "Other Tenant Template",
        category: "review",
        description: null,
        htmlTemplate: "<p>{{x}}</p>",
        thumbnailUrl: null,
        isBuiltIn: false,
      },
    });
    await (fake as any).landerTemplate.create({
      data: {
        id: randomUUID(),
        tenantId: auth.tenantId,
        name: "Mine",
        category: "quiz",
        description: null,
        htmlTemplate: "<p>{{q}}</p>",
        thumbnailUrl: null,
        isBuiltIn: false,
      },
    });
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/landing-pages/templates",
      headers: cookie(auth.token),
    });
    const body = res.json();
    expect(body.total).toBe(9);
    const names = body.items.map((i: any) => i.name);
    expect(names).toContain("Mine");
    expect(names).not.toContain("Other Tenant Template");
    const mine = body.items.find((i: any) => i.name === "Mine");
    expect(mine.isBuiltIn).toBe(false);
    expect(mine.tenantId).toBe(auth.tenantId);
    expect(mine.variables).toEqual(["q"]);
  });

  it("returns 401 without a session", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/landing-pages/templates",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /api/v1/landing-pages/templates/:id (preview)", () => {
  let fake: FakePrisma;
  let auth: { tenantId: string; token: string };
  beforeEach(async () => {
    fake = makeFakePrisma();
    auth = await seedAuth(fake);
  });

  it("renders a built-in template with query variables, escaped", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "GET",
      url:
        "/api/v1/landing-pages/templates/builtin-review?lang=en" +
        "&variables[productName]=" +
        encodeURIComponent(`"><script>alert(1)</script>`) +
        "&variables[price]=$49",
      headers: cookie(auth.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.html).toContain("$49");
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("supports a JSON-encoded variables param", async () => {
    const app = await buildApp(fake);
    const vars = encodeURIComponent(
      JSON.stringify({ productName: "Shoes", pros: ["light", "cheap"] })
    );
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/landing-pages/templates/builtin-review?variables=${vars}`,
      headers: cookie(auth.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().html).toContain("<li>light</li><li>cheap</li>");
  });

  it("renders listicle products as cards", async () => {
    const app = await buildApp(fake);
    const vars = encodeURIComponent(
      JSON.stringify({
        productName: "VPN",
        products: [
          {
            rank: "1",
            name: "Fast <VPN>",
            blurb: "fast & safe",
            price: "$3",
            ctaUrl: "https://example.com/vpn",
          },
        ],
        ctaText: "Get",
      })
    );
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/landing-pages/templates/builtin-listicle?variables=${vars}`,
      headers: cookie(auth.token),
    });
    expect(res.statusCode).toBe(200);
    const html = res.json().html;
    expect(html).toContain("lp-card");
    expect(html).toContain("Fast &lt;VPN&gt;");
    expect(html).toContain("fast &amp; safe");
  });

  it("returns 404 for an unknown template id", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/landing-pages/templates/nope",
      headers: cookie(auth.token),
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without a session", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/landing-pages/templates/builtin-review",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /api/v1/landing-pages/templates", () => {
  let fake: FakePrisma;
  let auth: { tenantId: string; token: string };
  beforeEach(async () => {
    fake = makeFakePrisma();
    auth = await seedAuth(fake);
  });

  it("creates a tenant custom template", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/templates",
      headers: cookie(auth.token),
      payload: CUSTOM_TEMPLATE_BODY,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.isBuiltIn).toBe(false);
    expect(body.tenantId).toBe(auth.tenantId);
    expect(body.variables).toEqual(["price", "productName"]);
  });

  it("rejects an invalid category and a missing name/htmlTemplate", async () => {
    const app = await buildApp(fake);
    for (const payload of [
      { ...CUSTOM_TEMPLATE_BODY, category: "nope" },
      { ...CUSTOM_TEMPLATE_BODY, name: "  " },
      { ...CUSTOM_TEMPLATE_BODY, htmlTemplate: "" },
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/landing-pages/templates",
        headers: cookie(auth.token),
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it("returns 401 without a session", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/templates",
      payload: CUSTOM_TEMPLATE_BODY,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /api/v1/landing-pages/templates/:id/use", () => {
  let fake: FakePrisma;
  let auth: { tenantId: string; token: string };
  let offerId: string;
  beforeEach(async () => {
    fake = makeFakePrisma();
    auth = await seedAuth(fake);
    offerId = (await seedOffer(fake, auth.tenantId)).id;
  });

  it("renders a built-in template and creates a LandingPage with htmlContent", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/templates/builtin-review/use",
      headers: cookie(auth.token),
      payload: {
        offerId,
        name: "My review page",
        variables: {
          productName: `Evil " <b>`,
          price: "$49",
          ctaUrl: "javascript:alert(1)",
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.offerId).toBe(offerId);
    expect(body.name).toBe("My review page");

    const stored = (await (fake as any).landingPage.findFirst({
      where: { id: body.id },
    })) as any;
    expect(stored.tenantId).toBe(auth.tenantId);
    expect(stored.htmlContent).toContain(
      "Evil &quot; &lt;b&gt;"
    );
    expect(stored.htmlContent).not.toContain("javascript:");
    expect(stored.htmlContent).toContain('href="#"');
  });

  it("stores url/domain when a valid url is provided", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/templates/builtin-review/use",
      headers: cookie(auth.token),
      payload: {
        offerId,
        name: "Hosted page",
        variables: {},
        url: "https://pages.example.com/review",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toBe("https://pages.example.com/review");
    expect(res.json().domain).toBe("pages.example.com");
  });

  it("uses a tenant custom template", async () => {
    const app = await buildApp(fake);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/templates",
      headers: cookie(auth.token),
      payload: CUSTOM_TEMPLATE_BODY,
    });
    const templateId = created.json().id;
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/templates/${templateId}/use`,
      headers: cookie(auth.token),
      payload: {
        offerId,
        name: "Custom page",
        variables: { productName: "X", price: "$1" },
      },
    });
    expect(res.statusCode).toBe(200);
    const stored = (await (fake as any).landingPage.findFirst({
      where: { id: res.json().id },
    })) as any;
    expect(stored.htmlContent).toBe("<h1>X</h1><p>$1</p>");
  });

  it("requires offerId and name, and rejects unknown offers / templates", async () => {
    const app = await buildApp(fake);
    const noOffer = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/templates/builtin-review/use",
      headers: cookie(auth.token),
      payload: { name: "x", variables: {} },
    });
    expect(noOffer.statusCode).toBe(400);

    const badOffer = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/templates/builtin-review/use",
      headers: cookie(auth.token),
      payload: { offerId: randomUUID(), name: "x", variables: {} },
    });
    expect(badOffer.statusCode).toBe(404);

    const badTemplate = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/templates/nope/use",
      headers: cookie(auth.token),
      payload: { offerId, name: "x", variables: {} },
    });
    expect(badTemplate.statusCode).toBe(404);
  });

  it("rejects an offer from another tenant", async () => {
    const otherOffer = (await (fake as any).offer.create({
      data: {
        id: randomUUID(),
        tenantId: randomUUID(),
        name: "Other",
        network: "x",
        destinationUrl: "https://x.example",
        status: "ACTIVE",
      },
    })) as any;
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/templates/builtin-review/use",
      headers: cookie(auth.token),
      payload: { offerId: otherOffer.id, name: "x", variables: {} },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without a session", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/templates/builtin-review/use",
      payload: { offerId, name: "x", variables: {} },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /api/v1/landing-pages/templates/:id/rewrite-brief", () => {
  let fake: FakePrisma;
  let auth: { tenantId: string; token: string };
  let seenChatArgs: any;

  async function seedLlm() {
    await (fake as any).aiSetting.create({
      data: { key: "llm.baseUrl", value: "https://api.test/v1" },
    });
    await (fake as any).aiSetting.create({
      data: { key: "llm.model", value: "test-model" },
    });
    await (fake as any).aiSetting.create({
      data: {
        key: "llm.apiKeyEnc",
        value: encryptSecret("<redacted>", TEST_AI_SETTINGS_PEPPER),
      },
    });
  }

  async function buildBriefApp() {
    const app = Fastify({ logger: false });
    app.setErrorHandler(createObservabilityErrorHandler());
    await registerLanderIntelRoutes(app, {
      prisma: fake as unknown as PrismaClient,
      fetchPageHtmlImpl: (async () => {
        throw new Error("not used");
      }) as any,
      chatJsonImpl: (async (args: any) => {
        seenChatArgs = args;
        return {
          rewrites: [
            {
              element: "优惠码",
              location: "优惠码展示框",
              before: "SAVE40",
              after: "SAVE40PLUS",
              reason: "测试改写",
            },
          ],
          estimatedNewScore: 88,
        };
      }) as any,
    });
    return app;
  }

  beforeEach(async () => {
    fake = makeFakePrisma();
    auth = await seedAuth(fake);
    seenChatArgs = null;
    await seedLlm();
  });

  const BRIEF = {
    lang: "zh",
    variables: {
      productName: "TestProduct",
      discountInfo: "40% OFF",
      couponCode: "SAVE40",
      price: "$49",
      originalPrice: "$99",
      expiryText: "Ends Sunday",
      ctaText: "立即抢购",
      ctaUrl: "https://merchant.example/deal",
    },
    requirements: {
      targetAudience: "25-35 岁精打细算的上班族",
      sellingPoints: ["限时 4 折", "30 天无理由退款"],
      tone: "urgent",
      ctaText: "立即抢购",
      language: "zh",
      length: "short",
    },
  };

  it("renders the template and stores a DRAFT brief with the base HTML", async () => {
    const app = await buildBriefApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/templates/builtin-coupon/rewrite-brief",
      headers: { ...cookie(auth.token), "content-type": "application/json" },
      payload: BRIEF,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const rw = body.rewrite;
    expect(rw.status).toBe("DRAFT");
    expect(rw.landingPageId).toBeNull();
    expect(rw.rewrittenContent.source).toEqual({
      kind: "template",
      templateId: "builtin-coupon",
      lang: "zh",
    });
    expect(rw.rewrittenContent.baseHtml).toContain("TestProduct");
    expect(rw.rewrittenContent.rewrites).toHaveLength(1);
    expect(rw.rewrittenContent.appliedCount).toBe(1);
    expect(rw.rewrittenContent.requirements.targetAudience).toBe(
      "25-35 岁精打细算的上班族"
    );
    expect(Number.isFinite(rw.originalScore)).toBe(true);
    expect(Number.isFinite(rw.newScore)).toBe(true);
    // The brief actually reached the LLM prompt.
    expect(seenChatArgs.user).toContain("25-35 岁精打细算的上班族");
    expect(seenChatArgs.user).toContain("限时 4 折");
    expect(seenChatArgs.user).toContain("TestProduct");
  });

  it("requires requirements and rejects malformed ones with 400", async () => {
    const app = await buildBriefApp();
    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/templates/builtin-coupon/rewrite-brief",
      headers: { ...cookie(auth.token), "content-type": "application/json" },
      payload: { lang: "zh", variables: {} },
    });
    expect(missing.statusCode).toBe(400);

    const badTone = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/templates/builtin-coupon/rewrite-brief",
      headers: { ...cookie(auth.token), "content-type": "application/json" },
      payload: { requirements: { tone: "nope" } },
    });
    expect(badTone.statusCode).toBe(400);
  });

  it("returns 404 for an unknown template and 401 without a session", async () => {
    const app = await buildBriefApp();
    const notFound = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/templates/nope/rewrite-brief",
      headers: { ...cookie(auth.token), "content-type": "application/json" },
      payload: BRIEF,
    });
    expect(notFound.statusCode).toBe(404);

    const noAuth = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/templates/builtin-coupon/rewrite-brief",
      headers: { "content-type": "application/json" },
      payload: BRIEF,
    });
    expect(noAuth.statusCode).toBe(401);
  });

  it("returns 502 when the LLM is not configured", async () => {
    fake = makeFakePrisma();
    auth = await seedAuth(fake);
    const app = await buildBriefApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/templates/builtin-coupon/rewrite-brief",
      headers: { ...cookie(auth.token), "content-type": "application/json" },
      payload: BRIEF,
    });
    expect(res.statusCode).toBe(502);
  });
});
