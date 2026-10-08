/**
 * Phase 5 — AI Decision Engine: full-chain strategy orchestrator.
 *
 * runFullStrategy(offerId, tenantId) calls the Phase 1-4 modules in order,
 * READ-ONLY with respect to their behavior: it never changes how any module
 * works, it only orchestrates them (Phase 1 pipeline, Phase 2 traffic stats,
 * Phase 3 experiments/kill-switch, Phase 4 research) and synthesizes the
 * StrategyOutput consumed by the /ai/strategy page.
 *
 * Campaign plans produced here are DOCUMENTS, not created ad objects:
 *   TODO: wire to real Google Ads API when developer token available —
 *   never mock a fake successful creation.
 */
import type { PrismaClient } from "@adlinklab/database";
import { AppError, NotFoundError } from "@adlinklab/shared";
import {
  researchAnalyst as pipelineResearchAnalyst,
  runOfferPipeline,
  runWithResearchContext,
  validateDecisionShape,
  type DataQuality,
  type DecisionJson,
  type PipelineDeps,
  type TrafficMode,
} from "./pipeline.js";
import { getOfferPerformance } from "../stats/offer-performance.js";
import {
  buildBudgetRecommendation,
  type BudgetBuildInput,
  type BudgetRecommendation,
} from "../routes/budget.js";
import {
  buildNegativeKeywords,
  checkBrandConflicts,
} from "./brand-check.js";

/** Exact Phase 4 contract — implemented by another worker; we only adapt. */
export interface ResearchAnalystResult {
  status: "OK" | "NO_DATA";
  score: number | null;
  band: string | null;
  classification: string | null;
  summary: string;
  findingId?: string;
}

export interface StrategyDeps extends PipelineDeps {
  /**
   * Injectable Phase 4 implementation (another worker owns pipeline.ts).
   * Defaults to calling pipeline.ts's researchAnalyst and degrading to
   * NO_DATA when the shape does not match the contract yet.
   */
  researchAnalystImpl?: (offerId: string) => Promise<ResearchAnalystResult>;
}

export interface StrategyTrafficSummary {
  clicks: number;
  conversions: number;
  cvrPct: number | null;
  epc: number;
  windowDays: number;
  topGeo: Array<{ value: string; count: number }>;
  topDevice: Array<{ value: string; count: number }>;
  dataQuality: DataQuality;
}

export interface StrategyExperiment {
  id: string;
  name: string;
  status: string;
  winner: string | null;
}

export interface StrategyKillSwitch {
  config: {
    enabled: boolean;
    maxSpend: number | null;
    minExpectedProfit: number | null;
    minCvr: number | null;
    maxPolicyRisk: number | null;
  } | null;
  recentEvents: Array<{
    id: string;
    triggeredBy: string;
    actionTaken: string;
    linksPaused: number;
    createdAt: string | null;
  }>;
}

export interface CampaignPlanKeyword {
  text: string;
  matchType: "EXACT" | "PHRASE";
  /** = ProfitModel.recommendedMaxCpc when available. */
  suggestedBid: number | null;
  dataQuality: DataQuality;
}

export interface CampaignPlanAdGroup {
  name: string;
  matchType: "EXACT" | "PHRASE";
  keywords: CampaignPlanKeyword[];
}

export interface CampaignPlanCampaign {
  name: string;
  trafficMode: string;
  adGroups: CampaignPlanAdGroup[];
}

export interface CampaignPlanNegatives {
  exact: string[];
  phrase: string[];
  dataQuality: DataQuality;
}

export interface CampaignPlan {
  offerId: string;
  offerName: string;
  /** LANDING_PAGE | DIRECT_LINK | UNKNOWN */
  trafficMode: string;
  campaigns: CampaignPlanCampaign[];
  negatives: CampaignPlanNegatives;
  budget: BudgetRecommendation;
  notes: string[];
  dataQuality: DataQuality;
  generatedAt: string;
}

