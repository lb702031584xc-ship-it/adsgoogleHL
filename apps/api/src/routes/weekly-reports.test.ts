/**
 * Automation round 2 — weekly-reports route contract tests.
 * In-memory fake Prisma; session auth stubbed via onRequest hook.
 * No AI configured → template fallback summary (no network).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { createAuthContext } from "../auth/tenant.js";
import { registerWeeklyReportRoutes } from "./weekly-reports.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const TENANT_B = "00000000-0000-4000-8000-000000000002";
const SESSION = {
  id: "11111111-1111-4111-8111-111111111111",
  tenantId: TENANT,
  userId: "22222222-2222-4222-8222-222222222222",
  email: "test@example.com",
  role: "admin",
};

type Row = Record<string, any>;

function inRange(v: Date, where: any): boolean {
  const gte = where?.gte as Date | undefined;
  const lte = where?.lte as Date | undefined;
  if (gte && v < gte) return false;
  if (lte && v > lte) return false;
  return true;
}

function mkFakePrisma() {
  const reports: Row[] = [];
  const prisma: any = {
    click: {
      count: async () => 0,
      groupBy: async () => [],
    },
    conversion: { findMany: async () => [] },
    alert: { count: async () => 0, groupBy: async () => [] },
    linkHealthCheck: { count: async () => 0 },
    searchTermSuggestion: { count: async () => 0 },
    landingPageOptimizationTask: { count: async () => 0 },
    offer: { findMany: async () => [] },
    aiSetting: { findMany: async () => [] },
    weeklyReport: {
      upsert: async ({ where, create, update }: any) => {
        const key = where.tenantId_weekStart_weekEnd;
        const existing = reports.find(
          (r) =>
            r.tenantId === key.tenantId &&
            r.weekStart.getTime() === key.weekStart.getTime() &&
            r.weekEnd.getTime() === key.weekEnd.getTime(),
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { ...create, createdAt: new Date() };
        reports.push(row);
        return row;
      },
      findMany: async ({ where, orderBy }: any) => {
        let out = reports.filter((r) => r.tenantId === where.tenantId);
        if (orderBy?.weekStart === "desc") {
          out = [...out].sort(
            (a, b) => b.weekStart.getTime() - a.weekStart.getTime(),
          );
        }
        return out;
      },
      findFirst: async ({ where }: any) =>
        reports.find(
          (r) => r.id === where.id && r.tenantId === where.tenantId,
        ) ?? null,
    },
  };
  return { prisma: prisma as unknown as PrismaClient, reports };
}

async function buildApp() {
  const fx = mkFakePrisma();
  const app = Fastify();
  app.addHook("onRequest", async (request: any) => {
    request.sessionAuth = SESSION;
  });
  await registerWeeklyReportRoutes(
    app,
    { prisma: fx.prisma },
    createAuthContext({ AUTH_MODE: "disabled" } as any),
  );
  return { app: app as any, fx };
}

describe("weekly-reports routes", () => {
  let app: any;
  let fx: ReturnType<typeof mkFakePrisma>;
  beforeEach(async () => {
    const built = await buildApp();
    app = built.app;
    fx = built.fx;
  });

  it("GET /api/v1/weekly-reports returns an empty list", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/weekly-reports",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().reports).toEqual([]);
  });

  it("POST /generate-now creates a report (defaults to last week) with 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/weekly-reports/generate-now",
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.tenantId).toBe(TENANT);
    expect(body.status).toBe("GENERATED");
    expect(body.aiSummary).toContain("花费数据缺失");
    expect(body.data.clicks).toBe(0);
    expect(fx.reports).toHaveLength(1);
  });

  it("POST /generate-now accepts an explicit week window", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/weekly-reports/generate-now",
      payload: {
        weekStart: "2026-09-28T04:00:00.000Z",
        weekEnd: "2026-10-05T03:59:59.999Z",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().weekStart).toBe("2026-09-28T04:00:00.000Z");
  });

  it("POST /generate-now rejects an invalid window", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/weekly-reports/generate-now",
      payload: {
        weekStart: "2026-10-05T03:59:59.999Z",
        weekEnd: "2026-09-28T04:00:00.000Z",
      },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(fx.reports).toHaveLength(0);
  });

  it("POST /generate-now rejects a half-open window", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/weekly-reports/generate-now",
      payload: { weekStart: "2026-09-28T04:00:00.000Z" },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("GET /:id returns the report detail", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/weekly-reports/generate-now",
      payload: {
        weekStart: "2026-09-28T04:00:00.000Z",
        weekEnd: "2026-10-05T03:59:59.999Z",
      },
    });
    const id = created.json().id;
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/weekly-reports/${id}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(id);
    expect(res.json().data).toBeDefined();
  });

  it("GET /:id returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/weekly-reports/00000000-0000-4000-8000-000000000099",
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant isolation: other tenant's report is invisible", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/weekly-reports/generate-now",
      payload: {
        weekStart: "2026-09-28T04:00:00.000Z",
        weekEnd: "2026-10-05T03:59:59.999Z",
      },
    });
    const id = created.json().id;
    // Seed a report belonging to another tenant with the same id shape.
    fx.reports.push({
      id: "aaaaaaaa-0000-4000-8000-000000000000",
      tenantId: TENANT_B,
      weekStart: new Date("2026-09-28T04:00:00.000Z"),
      weekEnd: new Date("2026-10-05T03:59:59.999Z"),
      data: {},
      aiSummary: "x",
      status: "GENERATED",
      createdAt: new Date(),
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/weekly-reports/aaaaaaaa-0000-4000-8000-000000000000",
    });
    expect(res.statusCode).toBe(404);
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/weekly-reports",
    });
    expect(list.json().reports.map((r: any) => r.id)).toEqual([id]);
  });

  it("generate-now is idempotent for the same week", async () => {
    const payload = {
      weekStart: "2026-09-28T04:00:00.000Z",
      weekEnd: "2026-10-05T03:59:59.999Z",
    };
    const a = await app.inject({
      method: "POST",
      url: "/api/v1/weekly-reports/generate-now",
      payload,
    });
    const b = await app.inject({
      method: "POST",
      url: "/api/v1/weekly-reports/generate-now",
      payload,
    });
    expect(a.json().id).toBe(b.json().id);
    expect(fx.reports).toHaveLength(1);
  });
});
