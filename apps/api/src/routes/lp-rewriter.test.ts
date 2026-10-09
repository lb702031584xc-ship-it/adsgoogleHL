/**
 * LP AI rewriter routes — Fastify inject over an in-memory fake Prisma.
 * Auth: requireTenant in "disabled" mode reads the tenant from the
 * x-tenant-id header; tenant isolation is asserted with a second tenant.
 * The LLM client is a mock chatJsonImpl; it also captures the prompt args
 * so tests can assert the issues/page text actually reached the prompt.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { registerLpRewriterRoutes } from "./lp-rewriter.js";
import {
  TEST_AI_SETTINGS_PEPPER,
  encryptSecret,
} from "../ai/crypto.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const PAGE_ID = "22222222-2222-4222-8222-222222222222";
const EMPTY_PAGE_ID = "33333333-3333-4333-8333-333333333333";
const UNKNOWN_ID = "44444444-4444-4444-8444-444444444444";
const OFFER_ID = "66666666-6666-4666-8666-666666666666";
const UNKNOWN_OFFER_ID = "77777777-7777-4777-8777-777777777777";

const PAGE_HTML =
  "<html><head><title>示例落地页</title></head>" +
  "<body><h1>示例标题</h1><a>了解更多</a></body></html>";

type Row = Record<string, any>;

interface Ctx {
  aiSettings: Row[];
  landingPages: Row[];
  offers: Row[];
  tasks: Row[];
  rewrites: Row[];
  seenChatArgs: any;
}

function makeFakePrisma(ctx: Ctx) {
  const matchLP = (r: Row, where: any) =>
    (!where.id || r.id === where.id) &&
    (!where.tenantId || r.tenantId === where.tenantId);
  const matchOffer = (r: Row, where: any) =>
    (!where.id || r.id === where.id) &&
    (!where.tenantId || r.tenantId === where.tenantId) &&
    (where.deletedAt === undefined ||
      (r.deletedAt ?? null) === where.deletedAt);
  return {
    aiSetting: {
      findMany: async () => ctx.aiSettings,
    },
    landingPage: {
      findFirst: async ({ where }: any) =>
        ctx.landingPages.find((r) => matchLP(r, where)) ?? null,
      findMany: async ({ where }: any = {}) => {
        let rows = ctx.landingPages.filter((r) => matchLP(r, where ?? {}));
        // Support the rewritable endpoint's htmlContent not-null/not-empty filter.
        const and = (where as any)?.AND as Array<any> | undefined;
        if (Array.isArray(and)) {
          for (const cond of and) {
            const hc = cond?.htmlContent;
            if (hc && typeof hc === "object") {
              if (hc.not === null)
                rows = rows.filter((r) => r.htmlContent !== null);
              if (hc.not === "")
                rows = rows.filter((r) => r.htmlContent !== "");
            }
          }
        }
        return rows;
      },
      create: async ({ data }: any) => {
        const row = { ...data };
        ctx.landingPages.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = ctx.landingPages.find((r) => r.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return row;
      },
    },
    offer: {
      findFirst: async ({ where }: any) =>
        ctx.offers.find((r) => matchOffer(r, where)) ?? null,
      findMany: async ({ where }: any = {}) => {
        const ids = (where as any)?.id?.in as string[] | undefined;
        return ctx.offers.filter(
          (r) =>
            matchOffer(r, { ...(where ?? {}), id: undefined } as any) &&
            (!ids || ids.includes(r.id))
        );
      },
    },
    landingPageOptimizationTask: {
      findFirst: async ({ where }: any) => {
        const rows = ctx.tasks.filter(
          (r) =>
            (!where.tenantId || r.tenantId === where.tenantId) &&
            (!where.landingPageId || r.landingPageId === where.landingPageId)
        );
        rows.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        return rows[0] ?? null;
      },
    },
    landingPageRewrite: {
      create: async ({ data }: any) => {
        const row = { ...data, createdAt: new Date() };
        ctx.rewrites.push(row);
        return row;
      },
      findMany: async ({ where }: any) => {
        const rows = ctx.rewrites.filter(
          (r) =>
            (!where.tenantId || r.tenantId === where.tenantId) &&
            (!where.landingPageId || r.landingPageId === where.landingPageId)
        );
        rows.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        return rows;
      },
      findFirst: async ({ where }: any) =>
        ctx.rewrites.find(
          (r) =>
            (!where.id || r.id === where.id) &&
            (!where.tenantId || r.tenantId === where.tenantId)
        ) ?? null,
      update: async ({ where, data }: any) => {
        const row = ctx.rewrites.find((r) => r.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return row;
      },
    },
  };
}

/** Valid UUIDs for seeded ids (routes validate UUID format). */
function seedCtx(configured = true): Ctx {
  return {
    aiSettings: configured
      ? [
          { key: "llm.baseUrl", value: "https://api.test/v1" },
          { key: "llm.model", value: "test-model" },
          {
            key: "llm.apiKeyEnc",
            value: encryptSecret("<redacted>", TEST_AI_SETTINGS_PEPPER),
          },
        ]
      : [],
    landingPages: [
      {
        id: PAGE_ID,
        tenantId: TENANT,
        offerId: OFFER_ID,
        name: "示例落地页",
        url: "https://example.com/lp",
        htmlContent: PAGE_HTML,
      },
      {
        id: EMPTY_PAGE_ID,
        tenantId: TENANT,
        offerId: OFFER_ID,
        name: "空页面",
        url: "https://example.com/empty",
        htmlContent: null,
      },
    ],
    offers: [
      {
        id: OFFER_ID,
        tenantId: TENANT,
        name: "测试 Offer",
        deletedAt: null,
      },
    ],
    tasks: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        tenantId: TENANT,
        landingPageId: PAGE_ID,
        score: 55,
        issues: [
          {
            dimension: "cta",
            severity: "high",
            message: "首屏未检测到 CTA 按钮",
          },
        ],
        createdAt: new Date("2026-10-07T05:00:00Z"),
      },
    ],
    rewrites: [],
    seenChatArgs: null,
  };
}