export interface ScaleRecommendation {
  /** True only for profitable offers; still advisory — never auto-executes. */
  eligible: boolean;
  multiplier: number | null;
  currentDailyBudget: number | null;
  suggestedDailyBudget: number | null;
  reason: string[];
  dataQuality: DataQuality;
  note: string;
}

export interface StrategyOutput {
  offerId: string;
  offerName: string;
  decision: DecisionJson;
  research: ResearchAnalystResult;
  traffic: StrategyTrafficSummary;
  experiments: StrategyExperiment[];
  killSwitch: StrategyKillSwitch;
  campaignPlan: CampaignPlan;
  scaleRecommendation: ScaleRecommendation | null;
  generatedAt: string;
}

const TRAFFIC_WINDOW_DAYS = 30;
const TOP_N = 5;
const SCALE_MULTIPLIER = 1.5;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function researchFallback(summary: string): ResearchAnalystResult {
  return {
    status: "NO_DATA",
    score: null,
    band: null,
    classification: null,
    summary,
  };
}

/**
 * Validate the raw Phase 4 output against the exact contract. Anything that
 * does not match (including the current NOT_IMPLEMENTED stub) degrades to
 * NO_DATA — never throws.
 */
function parseResearchAnalystResult(raw: unknown): ResearchAnalystResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.status !== "OK" && o.status !== "NO_DATA") return null;
  const summary = str(o.summary);
  if (!summary) return null;
  const score = o.score === null ? null : num(o.score);
  const out: ResearchAnalystResult = {
    status: o.status,
    score,
    band: o.band === null ? null : str(o.band),
    classification: o.classification === null ? null : str(o.classification),
    summary,
  };
  const findingId = str(o.findingId);
  if (findingId) out.findingId = findingId;
  return out;
}

/**
 * Default Phase 4 call: pipeline.ts's researchAnalyst, shape-checked and
 * degradation-safe. The agent reads prisma/tenant from an AsyncLocalStorage
 * context installed by runWithResearchContext; without it the call throws
 * RESEARCH_NO_CONTEXT, which we catch and degrade to NO_DATA.
 */
async function defaultResearchAnalyst(
  deps: StrategyDeps,
  tenantId: string,
  offerId: string
): Promise<ResearchAnalystResult> {
  try {
    const raw = (await runWithResearchContext(
      deps.prisma,
      tenantId,
      () => pipelineResearchAnalyst(offerId)
    )) as unknown;
    return (
      parseResearchAnalystResult(raw) ??
      researchFallback("Phase 4 research is not available yet (NO_DATA).")
    );
  } catch {
    return researchFallback("Phase 4 research failed; degraded to NO_DATA.");
  }
}

async function researchStep(
  deps: StrategyDeps,
  tenantId: string,
  offerId: string
): Promise<ResearchAnalystResult> {
  if (deps.researchAnalystImpl) {
    try {
      const res = await deps.researchAnalystImpl(offerId);
      return (
        parseResearchAnalystResult(res) ??
        researchFallback("Phase 4 returned an invalid shape; degraded.")
      );
    } catch {
      return researchFallback("Phase 4 research failed; degraded to NO_DATA.");
    }
  }
  return defaultResearchAnalyst(deps, tenantId, offerId);
}

interface OfferRow {
  id: string;
  name: string;
  network: string;
  merchantId: string | null;
  category: string | null;
  commissionValue: unknown;
}

async function loadOfferOr404(
  prisma: PrismaClient,
  tenantId: string,
  offerId: string
): Promise<OfferRow> {
  const offer = (await prisma.offer.findFirst({
    where: { id: offerId, tenantId, deletedAt: null },
  })) as OfferRow | null;
  if (!offer) throw new NotFoundError("Offer", offerId);
  return offer;
}

