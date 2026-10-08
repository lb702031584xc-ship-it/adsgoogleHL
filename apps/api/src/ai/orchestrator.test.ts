/**
 * Phase 5 — orchestrator end-to-end tests.
 * In-memory fake Prisma; fake LLM for the Phase 1 pipeline; research is
 * either injected or exercised through its NO_DATA degradation path.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import {
  assertAiSettingsPepperConfigured,
  encryptSecret,
} from "./crypto.js";
import type { ChatJsonArgs } from "./llm.js";
import {
  buildCampaignPlan,
  runFullStrategy,
  type ResearchAnalystResult,
  type StrategyDeps,
} from "./orchestrator.js";

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
      if ("gt" in v && !(rv > (v as any).gt)) return false;
      if ("lt" in v && !(rv < (v as any).lt)) return false;
      if ("lte" in v && !(rv <= (v as any).lte)) return false;
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

function makeFakeChatJson(terms: unknown = GO_TERMS) {
  return async (args: ChatJsonArgs) => {
    if (args.user.includes("Offer terms text")) return terms;
    return ANALYSIS_SHAPE;
  };
}

function makeFakePrisma() {
  const aiSettings: Row[] = [];
  return {
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
    cloakingFinding: mkStore([]),
    _aiSettings: aiSettings,
  };
}
type FakePrisma = ReturnType<typeof makeFakePrisma>;

function seedAiSettings(fake: FakePrisma) {
  const pepper = assertAiSettingsPepperConfigured();
  fake._aiSettings.push(
    { key: "llm.baseUrl", value: "https://fake-llm.example/v1" },
    { key: "llm.model", value: "fake-model" },
    { key: "llm.apiKeyEnc", value: encryptSecret("fake-key", pepper) }
  );
}

const TENANT = "11111111-1111-4111-8111-111111111111";
const OFFER = "22222222-2222-4222-8222-222222222222";
const MERCHANT = "33333333-3333-4333-8333-333333333333";

async function seedBase(fake: FakePrisma) {
  seedAiSettings(fake);
  await (fake as any).offer.create({
    data: {
      id: OFFER,
      tenantId: TENANT,
      name: "Acme Shoes Offer",
      network: "Impact",
      destinationUrl: "https://acme.example/offer",
      merchantId: MERCHANT,
      category: "shoes",
      commissionValue: 80,
    },
  });
  await (fake as any).merchant.create({
    data: {
      id: MERCHANT,
      tenantId: TENANT,
      name: "AcmeBrand",
      domain: "acme.example",
    },
  });
  await (fake as any).offerPolicy.create({
    data: {
      id: randomUUID(),
      tenantId: TENANT,
      offerId: OFFER,
      rawTerms:
        "These are the stored offer terms for the Acme shoes affiliate program. " +
        "Paid search is allowed. Brand bidding is forbidden. Direct linking is allowed. " +
        "Payout is $80 per confirmed sale with a 30 day cookie window.",
    },
  });
  // Real observed traffic.
  const now = Date.now();
  for (let i = 0; i < 10; i++) {
    await (fake as any).click.create({
      data: {
        id: randomUUID(),
        tenantId: TENANT,
        trackingLinkId: randomUUID(),
        offerId: OFFER,
        country: i < 6 ? "US" : "GB",
        deviceType: i < 7 ? "mobile" : "desktop",
        utmTerm: i < 4 ? "acmebrand shoes" : "cheap running shoes",
        occurredAt: new Date(now - i * 3600_000),
      },
    });
  }
  await (fake as any).experiment.create({
    data: {
      id: randomUUID(),
      tenantId: TENANT,
      offerId: OFFER,
      name: "LP vs direct",
      status: "RUNNING",
      winner: null,
    },
  });
  await (fake as any).killSwitchConfig.create({
    data: {
      id: randomUUID(),
      tenantId: TENANT,
      offerId: OFFER,
      enabled: true,
      maxSpend: 500,
      minExpectedProfit: 100,
      minCvr: 1.5,
      maxPolicyRisk: 70,
    },
  });
}

function deps(fake: FakePrisma, extra?: Partial<StrategyDeps>): StrategyDeps {
  return {
    prisma: fake as unknown as PrismaClient,
    chatJsonImpl: makeFakeChatJson() as any,
    ...extra,
  } as StrategyDeps;
}

describe("runFullStrategy", () => {
  it("orchestrates all phases and returns a complete StrategyOutput", async () => {
    const fake = makeFakePrisma();
    await seedBase(fake);
    const out = await runFullStrategy(deps(fake), TENANT, OFFER, {
      userId: "user-1",
    });

    expect(out.offerId).toBe(OFFER);
    expect(out.offerName).toBe("Acme Shoes Offer");
    // Phase 1: pipeline decision (frozen contract shape).
    expect(["RUN", "TEST", "MANUAL_REVIEW", "DO_NOT_RUN"]).toContain(
      out.decision.decision
    );
    expect(out.decision.trafficMode).toBe("LANDING_PAGE");
    expect(typeof out.decision.confidence).toBe("number");
    expect(Array.isArray(out.decision.reason)).toBe(true);
    // Phase 2: real observed traffic.
    expect(out.traffic.clicks).toBe(10);
    expect(out.traffic.dataQuality).toBe("OBSERVED");
    expect(out.traffic.topGeo[0]).toEqual({ value: "US", count: 6 });
    expect(out.traffic.topDevice[0]).toEqual({ value: "mobile", count: 7 });
    // Phase 3.
    expect(out.experiments).toHaveLength(1);
    expect(out.experiments[0].status).toBe("RUNNING");
    expect(out.killSwitch.config?.enabled).toBe(true);
    // Phase 4: default stub degrades to NO_DATA (never throws).
    expect(out.research.status).toBe("NO_DATA");
    expect(out.research.score).toBeNull();
    expect(typeof out.research.summary).toBe("string");
    // Phase 5: campaign plan + scale advice.
    expect(out.campaignPlan.offerId).toBe(OFFER);
    expect(out.campaignPlan.trafficMode).toBe("LANDING_PAGE");
    expect(out.campaignPlan.campaigns).toHaveLength(1);
    const kws = out.campaignPlan.campaigns[0].adGroups.flatMap((g) => g.keywords);
    expect(kws.length).toBeGreaterThan(0);
    for (const k of kws) {
      expect(["EXACT", "PHRASE"]).toContain(k.matchType);
    }
    // Observed utm terms appear as OBSERVED keywords.
    expect(
      kws.some((k) => k.text === "cheap running shoes" && k.dataQuality === "OBSERVED")
    ).toBe(true);
    expect(out.campaignPlan.budget).toBeDefined();
    expect(out.scaleRecommendation).not.toBeNull();
    expect(typeof out.generatedAt).toBe("string");
  });

  it("uses the injected researchAnalystImpl when it returns OK", async () => {
    const fake = makeFakePrisma();
    await seedBase(fake);
    const research: ResearchAnalystResult = {
      status: "OK",
      score: 72,
      band: "medium",
      classification: "promising",
      summary: "Merchant shows steady growth.",
      findingId: "f-1",
    };
    const out = await runFullStrategy(
      deps(fake, { researchAnalystImpl: async () => research }),
      TENANT,
      OFFER
    );
    expect(out.research).toEqual(research);
  });

  it("flows through the real pipeline researchAnalyst via runWithResearchContext", async () => {
    const fake = makeFakePrisma();
    await seedBase(fake);
    await (fake as any).cloakingFinding.create({
      data: {
        id: randomUUID(),
        tenantId: TENANT,
        offerId: OFFER,
        differentialScore: 72,
        band: "MINOR",
        classification: "suspicious-cloaking",
        aiSummary: "检测到轻微差异。",
      },
    });
    // No injected impl: the default path calls pipeline.ts's researchAnalyst
    // inside runWithResearchContext, so real findings surface as OK.
    const out = await runFullStrategy(deps(fake), TENANT, OFFER);
    expect(out.research.status).toBe("OK");
    expect(out.research.score).toBe(72);
    expect(out.research.band).toBe("MINOR");
    expect(out.research.summary).toBe("检测到轻微差异。");
  });

  it("degrades research to NO_DATA when the impl throws or misbehaves", async () => {
    const fake = makeFakePrisma();
    await seedBase(fake);
    const throwing = await runFullStrategy(
      deps(fake, {
        researchAnalystImpl: async () => {
          throw new Error("boom");
        },
      }),
      TENANT,
      OFFER
    );
    expect(throwing.research.status).toBe("NO_DATA");
    expect(throwing.research.summary).toContain("degraded");

    const malformed = await runFullStrategy(
      deps(fake, {
        researchAnalystImpl: async () => ({ status: "BOGUS" }) as any,
      }),
      TENANT,
      OFFER
    );
    expect(malformed.research.status).toBe("NO_DATA");
  });

  it("throws NO_POLICY_DATA when no stored terms exist", async () => {
    const fake = makeFakePrisma();
    seedAiSettings(fake);
    await (fake as any).offer.create({
      data: {
        id: OFFER,
        tenantId: TENANT,
        name: "No Terms Offer",
        network: "X",
        destinationUrl: "https://x.example",
        commissionValue: 10,
      },
    });
    await expect(runFullStrategy(deps(fake), TENANT, OFFER)).rejects.toMatchObject({
      code: "NO_POLICY_DATA",
    });
  });
});

describe("buildCampaignPlan", () => {
  it("prices every keyword at ProfitModel.recommendedMaxCpc and reuses brand-check negatives", async () => {
    const fake = makeFakePrisma();
    await seedBase(fake);
    await (fake as any).profitModel.create({
      data: {
        id: randomUUID(),
        tenantId: TENANT,
        offerId: OFFER,
        currency: "USD",
        scenarios: {
          worst: { cvr: 1, cpc: 0.4, clicks: 100, profit: -20 },
          base: { cvr: 2, cpc: 0.5, clicks: 100, profit: 60 },
          best: { cvr: 3, cpc: 0.6, clicks: 100, profit: 140 },
        },
        breakEvenCpc: 0.6,
        recommendedMaxCpc: 0.42,
        dataQuality: "OBSERVED",
      },
    });

    const plan = await buildCampaignPlan(
      { prisma: fake as unknown as PrismaClient },
      TENANT,
      OFFER
    );
    const kws = plan.campaigns[0].adGroups.flatMap((g) => g.keywords);
    expect(kws.length).toBeGreaterThan(0);
    for (const k of kws) {
      expect(k.suggestedBid).toBe(0.42);
    }
    // "acmebrand shoes" (observed) contains the brand term "acmebrand" →
    // brand-check conflict logic turns it into a negative.
    expect(plan.negatives.exact).toContain("[acmebrand shoes]");
    expect(plan.negatives.phrase).toContain('"acmebrand shoes"');
    // Budget reuses budget.ts logic: 100 test clicks at base CPC 0.5.
    expect(plan.budget.totalTestBudget).toBe(50);
    expect(plan.budget.dailyBudget).toBeCloseTo(50 / 7, 2);
    expect(plan.budget.dataQuality).toBe("OBSERVED");
    expect(plan.trafficMode).toBe("UNKNOWN");
    expect(plan.dataQuality).toBe("OBSERVED");
  });

  it("marks the plan UNKNOWN-grade when no profit model exists", async () => {
    const fake = makeFakePrisma();
    await seedBase(fake);
    const plan = await buildCampaignPlan(
      { prisma: fake as unknown as PrismaClient },
      TENANT,
      OFFER,
      {
        decision: "RUN",
        riskScore: 20,
        profitScore: 80,
        policyScore: 90,
        breakEvenCpc: null,
        recommendedMaxCpc: null,
        trafficMode: "DIRECT_LINK",
        directLink: true,
        confidence: 0.8,
        reason: [],
        manualChecks: [],
        dataQuality: "UNKNOWN",
      }
    );
    const kws = plan.campaigns[0].adGroups.flatMap((g) => g.keywords);
    for (const k of kws) {
      expect(k.suggestedBid).toBeNull();
    }
    expect(plan.trafficMode).toBe("DIRECT_LINK");
    expect(plan.budget.totalTestBudget).toBeNull();
    expect(plan.notes.some((n) => n.includes("No profit model"))).toBe(true);
  });
});
