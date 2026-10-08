/**
 * Phase 3 Budget Recommendation — route contract tests.
 * In-memory fake Prisma + Fastify inject.
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
  buildBudgetRecommendation,
  registerBudgetRoutes,
} from "./budget.js";

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      const rv = row[k];
      if ("in" in v) return ((v as any).in as any[]).includes(rv);
      if ("notIn" in v) return !((v as any).notIn as any[]).includes(rv);
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

function fakeGroupBy(rows: Row[], by: string[], where: Row | undefined): Row[] {
  const filtered = rows.filter((r) => matches(r, where));
  const map = new Map<string, { keys: Row; rows: Row[] }>();
  for (const r of filtered) {
    const k = JSON.stringify(by.map((b) => r[b] ?? null));
    let g = map.get(k);
    if (!g) {
      g = { keys: Object.fromEntries(by.map((b) => [b, r[b] ?? null])), rows: [] };
      map.set(k, g);
    }
    g.rows.push(r);
  }
  return [...map.values()].map((g) => ({
    ...g.keys,
    _count: {
      _all: g.rows.length,
      ...Object.fromEntries(by.map((b) => [b, g.rows.length])),
    },
  }));
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
    aggregate: async (args: any = {}) => {
      const filtered = rows.filter((r) => matches(r, args.where));
      const sum = filtered.reduce((a, r) => a + (Number(r.value) || 0), 0);
      return { _sum: { value: sum }, _count: { _all: filtered.length } };
    },
    groupBy: async (args: any = {}) => fakeGroupBy(rows, args.by, args.where),
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
    profitModel: mkStore([]),
    click: mkStore([]),
    conversion: mkStore([]),
    order: mkStore([]),
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

async function seedOffer(fake: FakePrisma, tenantId: string, commissionValue: string | null = "20.0000") {
  const offerId = randomUUID();
  await (fake as any).offer.create({
    data: {
      id: offerId,
      tenantId,
      name: "Test Offer",
      network: "TestNet",
      destinationUrl: "https://merchant.example/offer",
      commissionValue,
      deletedAt: null,
    },
  });
  return offerId;
}

async function buildApp(fake: FakePrisma): Promise<any> {
  const app = Fastify({ logger: false });
  app.setErrorHandler(createObservabilityErrorHandler());
  await registerBudgetRoutes(app, { prisma: fake as unknown as PrismaClient });
  return app;
}

describe("GET /api/v1/offers/:id/budget-recommendation", () => {
  let fake: FakePrisma;
  let token: string;
  let tenantId: string;
  let app: any;

  beforeEach(async () => {
    fake = makeFakePrisma();
    ({ tenantId, token } = await seedAuth(fake));
    app = await buildApp(fake);
  });

  it("requires authentication", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/offers/${randomUUID()}/budget-recommendation`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("404s for a malformed id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/offers/not-a-uuid/budget-recommendation",
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(404);
  });

  it("404s for another tenant's offer (tenant isolation)", async () => {
    const other = await seedAuth(fake);
    const offerId = await seedOffer(fake, other.tenantId);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/offers/${offerId}/budget-recommendation`,
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(404);
  });

  it("builds budgets from the profit model scenario table", async () => {
    const offerId = await seedOffer(fake, tenantId);
    await (fake as any).profitModel.create({
      data: {
        id: randomUUID(),
        tenantId,
        offerId,
        commission: "20.0000",
        currency: "USD",
        breakEvenCpc: 0.9,
        recommendedMaxCpc: 0.63,
        dataQuality: "OBSERVED",
        deletedAt: null,
        createdAt: new Date(),
        scenarios: {
          worst: { cvr: 1, cpc: 1.2, clicks: 1000, profit: -400 },
          base: { cvr: 2, cpc: 0.8, clicks: 1000, profit: 200 },
          best: { cvr: 3, cpc: 0.64, clicks: 1000, profit: 900 },
        },
      },
    });
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/offers/${offerId}/budget-recommendation`,
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.budgetByScenario).toEqual({ worst: 120, base: 80, best: 64 });
    expect(body.totalTestBudget).toBe(80);
    expect(body.dailyBudget).toBeCloseTo(80 / 7, 2);
    expect(body.breakEvenCpc).toBe(0.9);
    expect(body.recommendedMaxCpc).toBe(0.63);
    expect(body.dataQuality).toBe("OBSERVED");
    expect(body.currency).toBe("USD");
    expect(body.reason).toHaveLength(2);
  });

  it("falls back to observed EPC/CVR when no profit model exists", async () => {
    const offerId = await seedOffer(fake, tenantId);
    const now = Date.now();
    for (let i = 0; i < 200; i++) {
      await (fake as any).click.create({
        data: {
          id: randomUUID(),
          tenantId,
          offerId,
          occurredAt: new Date(now - i * 3600 * 1000),
        },
      });
    }
    for (let i = 0; i < 10; i++) {
      await (fake as any).conversion.create({
        data: {
          id: randomUUID(),
          tenantId,
          conversionTime: new Date(now - i * 7200 * 1000),
          value: "50.0000",
          currency: "USD",
          status: "ATTRIBUTED",
          click: { offerId },
        },
      });
    }
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/offers/${offerId}/budget-recommendation`,
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // EPC = 500/200 = 2.5 -> base test budget = 250
    expect(body.dataQuality).toBe("OBSERVED");
    expect(body.budgetByScenario.base).toBe(250);
    expect(body.totalTestBudget).toBe(250);
    expect(body.breakEvenCpc).toBe(2.5);
    expect(body.recommendedMaxCpc).toBeCloseTo(1.75, 4);
    expect(body.currency).toBe("USD");
  });

  it("marks PREDICTED with defaults when no model and thin traffic", async () => {
    const offerId = await seedOffer(fake, tenantId);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/offers/${offerId}/budget-recommendation`,
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.dataQuality).toBe("PREDICTED");
    expect(body.budgetByScenario).toEqual({ worst: 120, base: 80, best: 64 });
    expect(body.totalTestBudget).toBe(80);
    expect(body.reason.join(" ")).toContain("默认值");
  });
});

describe("buildBudgetRecommendation (pure)", () => {
  const row = (cpc: number | null) => ({ cvr: 2, cpc, clicks: 100, profit: null });

  it("sizes budgets from scenario CPCs", () => {
    const r = buildBudgetRecommendation({
      scenarios: { worst: row(1.2), base: row(0.8), best: row(0.64) },
      breakEvenCpc: 0.9,
      recommendedMaxCpc: 0.63,
      dataQuality: "OBSERVED",
      currency: "USD",
      reason: ["x"],
    });
    expect(r.totalTestBudget).toBe(80);
    expect(r.dailyBudget).toBeCloseTo(11.43, 2);
    expect(r.budgetByScenario).toEqual({ worst: 120, base: 80, best: 64 });
  });

  it("returns null budgets when scenario CPC is unknown", () => {
    const r = buildBudgetRecommendation({
      scenarios: { worst: row(null), base: row(null), best: row(null) },
      breakEvenCpc: null,
      recommendedMaxCpc: null,
      dataQuality: "UNKNOWN",
      currency: null,
      reason: ["x"],
    });
    expect(r.totalTestBudget).toBeNull();
    expect(r.dailyBudget).toBeNull();
    expect(r.budgetByScenario).toEqual({ worst: null, base: null, best: null });
  });
});