async function latestProfitModel(
  prisma: PrismaClient,
  tenantId: string,
  offerId: string
): Promise<{
  scenarios: unknown;
  breakEvenCpc: number | null;
  recommendedMaxCpc: number | null;
  dataQuality: unknown;
  currency: string | null;
} | null> {
  return (await prisma.profitModel.findFirst({
    where: { offerId, tenantId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  })) as {
    scenarios: unknown;
    breakEvenCpc: number | null;
    recommendedMaxCpc: number | null;
    dataQuality: unknown;
    currency: string | null;
  } | null;
}

function normalizeDataQuality(v: unknown): DataQuality {
  return v === "OBSERVED" || v === "PREDICTED" || v === "UNKNOWN"
    ? v
    : "UNKNOWN";
}

/** Test-only export: exercised by test-click isolation tests. */
export async function trafficSummary(
  prisma: PrismaClient,
  tenantId: string,
  offerId: string
): Promise<StrategyTrafficSummary> {
  const perf = await getOfferPerformance(
    prisma,
    tenantId,
    offerId,
    TRAFFIC_WINDOW_DAYS
  );
  const since = new Date(
    Date.now() - TRAFFIC_WINDOW_DAYS * 24 * 3600 * 1000
  );
  const countBy = async (field: "country" | "deviceType") => {
    const groups = await prisma.click.groupBy({
      by: [field],
      where: {
        tenantId,
        offerId,
        occurredAt: { gte: since },
        [field]: { not: null },
        // Test clicks (link-chain verification) never count as real traffic.
        isTest: { not: true },
      },
      _count: { _all: true },
    });
    return groups
      .map((g) => ({
        value: String(g[field] ?? ""),
        count: g._count._all,
      }))
      .filter((g) => g.value.length > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_N);
  };
  const [topGeo, topDevice] = await Promise.all([
    countBy("country"),
    countBy("deviceType"),
  ]);
  return {
    clicks: perf.clicks,
    conversions: perf.conversions,
    cvrPct: perf.cvrPct,
    epc: perf.epc,
    windowDays: TRAFFIC_WINDOW_DAYS,
    topGeo,
    topDevice,
    dataQuality: perf.clicks > 0 ? "OBSERVED" : "UNKNOWN",
  };
}

async function experimentsSummary(
  prisma: PrismaClient,
  tenantId: string,
  offerId: string
): Promise<StrategyExperiment[]> {
  const rows = (await prisma.experiment.findMany({
    where: { tenantId, offerId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 20,
  })) as Array<{
    id: string;
    name: string;
    status: string;
    winner: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    winner: r.winner,
  }));
}

async function killSwitchSummary(
  prisma: PrismaClient,
  tenantId: string,
  offerId: string
): Promise<StrategyKillSwitch> {
  const config = (await prisma.killSwitchConfig.findUnique({
    where: { offerId },
  })) as {
    tenantId: string;
    enabled: boolean;
    maxSpend: unknown;
    minExpectedProfit: unknown;
    minCvr: number | null;
    maxPolicyRisk: number | null;
  } | null;
  const scoped =
    config && config.tenantId === tenantId ? config : null;
  const events = (await prisma.killSwitchEvent.findMany({
    where: { tenantId, offerId },
    orderBy: { createdAt: "desc" },
    take: 10,
  })) as Array<{
    id: string;
    triggeredBy: string;
    actionTaken: string;
    linksPaused: number;
    createdAt: Date | null;
  }>;
  return {
    config: scoped
      ? {
          enabled: scoped.enabled,
          maxSpend: num(scoped.maxSpend),
          minExpectedProfit: num(scoped.minExpectedProfit),
          minCvr: scoped.minCvr,
          maxPolicyRisk: scoped.maxPolicyRisk,
        }
      : null,
    recentEvents: events.map((e) => ({
      id: e.id,
      triggeredBy: e.triggeredBy,
      actionTaken: e.actionTaken,
      linksPaused: e.linksPaused,
      createdAt: e.createdAt ? e.createdAt.toISOString() : null,
    })),
  };
}

/** Brand terms from the linked merchant: name + domain tokens. */
async function brandTerms(
  prisma: PrismaClient,
  tenantId: string,
  offer: OfferRow
): Promise<string[]> {
  if (!offer.merchantId) return [];
  const merchant = (await prisma.merchant.findFirst({
    where: { id: offer.merchantId, tenantId, deletedAt: null },
  })) as { name: string; domain: string | null } | null;
  if (!merchant) return [];
  const terms = new Set<string>();
  for (const part of merchant.name.toLowerCase().split(/[^a-z0-9]+/)) {
    if (part.length >= 3) terms.add(part);
  }
  if (merchant.domain) {
    for (const part of merchant.domain.toLowerCase().split(/[^a-z0-9]+/)) {
      if (part.length >= 3 && part !== "com") terms.add(part);
    }
  }
  return [...terms];
}

