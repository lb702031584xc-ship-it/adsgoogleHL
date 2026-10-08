/**
 * Phase 5 — strategy route contract tests.
 * In-memory fake Prisma + Fastify inject, fake LLM, real session auth.
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
  assertAiSettingsPepperConfigured,
  encryptSecret,
} from "../ai/crypto.js";
import { registerStrategyRoutes } from "./strategy.js";

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if (k === "click" && typeof (v as any).offerId === "string") {
        return row.offerId === (v as any).offerId;
      }
      const rv = row[k];
      if ("gte" in v && !(rv >= (v as any).gte)) return false;
      if ("not" in v) {
        const n = (v as any).not;
        if (n === null) return rv !== null && rv !== undefined;
        return rv !== n;
      }
      if ("notIn" in v && ((v as any).notIn as any[]).includes(rv)) return false;
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
        ...data,
      };
      rows.push(row);
      return { ...row };
    },
    count: async ({ where }: any) =>
      rows.filter((r) => matches(r, where)).length,
    aggregate: async ({ _sum, where }: any) => {
      const out: any = { _sum: {} };
      if (_sum) {
        for (const field of Object.keys(_sum)) {
          const vals = rows
            .filter((r) => matches(r, where))
            .map((r) => Number(r[field] ?? 0));
          out._sum[field] = vals.length ? vals.reduce((a, b) => a + b, 0) : null;
        }
      }
      return out;
    },
    groupBy: async ({ by, where, _count, orderBy, take }: any) => {
      const filtered = rows.filter((r) => matches(r, where));
      const groups = new Map<string, Row>();
      for (const r of filtered) {
        const key = JSON.stringify(by.map((b: string) => r[b] ?? null));
        if (!groups.has(key)) {
          const g: Row = {};
          for (const b of by) g[b] = r[b] ?? null;
          g._count = {};
          groups.set(key, g);
        }
        const g = groups.get(key)!;
        if (_count?._all) g._count._all = (g._count._all ?? 0) + 1;
        for (const f of Object.keys(_count ?? {})) {
          if (f === "_all") continue;
          if (r[f] !== null && r[f] !== undefined) {
            g._count[f] = (g._count[f] ?? 0) + 1;
          }
        }
      }
      let out = [...groups.values()];
      if (orderBy?._count) {
        const [ck, dir] = Object.entries(orderBy._count)[0] as [string, string];
        out.sort((a, b) =>
          dir === "desc" ? b._count[ck] - a._count[ck] : a._count[ck] - b._count[ck]
        );
      }
      if (typeof take === "number") out = out.slice(0, take);
      return out;
    },
  };
}

const GO_TERMS = {
  overallVerdict: "go",
  traffic: {
    search: "allowed",
    display: "allowed",
    email: "unknown",
    social: "allowed",
    incentivized: "unknown",
  },
  brandBidding: "forbidden",
  directLinking: "allowed",
  geoRestrictions: [],
  caps: null,
  payoutTerms: "$80 per sale",
  redFlags: [
    {
      severity: "low",
      title: "Brand bidding",
      detail: "Bidding on brand keywords is not allowed.",
    },
  ],
  summary: "Paid search allowed; brand bidding forbidden.",
};

const ANALYSIS_SHAPE = {
  overallRisk: 25,
  riskLevel: "low",
  scores: { merchant: 20, policy: 30, network: 25 },
  findings: [
    {
      area: "policy",
      severity: "low",
      title: "Brand bidding forbidden",
      detail: "Do not bid on brand keywords.",
    },
  ],
  suggestions: ["Avoid brand keywords."],
  keywords: ["cheap shoes", "running shoes"],
  adAngles: ["Price comparison"],
};

function makeFakeChatJson() {
  return async (args: any) => {
    if (args.user.includes("Offer terms text")) return GO_TERMS;
    return ANALYSIS_SHAPE;
  };
}

function makeFakePrisma() {
  const tenants: Row[] = [];
  const users: Row[] = [];
  const sessions: Row[] = [];
  const aiSettings: Row[] = [];
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
    offer: mkStore([]),
    merchant: mkStore([]),
    offerPolicy: mkStore([]),
    policyEvidence: mkStore([]),
    offerRiskScore: mkStore([]),
    profitModel: mkStore([]),
    aiAnalysis: mkStore([]),
    aiSetting: { findMany: async () => [...aiSettings] },
    click: mkStore([]),
    conversion: mkStore([]),
    order: mkStore([]),
    experiment: mkStore([]),
    killSwitchConfig: mkStore([]),
    killSwitchEvent: mkStore([]),
    _aiSettings: aiSettings,
  };
}
type FakePrisma = ReturnType<typeof makeFakePrisma>;

const TENANT = "11111111-1111-4111-8111-111111111111";
const OFFER = "22222222-2222-4222-8222-222222222222";

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

async function seedOffer(fake: FakePrisma) {
  const pepper = assertAiSettingsPepperConfigured();
  fake._aiSettings.push(
    { key: "llm.baseUrl", value: "https://fake-llm.example/v1" },
    { key: "llm.model", value: "fake-model" },
    { key: "llm.apiKeyEnc", value: encryptSecret("fake-key", pepper) }
  );
  await (fake as any).offer.create({
    data: {
      id: OFFER,
      tenantId: TENANT,
      name: "Acme Shoes Offer",
      network: "Impact",
      destinationUrl: "https://acme.example/offer",
      commissionValue: 80,
    },
  });
  await (fake as any).offerPolicy.create({
    data: {
      id: randomUUID(),
      tenantId: TENANT,
      offerId: OFFER,
      rawTerms:
        "Stored offer terms for the Acme shoes affiliate program, long enough " +
        "to pass validation. Paid search allowed; brand bidding forbidden.",
    },
  });
}

describe("strategy routes", () => {
  let fake: FakePrisma;
  let token: string;
  let app: any;

  beforeEach(async () => {
    fake = makeFakePrisma();
    token = await seedAuth(fake);
    await seedOffer(fake);
    app = Fastify({ logger: false });
    app.setErrorHandler(createObservabilityErrorHandler());
    await registerStrategyRoutes(app, {
      prisma: fake as unknown as PrismaClient,
      chatJsonImpl: makeFakeChatJson() as any,
    });
  });

  const authed = () => ({ headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } });

  it("POST /strategy requires auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/offers/${OFFER}/strategy`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /strategy returns the full StrategyOutput", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/offers/${OFFER}/strategy`,
      ...authed(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.offerId).toBe(OFFER);
    expect(body.decision.decision).toBeDefined();
    expect(body.research.status).toBe("NO_DATA");
    expect(body.traffic).toBeDefined();
    expect(body.experiments).toBeDefined();
    expect(body.killSwitch).toBeDefined();
    expect(body.campaignPlan.offerId).toBe(OFFER);
    expect(body.scaleRecommendation).toBeDefined();
  });

  it("GET /campaign-plan returns the plan; ?download=1 attaches it", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/offers/${OFFER}/campaign-plan`,
      ...authed(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.offerId).toBe(OFFER);
    expect(Array.isArray(body.campaigns)).toBe(true);
    expect(body.negatives).toBeDefined();
    expect(body.budget).toBeDefined();

    const dl = await app.inject({
      method: "GET",
      url: `/api/v1/offers/${OFFER}/campaign-plan?download=1`,
      ...authed(),
    });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-disposition"]).toContain("attachment");
  });

  it("returns 404 for an unknown offer id", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/offers/99999999-9999-4999-8999-999999999999/campaign-plan`,
      ...authed(),
    });
    expect(res.statusCode).toBe(404);
  });
});
