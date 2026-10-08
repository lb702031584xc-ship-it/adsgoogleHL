/**
 * Phase 1 Offer Intelligence — route contract tests.
 * In-memory fake Prisma + Fastify inject, fake LLM for scan/decision.
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
import type { ChatJsonArgs } from "../ai/llm.js";
import { validateDecisionShape } from "../ai/pipeline.js";
import { registerOfferIntelRoutes } from "./offer-intel.js";

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      // Nested relation filters (e.g. click: { offerId }) map to flat fields.
      if (k === "click" && typeof (v as any).offerId === "string") {
        return row.offerId === (v as any).offerId;
      }
      const rv = row[k];
      if ("gte" in v && !(rv >= (v as any).gte)) return false;
      if ("gt" in v && !(rv > (v as any).gt)) return false;
      if ("lt" in v && !(rv < (v as any).lt)) return false;
      if ("lte" in v && !(rv <= (v as any).lte)) return false;
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
    findMany: async ({ where, orderBy }: any) =>
      sortRows(rows.filter((r) => matches(r, where)), orderBy).map((r) => ({
        ...r,
      })),
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
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error("fake: row not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return { ...row };
    },
    count: async ({ where }: any) => rows.filter((r) => matches(r, where)).length,
    aggregate: async ({ where, _sum }: any) => {
      if (_sum?.value) {
        const total = rows
          .filter((r) => matches(r, where))
          .reduce((s, r) => s + (typeof r.value === "number" ? r.value : 0), 0);
        return { _sum: { value: total } };
      }
      return { _sum: {} };
    },
    groupBy: async ({ where, by }: any) => {
      const filtered = rows.filter((r) => matches(r, where));
      const map = new Map<any, number>();
      for (const r of filtered) map.set(r[by[0]], (map.get(r[by[0]]) ?? 0) + 1);
      return [...map.entries()].map(([k, n]) => ({
        [by[0]]: k,
        _count: { [by[0]]: n, _all: n },
      }));
    },
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
    merchant: mkStore([]),
    affiliateNetwork: mkStore([]),
    offerPolicy: mkStore([]),
    policyEvidence: mkStore([]),
    offerRiskScore: mkStore([]),
    profitModel: mkStore([]),
    aiAnalysis: mkStore([]),
    aiSetting: {
      findMany: async () => [...aiSettings],
    },
    click: mkStore([]),
    conversion: mkStore([]),
    order: mkStore([]),
    auditLog: mkStore([]),
    _stores: {} as Record<string, Row[]>,
  };
  const aiSettings: Row[] = [];
  (stores as any)._rows = {
    tenants,
    users,
    sessions,
    aiSettings,
    offers: (stores.offer as any),
  };
  return { ...stores, aiSettings };
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

function cookie(token: string) {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

async function seedAuth(fake: FakePrisma, role: "admin" | "member" = "member") {
  const tenantId = randomUUID();
  await (fake as any).tenant.create({
    data: { id: tenantId, name: `${role}@t`, slug: `u-${role}`, status: "ACTIVE" },
  });
  const user = await (fake as any).user.create({
    data: {
      id: randomUUID(),
      tenantId,
      email: `${role}@example.com`,
      name: role,
      role,
      status: "ACTIVE",
    },
  });
  const session = await createSession(fake as unknown as PrismaClient, user.id);
  return { tenantId, user, token: session.token };
}

function seedAiSettings(fake: FakePrisma) {
  const pepper = assertAiSettingsPepperConfigured();
  fake.aiSettings.push(
    { key: "llm.baseUrl", value: "https://fake-llm.example/v1" },
    { key: "llm.model", value: "fake-model" },
    { key: "llm.apiKeyEnc", value: encryptSecret("fake-key", pepper) }
  );
}

const FORBIDDEN_PPC_TERMS = {
  overallVerdict: "stop",
  traffic: {
    search: "forbidden",
    display: "unknown",
    email: "unknown",
    social: "unknown",
    incentivized: "unknown",
  },
  brandBidding: "unknown",
  directLinking: "unknown",
  geoRestrictions: [],
  caps: null,
  payoutTerms: null,
  redFlags: [
    {
      severity: "high",
      title: "PPC forbidden",
      detail: "Paid search traffic is not permitted under any circumstances.",
    },
  ],
  summary: "PPC is forbidden.",
};

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

/** Fake LLM: terms prompt → terms shape; risk prompt → analysis shape. */
function makeFakeChatJson(terms: unknown = GO_TERMS) {
  return async (args: ChatJsonArgs) => {
    if (args.user.includes("Offer terms text")) return terms;
    return ANALYSIS_SHAPE;
  };
}