/**
 * Keyword seeds: real observed search terms first (OBSERVED), then
 * merchant-derived seed ideas (PREDICTED) so the plan always has a usable
 * starting list. Seeds are suggestions, never claimed as real search data.
 */
/** Test-only export: exercised by test-click isolation tests. */
export async function planKeywords(
  prisma: PrismaClient,
  tenantId: string,
  offer: OfferRow,
  terms: string[]
): Promise<CampaignPlanKeyword[]> {
  const since = new Date(
    Date.now() - TRAFFIC_WINDOW_DAYS * 24 * 3600 * 1000
  );
  const groups = await prisma.click.groupBy({
    by: ["utmTerm"],
    where: {
      tenantId,
      offerId: offer.id,
      occurredAt: { gte: since },
      utmTerm: { not: null },
      // Test clicks (link-chain verification) never count as real traffic.
      isTest: { not: true },
    },
    _count: { _all: true },
  });
  const observed = groups
    .map((g) => ({
      term: (g.utmTerm ?? "").trim().toLowerCase(),
      count: g._count._all,
    }))
    .filter((g) => g.term.length >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
    .map((g) => g.term);
  const seeds: string[] = [];
  for (const term of terms.slice(0, 3)) {
    for (const tpl of [
      `${term} coupon`,
      `${term} discount code`,
      `buy ${term} online`,
      `${term} sale`,
    ]) {
      seeds.push(tpl);
    }
  }
  const seen = new Set<string>();
  const out: CampaignPlanKeyword[] = [];
  const push = (
    text: string,
    matchType: "EXACT" | "PHRASE",
    dataQuality: DataQuality
  ) => {
    const key = `${matchType}:${text}`;
    if (seen.has(key) || text.length < 2) return;
    seen.add(key);
    out.push({ text, matchType, suggestedBid: null, dataQuality });
  };
  for (const t of observed.slice(0, 20)) {
    push(t, "EXACT", "OBSERVED");
    push(t, "PHRASE", "OBSERVED");
  }
  for (const t of seeds.slice(0, 12)) {
    push(t, "EXACT", "PREDICTED");
    push(t, "PHRASE", "PREDICTED");
  }
  return out;
}

function scenarioRow(v: unknown): {
  cvr: number | null;
  cpc: number | null;
  clicks: number | null;
  profit: number | null;
} {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    cvr: num(o.cvr),
    cpc: num(o.cpc),
    clicks: num(o.clicks),
    profit: num(o.profit),
  };
}

function planBudgetInput(model: {
  scenarios: unknown;
  breakEvenCpc: number | null;
  recommendedMaxCpc: number | null;
  dataQuality: unknown;
  currency: string | null;
} | null): BudgetBuildInput {
  const s = (model?.scenarios ?? {}) as Record<string, unknown>;
  const dq = normalizeDataQuality(model?.dataQuality);
  const reason: string[] = model
    ? ["Sized from the latest Phase 1 profit model (100 test clicks per scenario)."]
    : ["No profit model yet — run the strategy orchestration first; all figures are null."];
  return {
    scenarios: {
      worst: scenarioRow(s.worst),
      base: scenarioRow(s.base),
      best: scenarioRow(s.best),
    },
    breakEvenCpc: model?.breakEvenCpc ?? null,
    recommendedMaxCpc: model?.recommendedMaxCpc ?? null,
    dataQuality: dq,
    currency: model?.currency ?? null,
    reason,
  };
}

/**
 * Build the campaign plan DOCUMENT for an offer.
 *
 * Read-only: consumes the latest ProfitModel, observed click terms and
 * merchant brand terms. It never creates anything in Google Ads.
 *
 *   TODO: wire to real Google Ads API when developer token available —
 *   never mock a fake successful creation.
 */
