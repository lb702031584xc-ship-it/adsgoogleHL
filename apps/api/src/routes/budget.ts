import type { FastifyInstance, FastifyRequest } from "fastify";
import { NotFoundError, UnauthorizedError } from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import { getOfferPerformance } from "../stats/offer-performance.js";
import { computeBreakEvenCpc } from "../ai/pipeline.js";

/**
 * Phase 3 — Budget Recommendation API (one tenant per user; session auth only).
 *
 * GET /api/v1/offers/:id/budget-recommendation recommends a test budget for
 * an offer from its Phase 1 ProfitModel three-scenario table (worst/base/best).
 * When the offer has no profit model, it falls back to the P1
 * /api/v1/stats/offer-performance real EPC/CVR logic (imported, not copied):
 * observed traffic -> OBSERVED, otherwise conservative defaults -> PREDICTED.
 *
 * Budget logic: totalTestBudget = cost of ~100 clicks at the base scenario
 * CPC (100 x baseCpc); dailyBudget = totalTestBudget / 7.
 * Requires Prisma persistence; registered only when services.prisma exists.
 * NOTE: wire registerBudgetRoutes in routes/index.ts (coordinator owns it).
 */

export interface BudgetRouteDeps {
  prisma: PrismaClient;
}

export type BudgetDataQuality = "OBSERVED" | "PREDICTED" | "UNKNOWN";

export interface BudgetScenarioRow {
  cvr: number | null;
  cpc: number | null;
  clicks: number | null;
  profit: number | null;
}

export interface BudgetRecommendation {
  dailyBudget: number | null;
  totalTestBudget: number | null;
  budgetByScenario: {
    worst: number | null;
    base: number | null;
    best: number | null;
  };
  breakEvenCpc: number | null;
  recommendedMaxCpc: number | null;
  dataQuality: BudgetDataQuality;
  reason: string[];
  currency: string | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Clicks bought per scenario when sizing the test budget. */
const TEST_CLICKS = 100;
/** Test budget is spread over this many days for the daily figure. */
const TEST_DAYS = 7;
/** Min observed clicks for the fallback path to count as OBSERVED. */
const MIN_OBSERVED_CLICKS = 100;
/** Conservative defaults when no observed data exists (mirror buildScenarios). */
const DEFAULT_CVR_PCT = 2;
const DEFAULT_CPC = 0.8;
/** Safety margin applied to break-even CPC (mirror profitAnalyst). */
const CPC_SAFETY_MARGIN = 0.7;

async function requireSession(
  deps: BudgetRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) {
    throw new UnauthorizedError("Authentication required");
  }
  return info;
}

function normalizeDataQuality(v: unknown): BudgetDataQuality {
  return v === "OBSERVED" || v === "PREDICTED" || v === "UNKNOWN"
    ? v
    : "UNKNOWN";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function asScenarioRow(v: unknown): BudgetScenarioRow | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const num = (x: unknown): number | null =>
    typeof x === "number" && Number.isFinite(x) ? x : null;
  return {
    cvr: num(o.cvr),
    cpc: num(o.cpc),
    clicks: num(o.clicks),
    profit: num(o.profit),
  };
}

export interface BudgetBuildInput {
  scenarios: {
    worst: BudgetScenarioRow;
    base: BudgetScenarioRow;
    best: BudgetScenarioRow;
  };
  breakEvenCpc: number | null;
  recommendedMaxCpc: number | null;
  dataQuality: BudgetDataQuality;
  currency: string | null;
  reason: string[];
}

/**
 * Pure budget math: per-scenario test budgets from scenario CPCs.
 * Exported for unit tests.
 */
export function buildBudgetRecommendation(
  input: BudgetBuildInput
): BudgetRecommendation {
  const budgetFor = (row: BudgetScenarioRow): number | null =>
    row.cpc == null ? null : round2(row.cpc * TEST_CLICKS);
  const totalTestBudget = budgetFor(input.scenarios.base);
  return {
    dailyBudget: totalTestBudget == null ? null : round2(totalTestBudget / TEST_DAYS),
    totalTestBudget,
    budgetByScenario: {
      worst: budgetFor(input.scenarios.worst),
      base: totalTestBudget,
      best: budgetFor(input.scenarios.best),
    },
    breakEvenCpc: input.breakEvenCpc,
    recommendedMaxCpc: input.recommendedMaxCpc,
    dataQuality: input.dataQuality,
    reason: input.reason,
    currency: input.currency,
  };
}

function maxCpcFromBreakEven(breakEvenCpc: number | null): number | null {
  return breakEvenCpc == null
    ? null
    : round4(breakEvenCpc * CPC_SAFETY_MARGIN);
}

