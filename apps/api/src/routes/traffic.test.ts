/**
 * 流量需求门阈值路由契约测试。
 * thresholds 模块用 vi.mock 桩掉（存储细节归该模块自己的测试），
 * 这里验证：认证、输入校验（400）、路由与 get/save 的接线。
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import {
  SESSION_COOKIE_NAME,
  createSession,
} from "../auth/sessions.js";
import { createObservabilityErrorHandler } from "../observability/index.js";
import { getTrafficThresholds, saveTrafficThresholds } from "../traffic/thresholds.js";
import {
  DEFAULT_TRAFFIC_THRESHOLDS,
  type TrafficThresholds,
} from "../traffic/types.js";
import { registerTrafficRoutes } from "./traffic.js";

vi.mock("../traffic/thresholds.js", () => ({
  getTrafficThresholds: vi.fn(),
  saveTrafficThresholds: vi.fn(),
}));

const mockGet = vi.mocked(getTrafficThresholds);
const mockSave = vi.mocked(saveTrafficThresholds);

type Row = Record<string, any>;

function mkStore(rows: Row[]) {
  return {
    findUnique: async ({ where }: any) => {
      const row =
        rows.find((r) =>
          Object.entries(where ?? {}).every(([k, v]) => r[k] === v)
        ) ?? null;
      return row ? { ...row } : null;
    },
    create: async ({ data }: any) => {
      const row = { id: data.id ?? randomUUID(), ...data };
      rows.push(row);
      return { ...row };
    },
    _rows: rows,
  };
}

// createSession 只用 session.create；resolveSession 用 session.findUnique(include user)。
let userRows: Row[] = [];

function makeFakePrisma() {
  const tenants: Row[] = [];
  userRows = [];
  const sessions: Row[] = [];
  const sessionStore = mkStore(sessions);
  // session.findUnique 需要能按 tokenHash 找并 include user
  const baseFindUnique = sessionStore.findUnique;
  (sessionStore as any).findUnique = async (args: any) => {
    const row = await baseFindUnique(args);
    if (!row) return null;
    if (args?.include?.user) {
      return {
        ...row,
        user: userRows.find((u) => u.id === row.userId) ?? null,
      };
    }
    return row;
  };
  return {
    tenant: mkStore(tenants),
    user: mkStore(userRows),
    session: sessionStore,
  } as unknown as PrismaClient;
}

let fake: PrismaClient;

function cookie(token: string) {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

async function seedAuth() {
  const p = fake as any;
  const tenantId = randomUUID();
  await p.tenant.create({ data: { id: tenantId } });
  const user = await p.user.create({
    data: {
      id: randomUUID(),
      tenantId,
      email: "u@example.com",
      role: "member",
      status: "ACTIVE",
    },
  });
  const session = await createSession(fake, user.id);
  return { token: session.token };
}

async function buildApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler(createObservabilityErrorHandler());
  await registerTrafficRoutes(app, { prisma: fake });
  return app;
}

const CURRENT: TrafficThresholds = {
  officialSiteMonthlyVisits: 80000,
  brandInterest: 40,
  keywordInterest: 35,
};

describe("traffic thresholds routes", () => {
  let token: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    fake = makeFakePrisma();
    ({ token } = await seedAuth());
    mockGet.mockResolvedValue({ ...CURRENT });
    mockSave.mockImplementation(async (_prisma, t) => t);
  });

  it("401 without session (GET)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/traffic/thresholds",
    });
    expect(res.statusCode).toBe(401);
  });

  it("401 without session (PUT)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/traffic/thresholds",
      payload: { brandInterest: 50 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET returns current thresholds (defaults merged)", async () => {
    mockGet.mockResolvedValue({ ...DEFAULT_TRAFFIC_THRESHOLDS });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/traffic/thresholds",
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().thresholds).toEqual(DEFAULT_TRAFFIC_THRESHOLDS);
  });

  it("PUT partial update merges over current values", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/traffic/thresholds",
      headers: cookie(token),
      payload: { brandInterest: 55 },
    });
    expect(res.statusCode).toBe(200);
    expect(mockSave).toHaveBeenCalledTimes(1);
    const saved = mockSave.mock.calls[0][1];
    expect(saved).toEqual({ ...CURRENT, brandInterest: 55 });
    expect(res.json().thresholds).toEqual({ ...CURRENT, brandInterest: 55 });
  });

  it("PUT rejects negative officialSiteMonthlyVisits", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/traffic/thresholds",
      headers: cookie(token),
      payload: { officialSiteMonthlyVisits: -100 },
    });
    expect(res.statusCode).toBe(400);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("PUT rejects heat > 100", async () => {
    const app = await buildApp();
    for (const payload of [
      { brandInterest: 120 },
      { keywordInterest: 101 },
      { brandInterest: -1 },
    ]) {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/traffic/thresholds",
        headers: cookie(token),
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("PUT rejects non-numeric values and empty body", async () => {
    const app = await buildApp();
    for (const payload of [{ brandInterest: "high" }, {}]) {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/traffic/thresholds",
        headers: cookie(token),
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("PUT accepts boundary values 0 and 100", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/traffic/thresholds",
      headers: cookie(token),
      payload: { brandInterest: 0, keywordInterest: 100 },
    });
    expect(res.statusCode).toBe(200);
    expect(mockSave.mock.calls[0][1]).toEqual({
      ...CURRENT,
      brandInterest: 0,
      keywordInterest: 100,
    });
  });
});