export async function buildCampaignPlan(
  deps: Pick<StrategyDeps, "prisma">,
  tenantId: string,
  offerId: string,
  decision?: DecisionJson
): Promise<CampaignPlan> {
  const { prisma } = deps;
  const offer = await loadOfferOr404(prisma, tenantId, offerId);
  const model = await latestProfitModel(prisma, tenantId, offerId);
  const terms = await brandTerms(prisma, tenantId, offer);
  const keywords = await planKeywords(prisma, tenantId, offer, terms);

  // Every keyword's suggested bid = ProfitModel.recommendedMaxCpc (per spec).
  const bid = model?.recommendedMaxCpc ?? null;
  const modelQuality = normalizeDataQuality(model?.dataQuality);
  for (const k of keywords) {
    k.suggestedBid = bid;
  }

  const trafficMode: TrafficMode | "UNKNOWN" =
    decision?.trafficMode ?? "UNKNOWN";
  const exact: CampaignPlanAdGroup = {
    name: "Exact match",
    matchType: "EXACT",
    keywords: keywords.filter((k) => k.matchType === "EXACT"),
  };
  const phrase: CampaignPlanAdGroup = {
    name: "Phrase match",
    matchType: "PHRASE",
    keywords: keywords.filter((k) => k.matchType === "PHRASE"),
  };
  const campaigns: CampaignPlanCampaign[] = [
    {
      name: `${offer.name} — Search (${trafficMode === "UNKNOWN" ? "mode TBD" : trafficMode === "DIRECT_LINK" ? "direct link" : "landing page"})`,
      trafficMode,
      adGroups: [exact, phrase].filter((g) => g.keywords.length > 0),
    },
  ];

  // Negatives reuse the brand-check conflict logic: plan keywords that hit
  // merchant brand terms become exact/phrase negatives.
  const conflicts = checkBrandConflicts(
    keywords.map((k) => k.text),
    terms
  );
  const negatives = buildNegativeKeywords(conflicts);

  const budget = buildBudgetRecommendation(planBudgetInput(model));
  const notes: string[] = [
    "This is a planning document. Nothing is created in Google Ads automatically.",
  ];
  if (!model) {
    notes.push("No profit model found — run POST /api/v1/offers/:id/strategy first; bids and budget are null.");
  } else if (modelQuality !== "OBSERVED") {
    notes.push("Bids derive from a PREDICTED profit model, not observed conversions.");
  }
  if (terms.length === 0) {
    notes.push("No merchant brand terms on file — negative list only covers keywords that matched no brand terms (empty).");
  }
  if (trafficMode === "UNKNOWN") {
    notes.push("Traffic mode unknown — run the strategy orchestration to pick LANDING_PAGE vs DIRECT_LINK from policy.");
  }

  return {
    offerId: offer.id,
    offerName: offer.name,
    trafficMode,
    campaigns,
    negatives: {
      exact: negatives.exact,
      phrase: negatives.phrase,
      dataQuality: terms.length > 0 ? "PREDICTED" : "UNKNOWN",
    },
    budget,
    notes,
    dataQuality: modelQuality,
    generatedAt: new Date().toISOString(),
  };
}

function buildScaleRecommendation(
  decision: DecisionJson,
  model: {
    scenarios: unknown;
    dataQuality: unknown;
  } | null,
  dailyBudget: number | null
): ScaleRecommendation {
  const dq = normalizeDataQuality(model?.dataQuality);
  const base = scenarioRow(
    (model?.scenarios as Record<string, unknown> | undefined)?.base
  );
  const baseProfit = base.profit;
  const profitable =
    (decision.decision === "RUN" || decision.decision === "TEST") &&
    baseProfit != null &&
    baseProfit > 0;
  const reason: string[] = [];
  if (profitable) {
    reason.push(
      `Base scenario projects +${baseProfit} profit per ${base.clicks ?? "?"} clicks at the recommended max CPC.`
    );
  }
  if (!profitable) {
    reason.push("Not eligible: decision is not RUN/TEST or base scenario profit is not positive.");
  }
  const currentDailyBudget = dailyBudget;
  return {
    eligible: profitable,
    multiplier: profitable ? SCALE_MULTIPLIER : null,
    currentDailyBudget,
    suggestedDailyBudget:
      profitable && currentDailyBudget != null
        ? Math.round(currentDailyBudget * SCALE_MULTIPLIER * 100) / 100
        : null,
    reason,
    dataQuality: dq,
    // Symmetric to the Kill Switch: advisory only, never auto-executed.
    note: "Advisory only — never auto-executed. Review the decision card and kill-switch state before scaling spend.",
  };
}