export async function registerBudgetRoutes(
  app: FastifyInstance,
  deps: BudgetRouteDeps
): Promise<void> {
  const { prisma } = deps;

  /** Budget recommendation for one offer (tenant-scoped). */
  app.get("/api/v1/offers/:id/budget-recommendation", async (request) => {
    const info = await requireSession(deps, request);
    const { id } = request.params as { id: string };
    if (!UUID_RE.test(id)) throw new NotFoundError("Offer", id);

    const offer = (await prisma.offer.findFirst({
      where: { id, tenantId: info.tenantId, deletedAt: null },
    })) as {
      id: string;
      commissionValue: unknown;
    } | null;
    if (!offer) throw new NotFoundError("Offer", id);

    const commission =
      offer.commissionValue != null ? Number(offer.commissionValue) : null;

    const model = (await prisma.profitModel.findFirst({
      where: { offerId: id, tenantId: info.tenantId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    })) as {
      scenarios: unknown;
      breakEvenCpc: number | null;
      recommendedMaxCpc: number | null;
      dataQuality: unknown;
      expectedCvr: number | null;
      approvalRate: number | null;
      attributionRate: number | null;
      currency: string | null;
      commission: unknown;
    } | null;

    // Path 1: Phase 1 profit model with a usable scenario table.
    if (model) {
      const s = (model.scenarios ?? {}) as Record<string, unknown>;
      const worst = asScenarioRow(s.worst);
      const base = asScenarioRow(s.base);
      const best = asScenarioRow(s.best);
      if (worst && base && best && base.cpc != null) {
        const quality = normalizeDataQuality(model.dataQuality);
        const breakEvenCpc =
          model.breakEvenCpc ??
          computeBreakEvenCpc(
            commission ?? (model.commission != null ? Number(model.commission) : null),
            model.expectedCvr,
            model.approvalRate ?? 0.9,
            model.attributionRate ?? 0.95
          );
        const total = round2(base.cpc * TEST_CLICKS);
        return buildBudgetRecommendation({
          scenarios: { worst, base, best },
          breakEvenCpc,
          recommendedMaxCpc: model.recommendedMaxCpc ?? maxCpcFromBreakEven(breakEvenCpc),
          dataQuality: quality,
          currency: model.currency ?? null,
          reason: [
            `基于利润模型三场景测算（数据质量：${quality}）。`,
            `base 场景 CPC $${round4(base.cpc)}：约 ${TEST_CLICKS} 次点击需要 $${total} 测试预算（≈ $${round2(total / TEST_DAYS)}/天 × ${TEST_DAYS} 天）。`,
          ],
        });
      }
    }

    // Path 2: fall back to P1 real EPC/CVR stats (imported, not duplicated).
    const perf = await getOfferPerformance(prisma, info.tenantId, id, 30);
    if (
      perf.clicks >= MIN_OBSERVED_CLICKS &&
      perf.cvrPct != null &&
      perf.cvrPct > 0 &&
      perf.epc > 0
    ) {
      // Break-even CPC ≈ EPC (earnings per click from real traffic).
      const baseCpc = perf.epc;
      const baseCvr = perf.cvrPct;
      const shift = (
        cvrShift: number,
        cpcShift: number
      ): BudgetScenarioRow => ({
        cvr: round2(baseCvr * cvrShift),
        cpc: round4(baseCpc * cpcShift),
        clicks: TEST_CLICKS,
        profit: null,
      });
      const scenarios = {
        worst: shift(0.5, 1.5),
        base: shift(1, 1),
        best: shift(1.5, 0.8),
      };
      const breakEvenCpc = round4(perf.epc);
      const total = round2(baseCpc * TEST_CLICKS);
      return buildBudgetRecommendation({
        scenarios,
        breakEvenCpc,
        recommendedMaxCpc: maxCpcFromBreakEven(breakEvenCpc),
        dataQuality: "OBSERVED",
        currency: perf.revenueCurrency,
        reason: [
          `基于近 30 天真实投放数据：${perf.clicks} 点击 / ${perf.conversions} 转化，CVR ${perf.cvrPct}%，EPC $${perf.epc}。`,
          `以 EPC 作为盈亏平衡 CPC 估算：约 ${TEST_CLICKS} 次点击需要 $${total} 测试预算（≈ $${round2(total / TEST_DAYS)}/天 × ${TEST_DAYS} 天）。`,
        ],
      });
    }

    // Path 3: no usable data — conservative defaults, marked PREDICTED.
    const breakEvenCpc = computeBreakEvenCpc(
      commission,
      DEFAULT_CVR_PCT,
      0.9,
      0.95
    );
    const shift = (cvrShift: number, cpcShift: number): BudgetScenarioRow => ({
      cvr: round2(DEFAULT_CVR_PCT * cvrShift),
      cpc: round4(DEFAULT_CPC * cpcShift),
      clicks: TEST_CLICKS,
      profit: null,
    });
    const scenarios = {
      worst: shift(0.5, 1.5),
      base: shift(1, 1),
      best: shift(1.5, 0.8),
    };
    const total = round2(DEFAULT_CPC * TEST_CLICKS);
    return buildBudgetRecommendation({
      scenarios,
      breakEvenCpc,
      recommendedMaxCpc: maxCpcFromBreakEven(breakEvenCpc),
      dataQuality: "PREDICTED",
      currency: null,
      reason: [
        `暂无利润模型，且近 30 天真实点击不足（${perf.clicks} < ${MIN_OBSERVED_CLICKS}），使用保守默认值（CVR ${DEFAULT_CVR_PCT}%，CPC $${DEFAULT_CPC}）估算。`,
        `建议先以小预算（≈ $${round2(total / TEST_DAYS)}/天）验证真实 CVR 后再放大。`,
      ],
    });
  });
}
