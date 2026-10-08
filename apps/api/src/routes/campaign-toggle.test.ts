/**
 * Campaign toggle route tests. In-memory fake Prisma + Fastify inject.
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
import { registerCampaignToggleRoutes } from "./campaign-toggle.js";

type Row = Record<string, any>;

interface Ctx {
  tenants: Row[];
  users: Row[];
  sessions: Row[];
  campaigns: Row[];
  googleAccounts: Row[];
  syncJobs: Row[];
  auditLogs: Row[];
}

function baseCtx(): Ctx {
  return {
    tenants: [],
    users: [],
    sessions: [],
    campaigns: [],
    googleAccounts: [],
    syncJobs: [],
    auditLogs: [],
  };
}

function makeFake(ctx: Ctx) {
  return {
    tenant: {
      create: async (args: any) => {
        const row = { ...args.data };
        ctx.tenants.push(row);
        return row;
      },
    },
    user: {
      create: async (args: any) => {
        const row = { ...args.data };
        ctx.users.push(row);
        return row;
      },
      findUnique: async (args: any) =>
        ctx.users.find((u) => u.id === args.where.id) ?? null,
    },
    session: {
      create: async (args: any) => {
        const row = { ...args.data };
        ctx.sessions.push(row);
        return row;
      },
      findUnique: async (args: any) => {
        const row =
          ctx.sessions.find((s) => s.tokenHash === args.where.tokenHash) ??
          null;
        if (!row) return null;
        return {
          ...row,
          user: ctx.users.find((u) => u.id === row.userId) ?? null,
        };
      },
      findFirst: async (args: any) => {
        const rows = ctx.sessions.filter((s) =>
          Object.entries(args.where ?? {}).every(([k, v]) => s[k] === v)
        );
        return rows[0] ?? null;
      },
      update: async (args: any) => {
        const row = ctx.sessions.find((s) => s.id === args.where.id);
        if (row) Object.assign(row, args.data);
        return row ?? null;
      },
    },
    campaign: {
      findFirst: async (args: any) =>
        ctx.campaigns.find((c) =>
          Object.entries(args.where ?? {}).every(([k, v]) =>
            v === null ? c[k] == null : c[k] === v
          )
        ) ?? null,
    },
    googleAccount: {
      findFirst: async (args: any) =>
        ctx.googleAccounts.find((g) =>
          Object.entries(args.where ?? {}).every(([k, v]) =>
            v === null ? g[k] == null : g[k] === v
          )
        ) ?? null,
    },
    syncJob: {
      findUnique: async (args: any) => {
        const w = args.where?.tenantId_idempotencyScope_idempotencyKey;
        if (!w) return null;
        return (
          ctx.syncJobs.find(
            (j) =>
              j.tenantId === w.tenantId &&
              j.idempotencyScope === w.idempotencyScope &&
              j.idempotencyKey === w.idempotencyKey
          ) ?? null
        );
      },
      findFirst: async (args: any) =>
        ctx.syncJobs.find((j) =>
          Object.entries(args.where ?? {}).every(([k, v]) =>
            v === null ? j[k] == null : j[k] === v
          )
        ) ?? null,
      create: async (args: any) => {
        const now = new Date();
        const row = {
          ...args.data,
          error: null,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        };
        ctx.syncJobs.push(row);
        return row;
      },
      update: async (args: any) => {
        const row = ctx.syncJobs.find((j) => j.id === args.where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, args.data, { updatedAt: new Date() });
        return row;
      },
    },
    auditLog: {
      create: async (args: any) => {
        const row = { ...args.data, createdAt: new Date() };
        ctx.auditLogs.push(row);
        return row;
      },
      findFirst: async (args: any) => {
        const rows = ctx.auditLogs
          .filter((a) =>
            Object.entries(args.where ?? {}).every(([k, v]) =>
              v === null ? a[k] == null : a[k] === v
            )
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return rows[0] ?? null;
      },
    },
  } as unknown as PrismaClient;
}

type FakePrisma = ReturnType<typeof makeFake>;

function cookie(token: string) {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

async function seedAuth(fake: FakePrisma, ctx: Ctx) {
  const tenantId = randomUUID();
  await (fake as any).tenant.create({
    data: { id: tenantId, name: "t", slug: `t-${tenantId.slice(0, 8)}`, status: "ACTIVE" },
  });
  const user = await (fake as any).user.create({
    data: {
      id: randomUUID(),
      tenantId,
      email: "member@example.com",
      name: "member",
      role: "member",
      status: "ACTIVE",
    },
  });
  const session = await createSession(fake as unknown as PrismaClient, user.id);
  return { tenantId, user, token: session.token };
}

async function buildApp(fake: FakePrisma) {
  const app = Fastify({ logger: false });
  app.setErrorHandler(createObservabilityErrorHandler());
  await registerCampaignToggleRoutes(app, {
    prisma: fake as unknown as PrismaClient,
  });
  return app;
}

describe("campaign-toggle routes", () => {
  let ctx: Ctx;
  let fake: FakePrisma;
  let app: any;
  let auth: { tenantId: string; user: any; token: string };
  let campaignId: string;
  let googleAccountId: string;

  beforeEach(async () => {
    ctx = baseCtx();
    fake = makeFake(ctx);
    app = await buildApp(fake);
    auth = await seedAuth(fake, ctx);
    googleAccountId = randomUUID();
    ctx.googleAccounts.push({
      id: googleAccountId,
      tenantId: auth.tenantId,
      customerId: "1234567890",
      name: "acct",
    });
    campaignId = randomUUID();
    ctx.campaigns.push({
      id: campaignId,
      tenantId: auth.tenantId,
      googleAccountId,
      googleCampaignId: "987654321",
      name: "Campaign A",
      status: "ACTIVE",
      deletedAt: null,
    });
  });

  function toggle(body: any, id: string = campaignId, token?: string) {
    return app.inject({
      method: "POST",
      url: `/api/v1/google-ads/campaigns/${id}/toggle`,
      headers: cookie(token ?? auth.token),
      payload: body,
    });
  }

  it("queues an ENABLE task with a correct payload and writes an audit log", async () => {
    const res = await toggle({
      action: "ENABLE",
      googleAccountId,
      reason: "seasonal push",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.deduped).toBe(false);
    expect(body.taskId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );

    // Task record
    expect(ctx.syncJobs).toHaveLength(1);
    const job = ctx.syncJobs[0];
    expect(job.type).toBe("campaign-toggle");
    expect(job.status).toBe("PENDING");
    expect(job.provider).toBe("google-ads-script");
    expect(job.idempotencyScope).toBe("CAMPAIGN_TOGGLE");
    expect(job.tenantId).toBe(auth.tenantId);
    expect(job.externalAccountId).toBe(googleAccountId);

    // Response carries the task payload fields
    expect(body.task.action).toBe("ENABLE");
    expect(body.task.campaignId).toBe(campaignId);
    expect(body.task.googleCampaignId).toBe("987654321");
    expect(body.task.googleAccountId).toBe(googleAccountId);
    expect(body.task.status).toBe("PENDING");

    // Audit log written with action + reason
    expect(ctx.auditLogs).toHaveLength(1);
    const audit = ctx.auditLogs[0];
    expect(audit.action).toBe("CAMPAIGN_TOGGLE_QUEUED");
    expect(audit.entityType).toBe("SyncJob");
    expect(audit.entityId).toBe(body.taskId);
    expect(audit.reason).toBe("seasonal push");
    expect(audit.after.type).toBe("campaign-toggle");
    expect(audit.after.campaignId).toBe(campaignId);
    expect(audit.after.googleCampaignId).toBe("987654321");
    expect(audit.after.action).toBe("ENABLE");
    expect(audit.after.googleAccountId).toBe(googleAccountId);
    expect(audit.after.tenantId).toBe(auth.tenantId);
  });

  it("queues a PAUSE task and applies a default reason when omitted", async () => {
    const res = await toggle({ action: "PAUSE", googleAccountId });
    expect(res.statusCode).toBe(200);
    expect(res.json().task.action).toBe("PAUSE");
    expect(ctx.auditLogs[0].reason).toContain("PAUSE");
  });

  it("rejects an invalid action value", async () => {
    for (const action of ["enable", "RESUME", "", 123, null, undefined]) {
      const res = await toggle({ action, googleAccountId });
      expect(res.statusCode).toBe(400);
    }
    expect(ctx.syncJobs).toHaveLength(0);
    expect(ctx.auditLogs).toHaveLength(0);
  });

  it("rejects a missing googleAccountId", async () => {
    const res = await toggle({ action: "ENABLE" });
    expect(res.statusCode).toBe(400);
    expect(ctx.syncJobs).toHaveLength(0);
  });

  it("rejects a googleAccountId that does not match the campaign", async () => {
    const res = await toggle({ action: "ENABLE", googleAccountId: randomUUID() });
    expect(res.statusCode).toBe(400);
    expect(ctx.syncJobs).toHaveLength(0);
  });

  it("returns 404 for a campaign belonging to another tenant", async () => {
    const otherTenantId = randomUUID();
    const otherCampaignId = randomUUID();
    const otherAccountId = randomUUID();
    ctx.googleAccounts.push({
      id: otherAccountId,
      tenantId: otherTenantId,
      customerId: "999",
      name: "other",
    });
    ctx.campaigns.push({
      id: otherCampaignId,
      tenantId: otherTenantId,
      googleAccountId: otherAccountId,
      googleCampaignId: "111",
      name: "Other",
      status: "ACTIVE",
      deletedAt: null,
    });
    const res = await toggle(
      { action: "PAUSE", googleAccountId: otherAccountId },
      otherCampaignId
    );
    expect(res.statusCode).toBe(404);
    expect(ctx.syncJobs).toHaveLength(0);
  });

  it("returns 404 for a malformed campaign id", async () => {
    const res = await toggle({ action: "ENABLE", googleAccountId }, "not-a-uuid");
    expect(res.statusCode).toBe(404);
  });

  it("dedupes a second queue of the same action while pending", async () => {
    const first = await toggle({ action: "ENABLE", googleAccountId });
    expect(first.statusCode).toBe(200);
    const second = await toggle({ action: "ENABLE", googleAccountId });
    expect(second.statusCode).toBe(200);
    const body = second.json();
    expect(body.deduped).toBe(true);
    expect(body.taskId).toBe(first.json().taskId);
    expect(ctx.syncJobs).toHaveLength(1);
    expect(ctx.auditLogs).toHaveLength(1);
  });

  it("queues a different action separately while one is pending", async () => {
    await toggle({ action: "ENABLE", googleAccountId });
    const res = await toggle({ action: "PAUSE", googleAccountId });
    expect(res.statusCode).toBe(200);
    expect(res.json().deduped).toBe(false);
    expect(ctx.syncJobs).toHaveLength(2);
  });

  it("requires authentication", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/google-ads/campaigns/${campaignId}/toggle`,
      payload: { action: "ENABLE", googleAccountId },
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET task status returns the queued task for polling", async () => {
    const queued = await toggle({ action: "PAUSE", googleAccountId });
    const taskId = queued.json().taskId;
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/google-ads/campaign-toggle-tasks/${taskId}`,
      headers: cookie(auth.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.taskId).toBe(taskId);
    expect(body.status).toBe("PENDING");
    expect(body.action).toBe("PAUSE");
    expect(body.campaignId).toBe(campaignId);
    expect(body.googleCampaignId).toBe("987654321");
  });

  it("GET task status returns 404 for an unknown task id", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/google-ads/campaign-toggle-tasks/${randomUUID()}`,
      headers: cookie(auth.token),
    });
    expect(res.statusCode).toBe(404);
  });
});
