/**
 * Phase 4 Research Lab — RESEARCHER role isolation tests.
 * The guard (apps/api/src/auth/researcher.ts) is registered FIRST so its
 * onRequest hook applies to every route below. Stub routes stand in for the
 * real /api/v1/offers and /api/v1/ai/* surfaces.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import {
  SESSION_COOKIE_NAME,
  createSession,
} from "./sessions.js";
import { createObservabilityErrorHandler } from "../observability/index.js";
import {
  isResearcherAllowedPath,
  registerResearcherIsolation,
} from "./researcher.js";
import { registerResearchRoutes } from "../routes/research.js";
import type {
  RequestVariant,
  VariantFetchResult,
} from "../research/fetcher.js";

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}

function makeFakePrisma() {
  const tenants: Row[] = [];
  const users: Row[] = [];
  const sessions: Row[] = [];
  return {
    tenant: {
      create: async ({ data }: any) => {
        const row = { createdAt: new Date(), ...data };
        tenants.push(row);
        return { ...row };
      },
    },
    user: {
      create: async ({ data }: any) => {
        const row = { createdAt: new Date(), ...data };
        users.push(row);
        return { ...row };
      },
    },
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
    researchTest: {
      findMany: async () => [],
      count: async () => 0,
    },
    researchResponse: { findMany: async () => [] },
    cloakingFinding: { findFirst: async () => null },
  };
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

function cookie(token: string) {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

async function seedUser(
  fake: FakePrisma,
  role: "admin" | "member" | "researcher"
) {
  const tenantId = randomUUID();
  await (fake as any).tenant.create({
    data: { id: tenantId, name: `${role}@t`, slug: `iso-${role}`, status: "ACTIVE" },
  });
  const user = await (fake as any).user.create({
    data: {
      id: randomUUID(),
      tenantId,
      email: `${role}-iso@example.com`,
      name: role,
      role,
      status: "ACTIVE",
    },
  });
  const session = await createSession(fake as unknown as PrismaClient, user.id);
  return { token: session.token };
}

function cannedFetch(
  url: string,
  variants: RequestVariant[]
): Promise<VariantFetchResult[]> {
  return Promise.resolve(
    variants.map((v) => ({
      variantName: v.name,
      httpStatus: 200,
      finalUrl: url,
      redirectChain: [],
      headers: {},
      htmlHash: "h",
      contentHash: "c",
      textExcerpt: "x",
      linksCount: 1,
      scriptsCount: 0,
      meta: {},
      fetchedAt: new Date(),
    }))
  );
}

describe("isResearcherAllowedPath", () => {
  it("allows the research surface", () => {
    expect(isResearcherAllowedPath("/api/v1/research/tests")).toBe(true);
    expect(isResearcherAllowedPath("/api/v1/research/tests/abc/run")).toBe(true);
    expect(isResearcherAllowedPath("/api/v1/research/simulate")).toBe(true);
    expect(isResearcherAllowedPath("/api/v1/research")).toBe(true);
  });
  it("allows auth me/logout", () => {
    expect(isResearcherAllowedPath("/api/v1/auth/me")).toBe(true);
    expect(isResearcherAllowedPath("/api/v1/auth/logout")).toBe(true);
  });
  it("denies everything else", () => {
    expect(isResearcherAllowedPath("/api/v1/offers")).toBe(false);
    expect(isResearcherAllowedPath("/api/v1/campaigns")).toBe(false);
    expect(isResearcherAllowedPath("/api/v1/ai/analyze")).toBe(false);
    expect(isResearcherAllowedPath("/api/v1/auth/login")).toBe(false);
    expect(isResearcherAllowedPath("/api/v1/auth/register")).toBe(false);
    expect(isResearcherAllowedPath("/api/v1/researcher/tests")).toBe(false);
  });
});

describe("researcher isolation guard", () => {
  let app: any;
  let researcherToken: string;
  let memberToken: string;
  let adminToken: string;

  beforeEach(async () => {
    const fake = makeFakePrisma();
    researcherToken = (await seedUser(fake, "researcher")).token;
    memberToken = (await seedUser(fake, "member")).token;
    adminToken = (await seedUser(fake, "admin")).token;

    app = Fastify({ logger: false });
    app.setErrorHandler(createObservabilityErrorHandler());
    // Guard FIRST: onRequest hooks apply to routes registered after them.
    registerResearcherIsolation(app, {
      prisma: fake as unknown as PrismaClient,
    });
    await registerResearchRoutes(app, {
      prisma: fake as unknown as PrismaClient,
      fetchVariantsImpl: cannedFetch,
    });
    // Stubs for non-research surfaces.
    app.get("/api/v1/offers", async () => ({ ok: true }));
    app.post("/api/v1/ai/analyze", async () => ({ ok: true }));
    app.get("/api/v1/campaigns", async () => ({ ok: true }));
    app.get("/api/v1/auth/me", async () => ({ ok: true }));
    app.post("/api/v1/auth/logout", async () => ({ ok: true }));
    app.get("/health", async () => ({ ok: true }));
  });

  it("researcher → GET /api/v1/offers → 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/offers",
      headers: cookie(researcherToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it("researcher → POST /api/v1/ai/analyze → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/analyze",
      headers: cookie(researcherToken),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it("researcher → GET /api/v1/campaigns → 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/campaigns",
      headers: cookie(researcherToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it("researcher → GET /api/v1/research/tests → 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/research/tests",
      headers: cookie(researcherToken),
    });
    expect(res.statusCode).toBe(200);
  });

  it("researcher → POST /api/v1/research/simulate → 200", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/research/simulate",
      headers: cookie(researcherToken),
      payload: { htmlA: "<p>a</p>", htmlB: "<p>a</p>" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("researcher → /api/v1/auth/me and /api/v1/auth/logout → 200", async () => {
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: cookie(researcherToken),
    });
    expect(me.statusCode).toBe(200);
    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: cookie(researcherToken),
    });
    expect(logout.statusCode).toBe(200);
  });

  it("member and admin are unaffected", async () => {
    for (const t of [memberToken, adminToken]) {
      const offers = await app.inject({
        method: "GET",
        url: "/api/v1/offers",
        headers: cookie(t),
      });
      expect(offers.statusCode).toBe(200);
      const ai = await app.inject({
        method: "POST",
        url: "/api/v1/ai/analyze",
        headers: cookie(t),
        payload: {},
      });
      expect(ai.statusCode).toBe(200);
    }
  });

  it("unauthenticated requests pass through the guard", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/offers" });
    expect(res.statusCode).toBe(200);
  });

  it("non-API paths are untouched for researchers", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: cookie(researcherToken),
    });
    expect(res.statusCode).toBe(200);
  });
});
