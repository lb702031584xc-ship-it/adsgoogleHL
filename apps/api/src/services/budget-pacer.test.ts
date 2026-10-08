/**
 * Automation pack 4/5 — budget pacer tests.
 *
 * In-memory fake Prisma. Covers: up/down/hold decisions, max/min budget
 * boundaries, input validation failures, the evaluateRules pipeline
 * (SyncJob + audit snapshot + 24h-deduped alert on adjust), and the
 * honest "no spend data" hold when the spend source is unavailable.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it } from "vitest";
import { ValidationError } from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import {
  BUDGET_PACER_TASK_TYPE,
  createRule,
  decideBudgetAction,
  evaluateRules,
  getRuleHistory,
  updateRule,
  validateBudgetRuleInput,
  type BudgetRuleRow,
  type CampaignPerformance,
} from "./budget-pacer-service.js";

type Row = Record<string, any>;

interface Ctx {
  budgetRules: Row[];
  googleAccounts: Row[];
  campaigns: Row[];
  clicks: Row[];
  conversions: Row[];
  syncJobs: Row[];
  auditLogs: Row[];
  alerts: Row[];
}

function baseCtx(): Ctx {
  return {
    budgetRules: [],
    googleAccounts: [],
    campaigns: [],
    clicks: [],
    conversions: [],
    syncJobs: [],
    auditLogs: [],
    alerts: [],
  };
}

function makeFake(ctx: Ctx) {
  return {
    budgetRule: {
      create: async (args: any) => {
        const row = { ...args.data, lastEvaluatedAt: null };
        ctx.budgetRules.push(row);
        return row;
      },
      findFirst: async (args: any) =>
        ctx.budgetRules.find(
          (r) =>
            (!args.where.id || r.id === args.where.id) &&
            (!args.where.tenantId || r.tenantId === args.where.tenantId)
        ) ?? null,
      findMany: async (args: any) =>
        ctx.budgetRules.filter(
          (r) =>
            (args.where.enabled === undefined ||
              r.enabled === args.where.enabled) &&
            (!args.where.tenantId || r.tenantId === args.where.tenantId)
        ),
      update: async (args: any) => {
        const row = ctx.budgetRules.find((r) => r.id === args.where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, args.data);
        return row;
      },
    },
    googleAccount: {
      findFirst: async (args: any) =>
        ctx.googleAccounts.find((a) => a.id === args.where.id) ?? null,
    },
    campaign: {
      findFirst: async () => null,
      findMany: async () => [],
    },
    click: { count: async () => 0 },
    conversion: {
      aggregate: async () => ({ _sum: { value: null }, _count: 0 }),
    },
    syncJob: {
      findUnique: async (args: any) =>
        ctx.syncJobs.find(
          (j) =>
            j.tenantId === args.where.tenantId_idempotencyScope_idempotencyKey.tenantId &&
            j.idempotencyScope ===
              args.where.tenantId_idempotencyScope_idempotencyKey.idempotencyScope &&
            j.idempotencyKey ===
              args.where.tenantId_idempotencyScope_idempotencyKey.idempotencyKey
        ) ?? null,
      create: async (args: any) => {
        const row = { ...args.data };
        ctx.syncJobs.push(row);
        return row;
      },
    },
    auditLog: {
      create: async (args: any) => {
        const row = { ...args.data };
        ctx.auditLogs.push(row);
        return row;
      },
      findFirst: async () => null,
    },
    alert: {
      findMany: async () => [],
      create: async (args: any) => {
        const row = { ...args.data };
        ctx.alerts.push(row);
        return row;
      },
    },
  };
}

const TENANT = "11111111-1111-4111-8111-111111111111";
const ACCOUNT = "22222222-2222-4222-8222-222222222222";

function validInput() {
  return {
    googleAccountId: ACCOUNT,
    campaignName: "Cashback US",
    targetRoas: 3,
    minDailyBudget: 10,
    maxDailyBudget: 100,
  };
}

function ruleRow(over: Partial<BudgetRuleRow> = {}): BudgetRuleRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    tenantId: TENANT,
    googleAccountId: ACCOUNT,
    campaignName: "Cashback US",
    campaignId: null,
    targetRoas: 3,
    minDailyBudget: 10,
    maxDailyBudget: 100,
    increasePct: 20,
    decreasePct: 20,
    checkIntervalDays: 7,
    enabled: true,
    lastEvaluatedAt: null,
    lastAction: null,
    ...over,
  };
}

function perf(over: Partial<CampaignPerformance> = {}): CampaignPerformance {
  return {
    spend: 100,
    spendSource: "unavailable",
    revenue: 400,
    clicks: 500,
    conversions: 20,
    roas: 4,
    days: 7,
    matchedCampaigns: 1,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Pure decision
// ---------------------------------------------------------------------------

describe("decideBudgetAction", () => {
  const base = {
    targetRoas: 3,
    currentBudget: 50,
    minDailyBudget: 10,
    maxDailyBudget: 100,
    increasePct: 20,
    decreasePct: 20,
  };

  it("goes up when roas >= target and budget < max", () => {
    const d = decideBudgetAction({ ...base, roas: 4 });
    expect(d.action).toBe("up");
    expect(d.oldBudget).toBe(50);
    expect(d.newBudget).toBe(60); // 50 * 1.2
  });

  it("clamps up to maxDailyBudget", () => {
    const d = decideBudgetAction({ ...base, roas: 5, currentBudget: 95 });
    expect(d.action).toBe("up");
    expect(d.newBudget).toBe(100);
  });

  it("holds when roas >= target but budget already at max (boundary)", () => {
    const d = decideBudgetAction({ ...base, roas: 9, currentBudget: 100 });
    expect(d.action).toBe("hold");
    expect(d.reason).toContain("maxDailyBudget");
  });

  it("goes down when roas < 70% of target and budget > min", () => {
    const d = decideBudgetAction({ ...base, roas: 2 }); // 2 < 3*0.7=2.1
    expect(d.action).toBe("down");
    expect(d.newBudget).toBe(40); // 50 * 0.8
  });

  it("clamps down to minDailyBudget", () => {
    const d = decideBudgetAction({ ...base, roas: 1, currentBudget: 11 });
    expect(d.action).toBe("down");
    expect(d.newBudget).toBe(10);
  });

  it("holds when roas < 70% of target but budget already at min (boundary)", () => {
    const d = decideBudgetAction({ ...base, roas: 0.5, currentBudget: 10 });
    expect(d.action).toBe("hold");
    expect(d.reason).toContain("minDailyBudget");
  });

  it("holds inside the band (roas between 0.7x and 1x target)", () => {
    const d = decideBudgetAction({ ...base, roas: 2.5 });
    expect(d.action).toBe("hold");
    expect(d.reason).toContain("hold band");
  });

  it("holds when roas is null (no spend data)", () => {
    const d = decideBudgetAction({ ...base, roas: null });
    expect(d.action).toBe("hold");
    expect(d.reason).toBe("no spend data");
  });

  it("holds when current budget is unknown", () => {
    const d = decideBudgetAction({ ...base, roas: 4, currentBudget: null });
    expect(d.action).toBe("hold");
    expect(d.reason).toContain("no current budget");
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("validateBudgetRuleInput", () => {
  it("applies defaults (enabled=false, pct=20, interval=7)", () => {
    const v = validateBudgetRuleInput(validInput());
    expect(v.enabled).toBe(false);
    expect(v.increasePct).toBe(20);
    expect(v.decreasePct).toBe(20);
    expect(v.checkIntervalDays).toBe(7);
  });

  it("rejects minDailyBudget >= maxDailyBudget", () => {
    expect(() =>
      validateBudgetRuleInput({
        ...validInput(),
        minDailyBudget: 100,
        maxDailyBudget: 100,
      })
    ).toThrow(ValidationError);
    expect(() =>
      validateBudgetRuleInput({
        ...validInput(),
        minDailyBudget: 200,
        maxDailyBudget: 100,
      })
    ).toThrow(ValidationError);
  });

  it("rejects targetRoas <= 0", () => {
    expect(() =>
      validateBudgetRuleInput({ ...validInput(), targetRoas: 0 })
    ).toThrow(ValidationError);
  });

  it("rejects pct outside 1..100", () => {
    expect(() =>
      validateBudgetRuleInput({ ...validInput(), increasePct: 0 })
    ).toThrow(ValidationError);
    expect(() =>
      validateBudgetRuleInput({ ...validInput(), decreasePct: 101 })
    ).toThrow(ValidationError);
  });

  it("rejects initialBudget outside [min, max]", () => {
    expect(() =>
      validateBudgetRuleInput({ ...validInput(), initialBudget: 500 })
    ).toThrow(ValidationError);
  });

  it("requires campaignName", () => {
    expect(() =>
      validateBudgetRuleInput({ ...validInput(), campaignName: "  " })
    ).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

describe("createRule / updateRule / getRuleHistory", () => {
  it("creates a disabled rule and seeds initialBudget into lastAction", async () => {
    const ctx = baseCtx();
    ctx.googleAccounts.push({ id: ACCOUNT, tenantId: TENANT });
    const fake = makeFake(ctx);
    const created = await createRule(
      fake as unknown as PrismaClient,
      TENANT,
      { ...validInput(), initialBudget: 50 },
      "test"
    );
    expect(created.enabled).toBe(false);
    expect(created.lastAction).toMatchObject({
      action: "init",
      newBudget: 50,
    });
  });

  it("updateRule validates merged min/max", async () => {
    const ctx = baseCtx();
    ctx.budgetRules.push(ruleRow({ enabled: false }) as any);
    const fake = makeFake(ctx);
    await expect(
      updateRule(fake as unknown as PrismaClient, TENANT, ruleRow().id, {
        minDailyBudget: 1000,
      })
    ).rejects.toThrow(ValidationError);
  });

  it("updateRule enables a rule", async () => {
    const ctx = baseCtx();
    ctx.budgetRules.push(ruleRow({ enabled: false }) as any);
    const fake = makeFake(ctx);
    const updated = await updateRule(
      fake as unknown as PrismaClient,
      TENANT,
      ruleRow().id,
      { enabled: true }
    );
    expect(updated.enabled).toBe(true);
  });

  it("getRuleHistory returns the single lastAction entry", async () => {
    const ctx = baseCtx();
    ctx.budgetRules.push(
      ruleRow({
        lastAction: { action: "up", reason: "r", at: "t", newBudget: 60 },
      }) as any
    );
    const fake = makeFake(ctx);
    const h = await getRuleHistory(
      fake as unknown as PrismaClient,
      TENANT,
      ruleRow().id
    );
    expect(h.history).toHaveLength(1);
    expect(h.history[0].action).toBe("up");
  });
});

// ---------------------------------------------------------------------------
// Evaluation pipeline
// ---------------------------------------------------------------------------

describe("evaluateRules", () => {
  it("queues a SyncJob + audit + alert on up, and updates lastAction", async () => {
    const ctx = baseCtx();
    ctx.budgetRules.push(
      ruleRow({
        lastAction: { action: "init", reason: "r", at: "t", newBudget: 50 },
      }) as any
    );
    const fake = makeFake(ctx);
    const summary = await evaluateRules(
      fake as unknown as PrismaClient,
      TENANT,
      { performanceProvider: async () => perf({ spend: 100, revenue: 400 }) }
    );
    expect(summary.checked).toBe(1);
    expect(summary.adjusted).toBe(1);
    expect(summary.alertsCreated).toBe(1);
    expect(ctx.syncJobs).toHaveLength(1);
    expect(ctx.syncJobs[0].type).toBe(BUDGET_PACER_TASK_TYPE);
    expect(ctx.syncJobs[0].status).toBe("PENDING");
    expect(ctx.syncJobs[0].provider).toBe("google-ads-script");
    expect(ctx.auditLogs).toHaveLength(1);
    expect(ctx.auditLogs[0].action).toBe("BUDGET_PACER_QUEUED");
    const payload = ctx.auditLogs[0].after;
    expect(payload.type).toBe(BUDGET_PACER_TASK_TYPE);
    expect(payload.oldBudget).toBe(50);
    expect(payload.newBudget).toBe(60);
    expect(ctx.alerts).toHaveLength(1);
    expect(ctx.alerts[0].metric).toBe("budget_pacer");
    const rule = ctx.budgetRules[0];
    expect(rule.lastEvaluatedAt).toBeInstanceOf(Date);
    expect(rule.lastAction.action).toBe("up");
    expect(rule.lastAction.newBudget).toBe(60);
    expect(rule.lastAction.taskId).toBe(ctx.syncJobs[0].id);
  });

  it("dedupes the alert when one is already open within 24h", async () => {
    const ctx = baseCtx();
    const ruleId = ruleRow().id;
    ctx.budgetRules.push(
      ruleRow({ lastAction: { action: "init", reason: "r", at: "t", newBudget: 50 } }) as any
    );
    ctx.alerts.push({
      id: "a1",
      tenantId: TENANT,
      metric: "budget_pacer",
      status: "open",
      createdAt: new Date(),
      data: { ruleId },
    });
    const fake = makeFake(ctx);
    // alert.findMany must return the pre-seeded open alert
    (fake.alert.findMany as any) = async () =>
      ctx.alerts.filter((a) => a.status === "open");
    const summary = await evaluateRules(
      fake as unknown as PrismaClient,
      TENANT,
      { performanceProvider: async () => perf({ spend: 100, revenue: 400 }) }
    );
    expect(summary.adjusted).toBe(1);
    expect(summary.alertsCreated).toBe(0);
    expect(ctx.alerts).toHaveLength(1); // no new alert
  });

  it("holds with 'no spend data' when spend is 0 (never fabricates)", async () => {
    const ctx = baseCtx();
    ctx.budgetRules.push(ruleRow() as any);
    const fake = makeFake(ctx);
    const summary = await evaluateRules(
      fake as unknown as PrismaClient,
      TENANT,
      {
        performanceProvider: async () =>
          perf({ spend: 0, revenue: 120, roas: null, matchedCampaigns: 1 }),
      }
    );
    expect(summary.checked).toBe(1);
    expect(summary.held).toBe(1);
    expect(summary.adjusted).toBe(0);
    expect(ctx.syncJobs).toHaveLength(0);
    expect(ctx.budgetRules[0].lastAction.reason).toContain("no spend data");
  });

  it("skips rules that are disabled or not yet due", async () => {
    const ctx = baseCtx();
    ctx.budgetRules.push(ruleRow({ enabled: false }) as any);
    ctx.budgetRules.push(
      ruleRow({
        id: "44444444-4444-4444-8444-444444444444",
        lastEvaluatedAt: new Date(),
        lastAction: { action: "init", reason: "r", at: "t", newBudget: 50 },
      }) as any
    );
    const fake = makeFake(ctx);
    const summary = await evaluateRules(
      fake as unknown as PrismaClient,
      TENANT,
      { performanceProvider: async () => perf() }
    );
    expect(summary.checked).toBe(0);
  });

  it("evaluates a due rule again after checkIntervalDays elapsed", async () => {
    const ctx = baseCtx();
    ctx.budgetRules.push(
      ruleRow({
        lastEvaluatedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000),
        lastAction: { action: "init", reason: "r", at: "t", newBudget: 50 },
      }) as any
    );
    const fake = makeFake(ctx);
    const summary = await evaluateRules(
      fake as unknown as PrismaClient,
      TENANT,
      { performanceProvider: async () => perf({ spend: 100, revenue: 400 }) }
    );
    expect(summary.checked).toBe(1);
    expect(summary.adjusted).toBe(1);
  });
});
