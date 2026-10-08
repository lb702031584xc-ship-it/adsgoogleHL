/**
 * 功能1 — link-swap route contract tests.
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
import { registerLinkSwapRoutes } from "./link-swap.js";

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      const rv = row[k];
      if ("gte" in v && !(rv >= (v as any).gte)) return false;
      if ("not" in v) {
        const n = (v as any).not;
        if (n === null) return rv !== null && rv !== undefined;
        return rv !== n;
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
        deletedAt: null,
        archivedAt: null,
        ...data,
      };
      rows.push(row);
      return { ...row };
    },
    upsert: async ({ where, update, create: cdata }: any) => {
      const key = where?.tenantId_integrationId_entityType_entityId;
      const existing = key
        ? rows.find(
            (r) =>
              r.tenantId === key.tenantId &&
              r.integrationId === key.integrationId &&
              r.entityType === key.entityType &&
              r.entityId === key.entityId
          )
        : rows.find((r) => matches(r, where));
      if (existing) {
        Object.assign(existing, update, { updatedAt: new Date() });
        return { ...existing };
      }
      const row = {
        id: cdata.id ?? randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        archivedAt: null,
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
  const trackingLinks: Row[] = [];
  const ads: Row[] = [];
  const adGroups: Row[] = [];
  const campaigns: Row[] = [];
  const googleAccounts: Row[] = [];
  const integrations: Row[] = [];
  const urlVersions: Row[] = [];
  const urlChangeRequests: Row[] = [];
  const syncTargets: Row[] = [];
  const auditLogs: Row[] = [];
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
    trackingLink: mkStore(trackingLinks),
    ad: mkStore(ads),
    adGroup: mkStore(adGroups),
    campaign: mkStore(campaigns),
    googleAccount: mkStore(googleAccounts),
    googleAdsScriptIntegration: mkStore(integrations),
    urlVersion: mkStore(urlVersions),
    urlChangeRequest: mkStore(urlChangeRequests),
    scriptSyncTarget: mkStore(syncTargets),
    auditLog: mkStore(auditLogs),
    _rows: {
      trackingLinks,
      ads,
      adGroups,
      campaigns,
      googleAccounts,
      integrations,
      urlVersions,
      urlChangeRequests,
      syncTargets,
      auditLogs,
    },
  };
}
type FakePrisma = ReturnType<typeof makeFakePrisma>;

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const GOOGLE_ACCOUNT = "22222222-2222-4222-8222-222222222222";
const CAMPAIGN = "33333333-3333-4333-8333-333333333333";
const AD_GROUP = "44444444-4444-4344-8344-444444444444";
const AD = "55555555-5555-4355-8355-555555555555";
const LINK = "66666666-6666-4366-8366-666666666666";
const INTEGRATION = "77777777-7777-4377-8377-777777777777";
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

async function seedChain(fake: FakePrisma) {
  await (fake as any).googleAccount.create({
    data: {
      id: GOOGLE_ACCOUNT,
      tenantId: TENANT,
      userId: randomUUID(),
      customerId: "123-456-7890",
      name: "Test Account",
      currency: "USD",
      timezone: "America/New_York",
    },
  });
  await (fake as any).campaign.create({
    data: { id: CAMPAIGN, tenantId: TENANT, googleAccountId: GOOGLE_ACCOUNT },
  });
  await (fake as any).adGroup.create({
    data: { id: AD_GROUP, tenantId: TENANT, campaignId: CAMPAIGN },
  });
  await (fake as any).ad.create({
    data: {
      id: AD,
      tenantId: TENANT,
      adGroupId: AD_GROUP,
      googleAdId: "111222333",
    },
  });
  await (fake as any).trackingLink.create({
    data: {
      id: LINK,
      tenantId: TENANT,
      publicId: "tl_test1",
      offerId: OFFER,
      adId: AD,
      adGroupId: AD_GROUP,
      campaignId: CAMPAIGN,
      status: "ACTIVE",
    },
  });
  await (fake as any).googleAdsScriptIntegration.create({
    data: {
      id: INTEGRATION,
      tenantId: TENANT,
      googleAccountId: GOOGLE_ACCOUNT,
      name: "Test Integration",
      status: "ACTIVE",
      tokenKeyId: "k1",
      tokenPrefix: "alk_s_ab12",
      tokenHash: "hash-1",
    },
  });
}

const NEW_URL = "https://merchant.example/deal?promo=1";
const REFERRAL_URL = "https://referral.example/go?aff=123&sub=abc";

describe("link-swap routes", () => {
  let fake: FakePrisma;
  let authCookie: string;
  let app: any;

  beforeEach(async () => {
    fake = makeFakePrisma();
    authCookie = await seedAuth(fake);
    await seedChain(fake);
    app = Fastify({ logger: false });
    app.setErrorHandler(createObservabilityErrorHandler());
    await registerLinkSwapRoutes(app, {
      prisma: fake as unknown as PrismaClient,
    });
  });

  const authed = () => ({
    headers: { cookie: `${SESSION_COOKIE_NAME}=${authCookie}` },
  });
  const url = `/api/v1/tracking-links/${LINK}/swap-url`;

  it("401 without session", async () => {
    const res = await app.inject({
      method: "POST",
      url,
      payload: { newUrl: NEW_URL },
    });
    expect(res.statusCode).toBe(401);
  });

  it("400 when newUrl is invalid", async () => {
    const res = await app.inject({
      method: "POST",
      url,
      ...authed(),
      payload: { newUrl: "not-a-url" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 when the tracking link belongs to another tenant", async () => {
    await (fake as any).trackingLink.create({
      data: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        tenantId: OTHER_TENANT,
        publicId: "tl_other",
        offerId: OFFER,
        adId: AD,
        status: "ACTIVE",
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tracking-links/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/swap-url",
      ...authed(),
      payload: { newUrl: NEW_URL },
    });
    expect(res.statusCode).toBe(404);
  });

  it("400 when no ACTIVE script integration exists for the account", async () => {
    fake._rows.integrations.length = 0;
    const res = await app.inject({
      method: "POST",
      url,
      ...authed(),
      payload: { newUrl: NEW_URL },
    });
    expect(res.statusCode).toBe(400);
  });

  it("creates the request, version, task and audit entry (full fields)", async () => {
    const res = await app.inject({
      method: "POST",
      url,
      ...authed(),
      payload: {
        newUrl: NEW_URL,
        referralUrl: REFERRAL_URL,
        deviceTarget: "mobile",
        googleAccountId: GOOGLE_ACCOUNT,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // --- UrlChangeRequest: existing initial status + new automation fields ---
    expect(body.request.status).toBe("DRAFT");
    expect(body.request.entityType).toBe("AD");
    expect(body.request.entityId).toBe(AD);
    expect(body.request.referralUrl).toBe(REFERRAL_URL);
    expect(body.request.deviceTarget).toBe("mobile");
    expect(body.request.googleAccountId).toBe(GOOGLE_ACCOUNT);
    expect(body.request.idempotencyKey).toBeTruthy();

    const stored = fake._rows.urlChangeRequests;
    expect(stored).toHaveLength(1);
    expect(stored[0].toVersionId).toBeTruthy();

    // --- UrlVersion carries the new URL (mobile slot for deviceTarget=mobile) ---
    const versions = fake._rows.urlVersions;
    expect(versions).toHaveLength(1);
    expect(versions[0].finalUrl).toBe(NEW_URL);
    expect(versions[0].finalMobileUrl).toBe(NEW_URL);
    expect(versions[0].status).toBe("DRAFT");
    expect(versions[0].version).toBe(1);
    expect(body.request.toVersionId).toBe(versions[0].id);

    // --- ScriptSyncTarget: the push-url-change task ---
    expect(body.task.type).toBe("push-url-change");
    expect(body.task.entityType).toBe("AD");
    expect(body.task.entityId).toBe(AD);
    expect(body.task.desiredVersion).toBe(1);
    const targets = fake._rows.syncTargets;
    expect(targets).toHaveLength(1);
    expect(targets[0].id).toBe(body.task.scriptSyncTargetId);
    expect(targets[0].integrationId).toBe(INTEGRATION);
    expect(targets[0].googleAdId).toBe("111222333");
    expect(targets[0].desiredVersion).toBe(1);
    expect(targets[0].syncState).toBe("NEVER_APPLIED");

    // --- AuditLog written ---
    const logs = fake._rows.auditLogs;
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("URL_CHANGE_REQUEST_CREATED");
    expect(logs[0].entityType).toBe("UrlChangeRequest");
    expect(logs[0].entityId).toBe(body.request.id);
    expect(logs[0].after.taskType).toBe("push-url-change");
    expect(logs[0].after.trackingLinkId).toBe(LINK);
    expect(logs[0].after.newUrl).toBe(NEW_URL);
    expect(logs[0].after.deviceTarget).toBe("mobile");
  });

  it("works without googleAccountId (derived from the campaign)", async () => {
    const res = await app.inject({
      method: "POST",
      url,
      ...authed(),
      payload: { newUrl: NEW_URL, deviceTarget: "all" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.request.googleAccountId).toBe(GOOGLE_ACCOUNT);
    expect(body.request.deviceTarget).toBe("all");
    expect(body.request.referralUrl).toBeNull();
    expect(fake._rows.syncTargets).toHaveLength(1);
    expect(fake._rows.auditLogs).toHaveLength(1);
    // deviceTarget=all fills both URL slots
    expect(fake._rows.urlVersions[0].finalUrl).toBe(NEW_URL);
    expect(fake._rows.urlVersions[0].finalMobileUrl).toBe(NEW_URL);
  });

  it("second swap reuses the existing target and bumps desiredVersion", async () => {
    const first = await app.inject({
      method: "POST",
      url,
      ...authed(),
      payload: { newUrl: NEW_URL },
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: "POST",
      url,
      ...authed(),
      payload: { newUrl: "https://merchant.example/deal2" },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json();
    expect(fake._rows.syncTargets).toHaveLength(1);
    expect(fake._rows.syncTargets[0].desiredVersion).toBe(2);
    expect(secondBody.task.scriptSyncTargetId).toBe(
      fake._rows.syncTargets[0].id
    );
    expect(fake._rows.urlChangeRequests).toHaveLength(2);
    expect(fake._rows.auditLogs).toHaveLength(2);
  });
});
