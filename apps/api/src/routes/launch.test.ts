/**
 * launch-wizard route contract tests.
 * In-memory fake Prisma + Fastify inject, real session auth.
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
import { registerLaunchRoutes } from "./launch.js";

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      // Compound unique key: tenantId_idempotencyScope_idempotencyKey: {...}
      const parts = k.split("_");
      if (parts.length === Object.keys(v).length) {
        return parts.every((p) => row[p] === (v as any)[p]);
      }
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
    findUnique: async ({ where }: any) =>
      rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where, orderBy, take }: any) => {
      let out = sortRows(rows.filter((r) => matches(r, where)), orderBy);
      if (typeof take === "number") out = out.slice(0, take);
      return out.map((r) => ({ ...r }));
    },
    create: async ({ data }: any) => {
      const row = {
        id: data.id ?? randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      rows.push(row);
      return { ...row };
    },
    upsert: async ({ where, update, create: cdata }: any) => {
      const existing = rows.find((r) => matches(r, where));
      if (existing) {
        Object.assign(existing, update, { updatedAt: new Date() });
        return { ...existing };
      }
      const row = {
        id: cdata.id ?? randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...cdata,
      };
      rows.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error("not found");
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
  const offers: Row[] = [];
  const checklists: Row[] = [];
  const trackingLinks: Row[] = [];
  const landingPages: Row[] = [];
  const syncJobs: Row[] = [];
  const syncTargets: Row[] = [];
  const integrations: Row[] = [];
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
    },
    offer: mkStore(offers),
    launchChecklist: mkStore(checklists),
    trackingLink: mkStore(trackingLinks),
    landingPage: mkStore(landingPages),
    syncJob: mkStore(syncJobs),
    scriptSyncTarget: mkStore(syncTargets),
    googleAdsScriptIntegration: mkStore(integrations),
    _rows: {
      tenants,
      users,
      offers,
      checklists,
      trackingLinks,
      landingPages,
      syncJobs,
      syncTargets,
    },
  };
}
type FakePrisma = ReturnType<typeof makeFakePrisma>;

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const OFFER = "88888888-8888-4388-8388-888888888888";

async function seedAuth(fake: FakePrisma): Promise<string> {
  await (fake as any).tenant.create({
    data: { id: TENANT, name: "t", slug: "u-t", status: "ACTIVE" },
  });
  const user = await (fake as any).user.create({
    data: {
      id: randomUUID(),
      tenantId: TENANT,
      email: "member@example.com",
      name: "member",
      role: "member",
      status: "ACTIVE",
    },
  });
  const session = await createSession(fake as unknown as PrismaClient, user.id);
  return session.token;
}

async function seedOffer(fake: FakePrisma, tenantId = TENANT, id = OFFER) {
  await (fake as any).offer.create({
    data: {
      id,
      tenantId,
      name: "Test Offer",
      network: "impact",
      destinationUrl: "https://merchant.example/deal",
      status: "ACTIVE",
      deletedAt: null,
    },
  });
}

describe("launch wizard routes", () => {
  let fake: FakePrisma;
  let authCookie: string;
  let app: any;

  beforeEach(async () => {
    fake = makeFakePrisma();
    authCookie = await seedAuth(fake);
    await seedOffer(fake);
    app = Fastify({ logger: false });
    app.setErrorHandler(createObservabilityErrorHandler());
    await registerLaunchRoutes(app, {
      prisma: fake as unknown as PrismaClient,
    });
  });

  const authed = () => ({
    headers: { cookie: `${SESSION_COOKIE_NAME}=${authCookie}` },
  });

  it("401 without session on list", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/launch" });
    expect(res.statusCode).toBe(401);
  });

  it("POST creates a DRAFT checklist without offer", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/launch",
      ...authed(),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.checklist.status).toBe("DRAFT");
    expect(body.checklist.currentStep).toBe(1);
    expect(body.checklist.offerId).toBeNull();
  });

  it("POST creates a checklist linked to an offer", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/launch",
      ...authed(),
      payload: { offerId: OFFER },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().checklist.offerId).toBe(OFFER);
  });

  it("POST 404 when the offer belongs to another tenant", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/launch",
      ...authed(),
      payload: { offerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("list returns only the current tenant's checklists", async () => {
    await (fake as any).launchChecklist.create({
      data: {
        id: randomUUID(),
        tenantId: TENANT,
        status: "DRAFT",
        currentStep: 1,
        stepsData: {},
      },
    });
    await (fake as any).launchChecklist.create({
      data: {
        id: randomUUID(),
        tenantId: OTHER_TENANT,
        status: "DRAFT",
        currentStep: 1,
        stepsData: {},
      },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/launch",
      ...authed(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.checklists).toHaveLength(1);
    expect(body.checklists[0].tenantId).toBe(TENANT);
  });

  it("GET detail 404s for another tenant's checklist", async () => {
    const other = await (fake as any).launchChecklist.create({
      data: {
        id: randomUUID(),
        tenantId: OTHER_TENANT,
        status: "DRAFT",
        currentStep: 1,
        stepsData: {},
      },
    });
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/launch/${other.id}`,
      ...authed(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("complete-step advances the step and persists data", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/launch",
      ...authed(),
      payload: { offerId: OFFER },
    });
    const id = created.json().checklist.id;
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/launch/${id}/complete-step`,
      ...authed(),
      payload: { step: 1, data: { offerId: OFFER } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.checklist.status).toBe("IN_PROGRESS");
    expect(body.checklist.currentStep).toBe(2);
    expect(body.checklist.stepsData.step1).toEqual({ offerId: OFFER });
  });

  it("complete-step on step 6 marks the checklist COMPLETED", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/launch",
      ...authed(),
      payload: { offerId: OFFER },
    });
    const id = created.json().checklist.id;
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/launch/${id}/complete-step`,
      ...authed(),
      payload: { step: 6, data: { confirmed: true } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.checklist.status).toBe("COMPLETED");
    expect(body.checklist.currentStep).toBe(6);
    expect(body.checklist.completedAt).toBeTruthy();
  });

  it("complete-step rejects an out-of-range step and non-object data", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/launch",
      ...authed(),
      payload: {},
    });
    const id = created.json().checklist.id;
    const bad = await app.inject({
      method: "POST",
      url: `/api/v1/launch/${id}/complete-step`,
      ...authed(),
      payload: { step: 7, data: {} },
    });
    expect(bad.statusCode).toBe(400);
    const badData = await app.inject({
      method: "POST",
      url: `/api/v1/launch/${id}/complete-step`,
      ...authed(),
      payload: { step: 1, data: "nope" },
    });
    expect(badData.statusCode).toBe(400);
  });

  it("tracking-link creation requires a selected offer", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/launch",
      ...authed(),
      payload: {},
    });
    const id = created.json().checklist.id;
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/launch/${id}/tracking-link`,
      ...authed(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("tracking-link creation makes a DRAFT link bound to the checklist", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/launch",
      ...authed(),
      payload: { offerId: OFFER },
    });
    const id = created.json().checklist.id;
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/launch/${id}/tracking-link`,
      ...authed(),
      payload: { publicId: "tl_wizard1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.trackingLink.status).toBe("DRAFT");
    expect(body.trackingLink.offerId).toBe(OFFER);
    expect(body.trackingLink.publicId).toBe("tl_wizard1");
    expect(body.checklist.trackingLinkId).toBe(body.trackingLink.id);
  });

  it("activate flips the link ACTIVE, queues the push task, completes the checklist", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/launch",
      ...authed(),
      payload: { offerId: OFFER },
    });
    const id = created.json().checklist.id;
    await app.inject({
      method: "POST",
      url: `/api/v1/launch/${id}/tracking-link`,
      ...authed(),
      payload: { publicId: "tl_wizard2" },
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/launch/${id}/activate`,
      ...authed(),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.trackingLink.status).toBe("ACTIVE");
    expect(body.checklist.status).toBe("COMPLETED");
    expect(body.scriptPush.syncJobId).toBeTruthy();
    expect(body.scriptPush.note).toBeTruthy();
    expect(fake._rows.syncJobs).toHaveLength(1);
    expect(fake._rows.syncJobs[0].type).toBe("LAUNCH_SCRIPT_PUSH");
  });

  it("activate is idempotent — no duplicate sync jobs on retry", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/launch",
      ...authed(),
      payload: { offerId: OFFER },
    });
    const id = created.json().checklist.id;
    await app.inject({
      method: "POST",
      url: `/api/v1/launch/${id}/tracking-link`,
      ...authed(),
      payload: { publicId: "tl_wizard3" },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/launch/${id}/activate`,
      ...authed(),
      payload: {},
    });
    const retry = await app.inject({
      method: "POST",
      url: `/api/v1/launch/${id}/activate`,
      ...authed(),
      payload: {},
    });
    expect(retry.statusCode).toBe(200);
    expect(fake._rows.syncJobs).toHaveLength(1);
  });

  it("activate 400s when no tracking link was created yet", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/launch",
      ...authed(),
      payload: { offerId: OFFER },
    });
    const id = created.json().checklist.id;
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/launch/${id}/activate`,
      ...authed(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("activate 404s for another tenant's checklist", async () => {
    const other = await (fake as any).launchChecklist.create({
      data: {
        id: randomUUID(),
        tenantId: OTHER_TENANT,
        offerId: OFFER,
        status: "IN_PROGRESS",
        currentStep: 5,
        stepsData: {},
      },
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/launch/${other.id}/activate`,
      ...authed(),
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});