/**
 * Full-chain strategy orchestration (Phase 5).
 *
 * Order: (1) Phase 1 pipeline → DecisionJson, (2) Phase 2 traffic summary,
 * (3) Phase 3 experiments + kill-switch, (4) Phase 4 research (degraded on
 * failure), (5) synthesize StrategyOutput (campaign plan + scale advice).
 *
 * Step 1 reuses runOfferPipeline unchanged; it needs stored offer terms
 * (from a prior /scan or /decision call). Step 2-4 are read-only DB reads.
 */
export async function runFullStrategy(
  deps: StrategyDeps,
  tenantId: string,
  offerId: string,
  opts?: { userId?: string }
): Promise<StrategyOutput> {
  const { prisma } = deps;
  const offer = await loadOfferOr404(prisma, tenantId, offerId);

  // --- 1. Phase 1: full pipeline → §32 decision (module behavior unchanged).
  const policy = (await prisma.offerPolicy.findFirst({
    where: { offerId, tenantId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  })) as { rawTerms: string | null } | null;
  const termsText = (policy?.rawTerms ?? "").trim();
  if (termsText.length < 50) {
    throw new AppError(
      "No stored offer terms (≥50 chars); run POST /api/v1/offers/:id/scan or /decision first.",
      { code: "NO_POLICY_DATA", statusCode: 400 }
    );
  }
  const commissionRaw = offer.commissionValue;
  const commission =
    typeof commissionRaw === "number"
      ? commissionRaw
      : commissionRaw != null
        ? Number(String(commissionRaw))
        : null;
  const trafficMode: TrafficMode = "LANDING_PAGE";
  const rawDecision = await runOfferPipeline(
    {
      prisma,
      chatJsonImpl: deps.chatJsonImpl,
      fetchPageImpl: deps.fetchPageImpl,
    },
    tenantId,
    opts?.userId,
    offerId,
    {
      termsText,
      language: "zh",
      trafficMode,
      geo: [],
      commission: Number.isFinite(commission) ? (commission as number) : null,
      commissionType: null,
      currency: "USD",
      estimatedCpc: null,
    }
  );
  const decision = validateDecisionShape(
    JSON.parse(JSON.stringify(rawDecision))
  );

  // --- 2. Phase 2: real traffic summary (read-only).
  const traffic = await trafficSummary(prisma, tenantId, offerId);

  // --- 3. Phase 3: experiments + kill-switch state (read-only).
  const [experiments, killSwitch] = await Promise.all([
    experimentsSummary(prisma, tenantId, offerId),
    killSwitchSummary(prisma, tenantId, offerId),
  ]);

  // --- 4. Phase 4: research (degrades to NO_DATA on failure).
  const research = await researchStep(deps, tenantId, offerId);

  // --- 5. Synthesize: campaign plan + scale advice (both advisory).
  const model = await latestProfitModel(prisma, tenantId, offerId);
  const campaignPlan = await buildCampaignPlan(
    { prisma },
    tenantId,
    offerId,
    decision
  );
  const scaleRecommendation = buildScaleRecommendation(
    decision,
    model,
    campaignPlan.budget.dailyBudget
  );

  return {
    offerId: offer.id,
    offerName: offer.name,
    decision,
    research,
    traffic,
    experiments,
    killSwitch,
    campaignPlan,
    scaleRecommendation,
    generatedAt: new Date().toISOString(),
  };
}