async function buildApp(ctx: Ctx) {
  // requireLlmConfig decrypts the stored key with the vitest test pepper
  // (resolveAiSettingsPepper falls back to TEST_AI_SETTINGS_PEPPER under
  // VITEST); seedCtx encrypts with the same pepper, so the happy path
  // decrypts cleanly. Empty aiSettings covers the "not configured" case.
  const chatJsonImpl = (async (args: any) => {
    ctx.seenChatArgs = args;
    return {
      rewrites: [
        {
          element: "首屏 CTA 按钮",
          location: "首屏 H1 下方",
          before: "了解更多",
          after: "立即免费试用",
          reason: "明确的行动动词降低决策成本",
        },
      ],
      estimatedNewScore: 88,
    };
  }) as any;

  const app = Fastify({ logger: false });
  await registerLpRewriterRoutes(app, {
    prisma: makeFakePrisma(ctx) as unknown as PrismaClient,
    auth: { mode: "disabled" as const, registry: [] },
    chatJsonImpl,
  });
  return app;
}

function headers(tenant = TENANT) {
  return { "content-type": "application/json", "x-tenant-id": tenant };
}

describe("lp-rewriter routes", () => {
  it("POST /:id/rewrite reuses the latest task's issues and stores a DRAFT", async () => {
    const ctx = seedCtx();
    const app = await buildApp(ctx);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/${PAGE_ID}/rewrite`,
      headers: headers(),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rewrite.status).toBe("DRAFT");
    expect(body.rewrite.originalScore).toBe(55);
    expect(body.rewrite.rewrittenContent.rewrites).toHaveLength(1);
    expect(body.rewrite.rewrittenContent.aiEstimatedNewScore).toBe(88);
    expect(body.rewrite.rewrittenContent.appliedCount).toBe(1);
    expect(Number.isFinite(body.rewrite.newScore)).toBe(true);
    // The task's issue actually reached the LLM prompt.
    expect(ctx.seenChatArgs.user).toContain("首屏未检测到 CTA 按钮");
    expect(ctx.seenChatArgs.user).toContain("了解更多");
  });

  it("POST /:id/rewrite accepts explicit issues and falls back to on-the-fly analysis", async () => {
    const ctx = seedCtx();
    const app = await buildApp(ctx);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/${PAGE_ID}/rewrite`,
      headers: headers(),
      payload: {
        issues: [{ dimension: "copy", severity: "low", message: "自定义问题" }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.seenChatArgs.user).toContain("自定义问题");
    expect(ctx.seenChatArgs.user).not.toContain("首屏未检测到 CTA 按钮");
    // originalScore falls back to the analyzer, not the task's 55 — just
    // assert it is a finite number (task ignored).
    expect(Number.isFinite(res.json().rewrite.originalScore)).toBe(true);
  });

  it("POST /:id/rewrite on a page without a task still works via analyzer issues", async () => {
    const ctx = seedCtx();
    ctx.tasks = [];
    const app = await buildApp(ctx);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/${PAGE_ID}/rewrite`,
      headers: headers(),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rewrite.originalScore).toBeGreaterThanOrEqual(0);
  });

  it("POST /:id/rewrite fails 502 when the LLM is not configured", async () => {
    const ctx = seedCtx(false);
    const app = await buildApp(ctx);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/${PAGE_ID}/rewrite`,
      headers: headers(),
      payload: {},
    });
    expect(res.statusCode).toBe(502);
  });

  it("POST /:id/rewrite 404s for an unknown page and 400s without HTML", async () => {
    const ctx = seedCtx();
    const app = await buildApp(ctx);
    const notFound = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/${UNKNOWN_ID}/rewrite`,
      headers: headers(),
      payload: {},
    });
    expect(notFound.statusCode).toBe(404);
    const noHtml = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/${EMPTY_PAGE_ID}/rewrite`,
      headers: headers(),
      payload: {},
    });
    expect(noHtml.statusCode).toBe(400);
  });

  it("GET /:id/rewrites lists newest-first and isolates tenants", async () => {
    const ctx = seedCtx();
    const app = await buildApp(ctx);
    for (let i = 0; i < 2; i += 1) {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/landing-pages/${PAGE_ID}/rewrite`,
        headers: headers(),
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      // Ensure distinct createdAt for ordering.
      ctx.rewrites[ctx.rewrites.length - 1].createdAt = new Date(
        Date.now() + i * 1000
      );
    }
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/landing-pages/${PAGE_ID}/rewrites`,
      headers: headers(),
    });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.total).toBe(2);
    expect(
      new Date(body.items[0].createdAt).getTime() >=
        new Date(body.items[1].createdAt).getTime()
    ).toBe(true);

    // Other tenant cannot see this tenant's page history.
    const other = await app.inject({
      method: "GET",
      url: `/api/v1/landing-pages/${PAGE_ID}/rewrites`,
      headers: headers(OTHER_TENANT),
    });
    expect(other.statusCode).toBe(404);
  });

  it("POST /rewrites/:id/apply backs up HTML, applies, and flips to APPLIED", async () => {
    const ctx = seedCtx();
    const app = await buildApp(ctx);
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/${PAGE_ID}/rewrite`,
      headers: headers(),
      payload: {},
    });
    const rewriteId = created.json().rewrite.id;

    const applied = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/rewrites/${rewriteId}/apply`,
      headers: headers(),
      payload: {},
    });
    expect(applied.statusCode).toBe(200);
    const body = applied.json();
    expect(body.rewrite.status).toBe("APPLIED");
    expect(body.applied).toBe(1);
    expect(body.skipped).toEqual([]);
    // Backup holds the ORIGINAL content before mutation.
    expect(body.rewrite.rewrittenContent.originalBackup.htmlContent).toBe(
      PAGE_HTML
    );
    expect(body.rewrite.rewrittenContent.originalBackup.name).toBe("示例落地页");
    // The landing page now carries the rewritten copy.
    const page = ctx.landingPages.find((r) => r.id === PAGE_ID)!;
    expect(page.htmlContent).toContain("立即免费试用");
    expect(page.htmlContent).not.toContain("了解更多");
  });

  it("POST /rewrites/:id/apply rejects a second apply (409) and foreign tenants (404)", async () => {
    const ctx = seedCtx();
    const app = await buildApp(ctx);
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/${PAGE_ID}/rewrite`,
      headers: headers(),
      payload: {},
    });
    const rewriteId = created.json().rewrite.id;

    const foreign = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/rewrites/${rewriteId}/apply`,
      headers: headers(OTHER_TENANT),
      payload: {},
    });
    expect(foreign.statusCode).toBe(404);

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/rewrites/${rewriteId}/apply`,
      headers: headers(),
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/rewrites/${rewriteId}/apply`,
      headers: headers(),
      payload: {},
    });
    expect(second.statusCode).toBe(409);
  });

  it("POST /:id/rewrite is tenant-isolated (other tenant gets 404)", async () => {
    const ctx = seedCtx();
    const app = await buildApp(ctx);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/${PAGE_ID}/rewrite`,
      headers: headers(OTHER_TENANT),
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /:id/rewrite with requirements uses the brief-driven prompt", async () => {
    const ctx = seedCtx();
    const app = await buildApp(ctx);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/${PAGE_ID}/rewrite`,
      headers: headers(),
      payload: {
        requirements: {
          targetAudience: "25-35 岁新手妈妈",
          sellingPoints: ["静音设计", "30 天退款"],
          tone: "friendly",
          ctaText: "立即抢购",
          language: "zh",
          length: "short",
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rewrite.status).toBe("DRAFT");
    expect(body.rewrite.issues).toEqual([]);
    expect(body.rewrite.rewrittenContent.requirements.targetAudience).toBe(
      "25-35 岁新手妈妈"
    );
    expect(
      body.rewrite.rewrittenContent.requirements.sellingPoints
    ).toEqual(["静音设计", "30 天退款"]);
    expect(body.rewrite.rewrittenContent.source).toEqual({
      kind: "landingPage",
      landingPageId: PAGE_ID,
    });
    // The brief actually reached the LLM prompt.
    expect(ctx.seenChatArgs.user).toContain("25-35 岁新手妈妈");
    expect(ctx.seenChatArgs.user).toContain("静音设计");
    expect(ctx.seenChatArgs.user).toContain("立即抢购");
    expect(ctx.seenChatArgs.user).toContain("请用中文输出");
  });

  it("POST /:id/rewrite rejects malformed requirements with 400", async () => {
    const ctx = seedCtx();
    const app = await buildApp(ctx);
    const badTone = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/${PAGE_ID}/rewrite`,
      headers: headers(),
      payload: { requirements: { tone: "nope" } },
    });
    expect(badTone.statusCode).toBe(400);
    const notObject = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/${PAGE_ID}/rewrite`,
      headers: headers(),
      payload: { requirements: "just do it" },
    });
    expect(notObject.statusCode).toBe(400);
  });

  it("POST /rewrites/:id/deploy creates a NEW landing page and flips to DEPLOYED", async () => {
    const ctx = seedCtx();
    const app = await buildApp(ctx);
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/${PAGE_ID}/rewrite`,
      headers: headers(),
      payload: { requirements: { targetAudience: "test", language: "zh" } },
    });
    const rewriteId = created.json().rewrite.id;

    const deployed = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/rewrites/${rewriteId}/deploy`,
      headers: headers(),
      payload: { name: "改写部署页" },
    });
    expect(deployed.statusCode).toBe(200);
    const body = deployed.json();
    expect(body.rewrite.status).toBe("DEPLOYED");
    expect(body.applied).toBe(1);
    expect(body.landingPage.name).toBe("改写部署页");
    expect(body.landingPage.offerId).toBe(OFFER_ID);
    expect(body.landingPage.id).not.toBe(PAGE_ID);
    expect(body.landingPage.status).toBe("ACTIVE");
    // The deployed page carries the rewritten copy...
    const newPage = ctx.landingPages.find((r) => r.id === body.landingPage.id)!;
    expect(newPage.htmlContent).toContain("立即免费试用");
    // ...while the source page is untouched.
    const source = ctx.landingPages.find((r) => r.id === PAGE_ID)!;
    expect(source.htmlContent).toContain("了解更多");
    expect(source.htmlContent).not.toContain("立即免费试用");
    // Deploy metadata is recorded on the rewrite.
    expect(
      body.rewrite.rewrittenContent.deployedLandingPageId
    ).toBe(body.landingPage.id);
  });

  it("POST /rewrites/:id/deploy validates input and isolates tenants", async () => {
    const ctx = seedCtx();
    const app = await buildApp(ctx);
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/${PAGE_ID}/rewrite`,
      headers: headers(),
      payload: {},
    });
    const rewriteId = created.json().rewrite.id;

    const noName = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/rewrites/${rewriteId}/deploy`,
      headers: headers(),
      payload: {},
    });
    expect(noName.statusCode).toBe(400);

    const badOffer = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/rewrites/${rewriteId}/deploy`,
      headers: headers(),
      payload: { name: "x", offerId: "not-a-uuid" },
    });
    expect(badOffer.statusCode).toBe(400);

    const unknownOffer = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/rewrites/${rewriteId}/deploy`,
      headers: headers(),
      payload: { name: "x", offerId: UNKNOWN_OFFER_ID },
    });
    expect(unknownOffer.statusCode).toBe(404);

    const foreign = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/rewrites/${rewriteId}/deploy`,
      headers: headers(OTHER_TENANT),
      payload: { name: "x" },
    });
    expect(foreign.statusCode).toBe(404);

    const malformed = await app.inject({
      method: "POST",
      url: "/api/v1/landing-pages/rewrites/nope/deploy",
      headers: headers(),
      payload: { name: "x" },
    });
    expect(malformed.statusCode).toBe(404);

    // Explicit offerId + url are honored.
    const ok = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/rewrites/${rewriteId}/deploy`,
      headers: headers(),
      payload: {
        name: "部署页",
        offerId: OFFER_ID,
        url: "https://example.com/deployed",
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().landingPage.url).toBe("https://example.com/deployed");
    expect(ok.json().landingPage.domain).toBe("example.com");

    // A second deploy is rejected.
    const second = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/rewrites/${rewriteId}/deploy`,
      headers: headers(),
      payload: { name: "again" },
    });
    expect(second.statusCode).toBe(409);
  });

  it("GET /api/v1/landing-pages/rewritable lists only pages with HTML", async () => {
    const ctx = seedCtx();
    const app = await buildApp(ctx);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/landing-pages/rewritable",
      headers: headers(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // EMPTY_PAGE_ID has no HTML and must be excluded.
    expect(body.total).toBe(1);
    expect(body.items[0].id).toBe(PAGE_ID);
    expect(body.items[0].name).toBe("示例落地页");
    expect(body.items[0].offerId).toBe(OFFER_ID);
    expect(body.items[0].offerName).toBe("测试 Offer");
    expect(body.items[0]).not.toHaveProperty("htmlContent");
  });

  it("GET /api/v1/landing-pages/rewritable is tenant-isolated", async () => {
    const ctx = seedCtx();
    const app = await buildApp(ctx);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/landing-pages/rewritable",
      headers: headers(OTHER_TENANT),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(0);
  });

  it("POST /rewrites/:id/deploy supports template-sourced briefs (no source page)", async () => {
    const ctx = seedCtx();
    const app = await buildApp(ctx);
    const templateRewrite = {
      id: "88888888-8888-4888-8888-888888888888",
      tenantId: TENANT,
      landingPageId: null,
      originalScore: 70,
      issues: [],
      rewrittenContent: {
        rewrites: [
          {
            element: "H1",
            location: "首屏",
            before: "TestProduct",
            after: "TestProduct Pro",
            reason: "测试",
          },
        ],
        aiEstimatedNewScore: 88,
        appliedCount: 1,
        skipped: [],
        source: { kind: "template", templateId: "builtin-coupon", lang: "zh" },
        baseHtml:
          "<html><body><h1>TestProduct</h1><p>desc</p></body></html>",
      },
      newScore: 80,
      status: "DRAFT",
      createdAt: new Date(),
    };
    ctx.rewrites.push(templateRewrite);

    // Template-sourced briefs must name an offer explicitly.
    const noOffer = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/rewrites/${templateRewrite.id}/deploy`,
      headers: headers(),
      payload: { name: "模板部署页" },
    });
    expect(noOffer.statusCode).toBe(400);

    const deployed = await app.inject({
      method: "POST",
      url: `/api/v1/landing-pages/rewrites/${templateRewrite.id}/deploy`,
      headers: headers(),
      payload: { name: "模板部署页", offerId: OFFER_ID },
    });
    expect(deployed.statusCode).toBe(200);
    const body = deployed.json();
    expect(body.rewrite.status).toBe("DEPLOYED");
    expect(body.landingPage.offerId).toBe(OFFER_ID);
    const newPage = ctx.landingPages.find(
      (r) => r.id === body.landingPage.id
    )!;
    expect(newPage.htmlContent).toContain("TestProduct Pro");
  });
});