async function buildApp(
  fake: FakePrisma,
  terms: unknown = GO_TERMS
): Promise<any> {
  const app = Fastify({ logger: false });
  app.setErrorHandler(createObservabilityErrorHandler());
  await registerOfferIntelRoutes(app, {
    prisma: fake as unknown as PrismaClient,
    chatJsonImpl: makeFakeChatJson(terms) as any,
  });
  return app;
}

async function createOffer(
  app: any,
  token: string,
  extra: Record<string, unknown> = {}
): Promise<{ id: string; name: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/offers/import",
    headers: cookie(token),
    payload: {
      items: [
        {
          name: "Test Offer",
          network: "TestNet",
          destinationUrl: "https://merchant.example/offer",
          ...extra,
        },
      ],
    },
  });
  expect(res.statusCode).toBe(200);
  return res.json().offers[0];
}

describe("offers/import", () => {
  let fake: FakePrisma;
  let token: string;
  let app: any;
  beforeEach(async () => {
    fake = makeFakePrisma();
    ({ token } = await seedAuth(fake));
    seedAiSettings(fake);
    app = await buildApp(fake);
  });

  it("imports items array", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/offers/import",
      headers: cookie(token),
      payload: {
        items: [
          { name: "A", network: "N1", destinationUrl: "https://a.example" },
          {
            name: "B",
            destinationUrl: "https://b.example",
            commissionValue: "80",
            category: "Ecommerce",
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created).toBe(2);
    expect(body.offers).toHaveLength(2);
    expect(body.offers[0]).toHaveProperty("id");
    expect(body.offers[0].name).toBe("A");
  });

  it("imports CSV", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/offers/import",
      headers: cookie(token),
      payload: {
        csv: "name,network,destinationUrl\nCSV Offer,N2,https://csv.example",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(1);
  });

  it("400 when name/destinationUrl missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/offers/import",
      headers: cookie(token),
      payload: { items: [{ name: "NoUrl" }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 without session", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/offers/import",
      payload: { items: [] },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("scan → policy → risk → profit → simulate → decision chain", () => {
  let fake: FakePrisma;
  let token: string;
  let tenantId: string;
  let app: any;
  beforeEach(async () => {
    fake = makeFakePrisma();
    ({ token, tenantId } = await seedAuth(fake));
    seedAiSettings(fake);
    app = await buildApp(fake);
  });

  it("full chain: scan writes policy+evidence, policy reads back, decision emits §32 JSON", async () => {
    const { id: offerId } = await createOffer(app, token, {
      commissionValue: 80,
    });

    const termsText =
      "Paid search is allowed. Brand bidding is forbidden. " +
      "Direct linking is permitted for US traffic only. Payout $80 per sale.";
    const scanRes = await app.inject({
      method: "POST",
      url: `/api/v1/offers/${offerId}/scan`,
      headers: cookie(token),
      payload: { termsText },
    });
    expect(scanRes.statusCode).toBe(200);
    const scanBody = scanRes.json();
    expect(scanBody.policyId).toBeDefined();
    expect(scanBody.rulesFound).toBeGreaterThan(0);

    // PolicyEvidence rows exist with non-empty matchedText.
    const evRows = await (fake as any).policyEvidence.findMany({});
    expect(evRows.length).toBeGreaterThan(0);
    for (const ev of evRows) {
      expect(ev.matchedText.trim().length).toBeGreaterThan(0);
      expect(ev.confidence).toBeGreaterThan(0);
    }

    const policyRes = await app.inject({
      method: "GET",
      url: `/api/v1/offers/${offerId}/policy`,
      headers: cookie(token),
    });
    expect(policyRes.statusCode).toBe(200);
    const policyBody = policyRes.json();
    expect(policyBody.policy.rules.PPC).toBe("ALLOWED");
    expect(policyBody.evidence.length).toBe(evRows.length);

    const decisionRes = await app.inject({
      method: "POST",
      url: `/api/v1/offers/${offerId}/decision`,
      headers: cookie(token),
      payload: { trafficMode: "LANDING_PAGE", geo: ["US"] },
    });
    expect(decisionRes.statusCode).toBe(200);
    const d = decisionRes.json();
    // §32 frozen contract fields
    expect(d).toHaveProperty("decision");
    expect(d).toHaveProperty("riskScore");
    expect(d).toHaveProperty("profitScore");
    expect(d).toHaveProperty("policyScore");
    expect(d).toHaveProperty("breakEvenCpc");
    expect(d).toHaveProperty("recommendedMaxCpc");
    expect(d).toHaveProperty("trafficMode", "LANDING_PAGE");
    expect(d).toHaveProperty("directLink", false);
    expect(d).toHaveProperty("confidence");
    expect(d).toHaveProperty("reason");
    expect(d).toHaveProperty("manualChecks");
    expect(d).toHaveProperty("dataQuality", "PREDICTED");
    expect(Array.isArray(d.reason)).toBe(true);
    expect(d.manualChecks.length).toBeGreaterThan(0);
    // Validate with the same lenient validator the LLM path uses.
    expect(() => validateDecisionShape(d)).not.toThrow();

    const riskRes = await app.inject({
      method: "GET",
      url: `/api/v1/offers/${offerId}/risk`,
      headers: cookie(token),
    });
    expect(riskRes.statusCode).toBe(200);
    const riskBody = riskRes.json();
    expect(riskBody.score.decision).toBe(d.decision);
    expect(riskBody.score.dataQuality).toBe("OBSERVED");

    // Profit: no traffic yet → PREDICTED, three scenarios present.
    const profitRes = await app.inject({
      method: "GET",
      url: `/api/v1/offers/${offerId}/profit`,
      headers: cookie(token),
    });
    expect(profitRes.statusCode).toBe(200);
    const m = profitRes.json().model;
    expect(m.dataQuality).toBe("PREDICTED");
    expect(m.scenarios.worst).toHaveProperty("profit");
    expect(m.scenarios.base).toHaveProperty("profit");
    expect(m.scenarios.best).toHaveProperty("profit");
  });

  it("critical PPC=FORBIDDEN terms → DO_NOT_RUN without LLM risk call", async () => {
    const fake2 = makeFakePrisma();
    const { token: token2 } = await seedAuth(fake2);
    seedAiSettings(fake2);
    const strictApp = await buildApp(fake2, FORBIDDEN_PPC_TERMS);
    const { id: offerId } = await createOffer(strictApp, token2);
    const termsText =
      "Paid search traffic is strictly forbidden for this offer. " +
      "Any violation will result in commission reversal and account ban.";
    const scanRes = await strictApp.inject({
      method: "POST",
      url: `/api/v1/offers/${offerId}/scan`,
      headers: cookie(token2),
      payload: { termsText },
    });
    expect(scanRes.statusCode).toBe(200);
    const decisionRes = await strictApp.inject({
      method: "POST",
      url: `/api/v1/offers/${offerId}/decision`,
      headers: cookie(token2),
      payload: { trafficMode: "LANDING_PAGE", geo: [] },
    });
    expect(decisionRes.statusCode).toBe(200);
    const d = decisionRes.json();
    expect(d.decision).toBe("DO_NOT_RUN");
    expect(d.riskScore).toBe(100);
    expect(d.policyScore).toBe(0);
    expect(d.reason.join(" ")).toMatch(/PPC|paid search/i);
  });

  it("profit becomes OBSERVED with real clicks; PREDICTED never in OBSERVED channel", async () => {
    const { id: offerId } = await createOffer(app, token, {
      commissionValue: 80,
    });
    // Seed real traffic for this tenant+offer.
    for (let i = 0; i < 100; i++) {
      await (fake as any).click.create({
        data: { id: randomUUID(), tenantId, offerId, occurredAt: new Date() },
      });
    }
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/offers/${offerId}/profit`,
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(200);
    const m = res.json().model;
    expect(m.dataQuality).toBe("OBSERVED");
    // No observed data → PREDICTED, never OBSERVED.
    const { id: freshId } = await createOffer(app, token, { commissionValue: 10 });
    const fresh = await app.inject({
      method: "GET",
      url: `/api/v1/offers/${freshId}/profit`,
      headers: cookie(token),
    });
    expect(fresh.json().model.dataQuality).not.toBe("OBSERVED");
  });

  it("simulate computes exact worst/base/best numbers", async () => {
    const { id: offerId } = await createOffer(app, token);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/offers/${offerId}/simulate`,
      headers: cookie(token),
      payload: { cpc: 1, cvr: 2, clicks: 1000, commission: 80 },
    });
    expect(res.statusCode).toBe(200);
    const s = res.json().scenarios;
    // base: revenue 1000*0.02*0.9*80*0.95=1368, spend 1000 → profit 368
    expect(s.base).toEqual({ cvr: 2, cpc: 1, clicks: 1000, profit: 368 });
    // worst: cvr 1.0, cpc 1.5 → revenue 684, spend 1500 → -816
    expect(s.worst).toEqual({ cvr: 1, cpc: 1.5, clicks: 1000, profit: -816 });
    // best: cvr 3.0, cpc 0.8 → revenue 2052, spend 800 → 1252
    expect(s.best).toEqual({ cvr: 3, cpc: 0.8, clicks: 1000, profit: 1252 });
  });

  it("simulate uses offer.commissionValue when body commission absent; 400 when neither", async () => {
    const { id: withComm } = await createOffer(app, token, { commissionValue: 50 });
    const ok = await app.inject({
      method: "POST",
      url: `/api/v1/offers/${withComm}/simulate`,
      headers: cookie(token),
      payload: { cpc: 1, cvr: 2, clicks: 100 },
    });
    expect(ok.statusCode).toBe(200);
    const { id: noComm } = await createOffer(app, token);
    const bad = await app.inject({
      method: "POST",
      url: `/api/v1/offers/${noComm}/simulate`,
      headers: cookie(token),
      payload: { cpc: 1, cvr: 2 },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe("approve / pause write AuditLog (reason required)", () => {
  let fake: FakePrisma;
  let token: string;
  let app: any;
  let offerId: string;
  beforeEach(async () => {
    fake = makeFakePrisma();
    ({ token } = await seedAuth(fake));
    seedAiSettings(fake);
    app = await buildApp(fake);
    ({ id: offerId } = await createOffer(app, token));
  });

  it("400 without reason", async () => {
    for (const action of ["approve", "pause"]) {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/offers/${offerId}/${action}`,
        headers: cookie(token),
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it("approve writes AuditLog with reason + request context", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/offers/${offerId}/approve`,
      headers: { ...cookie(token), "user-agent": "test-agent/1.0" },
      payload: { reason: "Policy allows paid search" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const rows = await (fake as any).auditLog.findMany({});
    const row = rows.find((r: Row) => r.action === "OFFER_APPROVE");
    expect(row).toBeDefined();
    expect(row.entityType).toBe("Offer");
    expect(row.entityId).toBe(offerId);
    expect(row.reason).toBe("Policy allows paid search");
    expect(row.actorId).toBeDefined();
    expect(row.userAgent).toBe("test-agent/1.0");
  });

  it("pause writes AuditLog and flips status", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/offers/${offerId}/pause`,
      headers: cookie(token),
      payload: { reason: "CVR collapsed" },
    });
    expect(res.statusCode).toBe(200);
    const rows = await (fake as any).auditLog.findMany({});
    const row = rows.find((r: Row) => r.action === "OFFER_PAUSE");
    expect(row?.reason).toBe("CVR collapsed");
    const offer = await (fake as any).offer.findFirst({ where: { id: offerId } });
    expect(offer.status).toBe("PAUSED");
  });
});

describe("merchants / networks", () => {
  let fake: FakePrisma;
  let token: string;
  let tenantId: string;
  let app: any;
  beforeEach(async () => {
    fake = makeFakePrisma();
    ({ token, tenantId } = await seedAuth(fake));
    seedAiSettings(fake);
    app = await buildApp(fake);
  });

  it("create + list merchants; merchant list includes offerCount", async () => {
    // Networks are now managed via the dedicated networks module;
    // create directly via prisma for the merchant linkage test.
    const network = await fake.affiliateNetwork.create({
      data: {
        id: randomUUID(),
        tenantId,
        name: "Impact",
        website: "https://impact.example",
        apiConfigured: false,
        status: "ACTIVE",
      },
    });

    const mRes = await app.inject({
      method: "POST",
      url: "/api/v1/merchants",
      headers: cookie(token),
      payload: { name: "Adidas", domain: "adidas.com", networkId: network.id },
    });
    expect(mRes.statusCode).toBe(200);
    const merchant = mRes.json().merchant;
    expect(merchant.name).toBe("Adidas");

    await createOffer(app, token, { merchantId: merchant.id });

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/merchants",
      headers: cookie(token),
    });
    expect(list.statusCode).toBe(200);
    const rows = list.json().merchants;
    expect(rows).toHaveLength(1);
    expect(rows[0].offerCount).toBe(1);
    expect(rows[0]).toHaveProperty("riskScore");
  });

  it("400 on missing name", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/merchants",
      headers: cookie(token),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("tenant isolation: another tenant sees no rows", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/merchants",
      headers: cookie(token),
      payload: { name: "Solo" },
    });
    // Second tenant on the SAME fake DB must see nothing.
    const { token: token2 } = await seedAuth(fake, "admin");
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/merchants",
      headers: cookie(token2),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().merchants).toHaveLength(0);
  });
});

describe("validateDecisionShape leniency (§32)", () => {
  const base = {
    decision: "TEST",
    riskScore: 24,
    profitScore: 82,
    policyScore: 94,
    breakEvenCpc: 1.43,
    recommendedMaxCpc: 1.05,
    trafficMode: "LANDING_PAGE",
    directLink: false,
    confidence: 0.91,
    reason: ["Paid search allowed"],
    manualChecks: ["Confirm terms"],
    dataQuality: "OBSERVED",
  };

  it("accepts lowercase enums and numeric strings", () => {
    const out = validateDecisionShape({
      ...base,
      decision: "run",
      riskScore: "24",
      confidence: "0.91",
      trafficMode: "direct_link",
      directLink: "true",
      dataQuality: "predicted",
    });
    expect(out.decision).toBe("RUN");
    expect(out.riskScore).toBe(24);
    expect(out.confidence).toBe(0.91);
    expect(out.trafficMode).toBe("DIRECT_LINK");
    expect(out.directLink).toBe(true);
    expect(out.dataQuality).toBe("PREDICTED");
  });

  it("maps STOP to DO_NOT_RUN", () => {
    const out = validateDecisionShape({ ...base, decision: "STOP" });
    expect(out.decision).toBe("DO_NOT_RUN");
  });

  it("rejects unknown decision and out-of-range scores", () => {
    expect(() => validateDecisionShape({ ...base, decision: "maybe" })).toThrow();
    expect(() => validateDecisionShape({ ...base, riskScore: 101 })).toThrow();
    expect(() => validateDecisionShape({ ...base, confidence: 1.5 })).toThrow();
    expect(() => validateDecisionShape({ ...base, reason: "not-an-array" })).toThrow();
  });
});
