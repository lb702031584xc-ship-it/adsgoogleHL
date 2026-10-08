/**
 * Automation pack ③ — payout-watch route contract tests.
 * In-memory fake Prisma + Fastify inject; auth mode is "disabled" under
 * vitest, so tenant comes from the x-tenant-id header.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { createAuthContext } from "../auth/tenant.js";
import { createObservabilityErrorHandler } from "../observability/index.js";
import { registerPayoutWatchRoutes } from "./payout-watch.js";

type Row = Record<string, any>;

const TENANT = randomUUID();
const OFFER = randomUUID();

function matchesWhere(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    const rv = row[k];
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      return Object.entries(v).every(([op, ov]) => {
        if (op === "in") return Array.isArray(ov) && ov.includes(rv);
        return true;
      });
    }
    if (v === null) return rv === null || rv === undefined;
    return rv === v;
  });
}

function mkStore(rows: Row[]) {
  return {
    findFirst: async ({ where }: any) =>
      rows.filter((r) => matchesWhere(r, where)).map((r) => ({ ...r }))[0] ??
      null,
    findMany: async ({ where, orderBy }: any) => {
      let out = rows.filter((r) => matchesWhere(r, where));
      if (orderBy) {
        const [key, dir] = Object.entries(orderBy)[0] as [string, string];
        out = [...out].sort((a, b) =>
          dir === "desc" ? (b[key] > a[key] ? 1 : -1) : a[key] > b[key] ? 1 : -1
        );
      }
      return out.map((r) => ({ ...r }));
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchesWhere(r, where));
      if (!row) throw new Error("row not found");
      Object.assign(row, data);
      return { ...row };
    },
    upsert: async ({ where, create, update }: any) => {
      const key = where.tenantId_offerId as
        | { tenantId: string; offerId: string }
        | undefined;
      const row = rows.find(
        (r) =>
          r.tenantId === (key?.tenantId ?? where.tenantId) &&
          r.offerId === (key?.offerId ?? where.offerId)
      );
      if (row) {
        Object.assign(row, update);
        return { ...row };
      }
      const created = {
        id: create.id ?? randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        changeHistory: [],
        lastCheckedAt: null,
        lastPayout: null,
        enabled: true,
        ...create,
      };
      rows.push(created);
      return { ...created };
    },
  };
}

let watches: Row[];
let offers: Row[];

function mkApp() {
  const app = Fastify();
  app.setErrorHandler(createObservabilityErrorHandler());
  const prisma = {
    payoutWatch: mkStore(watches),
    offer: mkStore(offers),
  } as unknown as PrismaClient;
  return { app, prisma };
}

async function authed(app: ReturnType<typeof Fastify>, method: string, url: string) {
  const res = await app.inject({
    method,
    url,
    headers: { "x-tenant-id": TENANT },
  });
  return res;
}

beforeEach(() => {
  watches = [];
  offers = [
    {
      id: OFFER,
      tenantId: TENANT,
      name: "RouteOffer",
      network: "Impact",
      commissionType: "flat",
      commissionValue: 20,
      deletedAt: null,
    },
  ];
});

describe("payout-watch routes", () => {
  it("GET /api/v1/payout-watch lists watches with offer info", async () => {
    const { app, prisma } = mkApp();
    await registerPayoutWatchRoutes(
      app,
      { prisma },
      createAuthContext({ VITEST: "1" } as any)
    );
    const enable = await authed(app, "POST", `/api/v1/payout-watch/${OFFER}/enable`);
    expect(enable.statusCode).toBe(200);

    const res = await authed(app, "GET", "/api/v1/payout-watch");
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.items).toHaveLength(1);
    expect(body.items[0].offerName).toBe("RouteOffer");
    expect(body.items[0].currentPayout).toBe(20);
    expect(body.items[0].enabled).toBe(true);
    expect(body.items[0].changeCount).toBe(0);
    await app.close();
  });

  it("POST enable → disable round trip", async () => {
    const { app, prisma } = mkApp();
    await registerPayoutWatchRoutes(
      app,
      { prisma },
      createAuthContext({ VITEST: "1" } as any)
    );
    const enable = await authed(app, "POST", `/api/v1/payout-watch/${OFFER}/enable`);
    expect(enable.statusCode).toBe(200);
    expect((enable.json() as any).watch.enabled).toBe(true);

    const disable = await authed(app, "POST", `/api/v1/payout-watch/${OFFER}/disable`);
    expect(disable.statusCode).toBe(200);
    expect((disable.json() as any).watch.enabled).toBe(false);

    const list = await authed(app, "GET", "/api/v1/payout-watch");
    expect((list.json() as any).items[0].enabled).toBe(false);
    await app.close();
  });

  it("enable rejects invalid offerId and unknown offers", async () => {
    const { app, prisma } = mkApp();
    await registerPayoutWatchRoutes(
      app,
      { prisma },
      createAuthContext({ VITEST: "1" } as any)
    );
    const bad = await authed(app, "POST", "/api/v1/payout-watch/not-a-uuid/enable");
    expect(bad.statusCode).toBe(400);
    const unknown = await authed(
      app,
      "POST",
      `/api/v1/payout-watch/${randomUUID()}/enable`
    );
    expect(unknown.statusCode).toBe(404);
    await app.close();
  });

  it("requires tenant isolation", async () => {
    const { app, prisma } = mkApp();
    await registerPayoutWatchRoutes(
      app,
      { prisma },
      createAuthContext({ VITEST: "1" } as any)
    );
    const noTenant = await app.inject({
      method: "GET",
      url: "/api/v1/payout-watch",
    });
    expect(noTenant.statusCode).toBe(400);
    await app.close();
  });
});
