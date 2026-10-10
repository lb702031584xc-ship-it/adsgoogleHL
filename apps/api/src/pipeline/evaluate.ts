/**
 * 选品流水线评估（第五批）。
 *
 * 5 道门全部复用现有模块：
 *  1. quality — 纯规则（rating/reviews 阈值）
 *  2. demand   — 复用 apps/api/src/traffic/gate.ts 的 evaluateTrafficGate
 *  3. metrics  — 复用 apps/api/src/offer-metrics/scrape.ts + score.ts
 *  4. profit   — 复用 apps/api/src/ai/profitability.ts 的 computeProfitability
 *  5. risk     — 复用 LLM（chatJsonValidated），品牌词/政策风险专用小 prompt
 *
 * 每道门独立 try/catch：异常 → unknown（降权不杀），绝不让整轮评估抛错。
 * 并发度限制为 3，避免 hammer 外部服务。
 */
import { createHash } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { getTrafficThresholds } from "../traffic/thresholds.js";
import { evaluateTrafficGate } from "../traffic/gate.js";
import { scrapeOfferMetrics } from "../offer-metrics/scrape.js";
import { scoreOfferMetrics } from "../offer-metrics/score.js";
import { computeProfitability, computeClickProfit } from "../ai/profitability.js";
import {
  assertAiSettingsPepperConfigured,
  decryptSecret,
} from "../ai/crypto.js";
import { AiError, chatJson, chatJsonValidated } from "../ai/llm.js";
import {
  GATE_SCORE,
  PIPELINE_WEIGHTS,
  type GateResult,
  type PipelineItemInput,
  type PipelineItemResult,
  type PipelineOptions,
  type PipelineRunResult,
} from "./types.js";

export interface EvaluateDeps {
  prisma: PrismaClient;
  redis?: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  };
  chatJsonImpl?: typeof chatJson;
  scrapeImpl?: typeof scrapeOfferMetrics;
}

interface ResolvedOptions {
  minRating: number;
  minReviews: number;
  minMetricsScore: number;
  estimatedCpc: number | null;
  commission: number | null;
  maxBreakEvenCvrPct: number;
  riskCheck: boolean;
  country: string;
  denyLowRating: boolean;
  denyBrandWord: boolean;
  denyPolicyCategory: boolean;
}

function resolveOptions(o: PipelineOptions): ResolvedOptions {
  return {
    minRating: o.minRating ?? 4.0,
    minReviews: o.minReviews ?? 100,
    minMetricsScore: o.minMetricsScore ?? 60,
    estimatedCpc: o.estimatedCpc ?? null,
    commission: o.commission ?? null,
    maxBreakEvenCvrPct: o.maxBreakEvenCvrPct ?? 15,
    riskCheck: o.riskCheck ?? true,
    country: (o.country ?? "US").toUpperCase(),
    denyLowRating: o.denyLowRating ?? true,
    denyBrandWord: o.denyBrandWord ?? true,
    denyPolicyCategory: o.denyPolicyCategory ?? true,
  };
}

const gate = (
  key: GateResult["key"],
  status: GateResult["status"],
  reason: string,
  detail?: Record<string, unknown>
): GateResult => ({
  key,
  status,
  score: GATE_SCORE[status],
  reason,
  ...(detail ? { detail } : {}),
});

/* ------------------------------------------------------------------ */
/* 第 1 道：基础质量门                                                   */
/* ------------------------------------------------------------------ */
function qualityGate(item: PipelineItemInput, o: ResolvedOptions): GateResult {
  const { rating, reviewCount } = item;
  if (rating === undefined || reviewCount === undefined) {
    return gate("quality", "unknown", "缺少评分/评论数，无法判定（降权不杀）");
  }
  if (rating >= o.minRating && reviewCount >= o.minReviews) {
    return gate(
      "quality",
      "pass",
      `评分 ${rating} ≥ ${o.minRating} 且评论 ${reviewCount} ≥ ${o.minReviews}`,
      { rating, reviewCount }
    );
  }
  const reasons: string[] = [];
  if (rating < o.minRating) reasons.push(`评分 ${rating} < ${o.minRating}`);
  if (reviewCount < o.minReviews) reasons.push(`评论 ${reviewCount} < ${o.minReviews}`);
  return gate("quality", "fail", reasons.join("；"), { rating, reviewCount });
}

/* ------------------------------------------------------------------ */
/* 第 2 道：需求门（复用流量门）                                          */
/* ------------------------------------------------------------------ */
async function demandGate(
  item: PipelineItemInput,
  o: ResolvedOptions,
  deps: EvaluateDeps
): Promise<GateResult> {
  try {
    const thresholds = await getTrafficThresholds(deps.prisma);
    const res = await evaluateTrafficGate({
      brand: item.brand ?? null,
      title: item.title,
      keywords: [],
      thresholds,
      prisma: deps.prisma,
      domain: null,
      geo: o.country,
      manualMonthlyVisits: item.manualMonthlyVisits ?? null,
    });
    if (res.passed === true) {
      return gate("demand", "pass", `流量门通过：${res.reason}`, {
        signals: res.signals.length,
      });
    }
    if (res.passed === false) {
      return gate("demand", "fail", `流量门未通过：${res.reason}`);
    }
    return gate("demand", "unknown", `流量门未知：${res.reason}（降权不杀）`);
  } catch (e) {
    return gate(
      "demand",
      "unknown",
      `需求门评估异常（${e instanceof Error ? e.message : "未知错误"}），降权不杀`
    );
  }
}

/* ------------------------------------------------------------------ */
/* 第 3 道：指标门（复用 offer-metrics 推荐指数）                          */
/* ------------------------------------------------------------------ */
async function metricsGate(
  item: PipelineItemInput,
  o: ResolvedOptions,
  deps: EvaluateDeps
): Promise<GateResult> {
  const url =
    item.detailPageUrl ??
    (item.asin ? `https://www.amazon.com/dp/${item.asin}` : null);
  if (!url) {
    return gate("metrics", "unknown", "无商品链接/ASIN，无法抓取指标（降权不杀）");
  }
  try {
    const scrape = deps.scrapeImpl ?? scrapeOfferMetrics;
    const metrics = await scrape(url);
    const scored = scoreOfferMetrics(metrics);
    if (scored.score === null) {
      return gate(
        "metrics",
        "unknown",
        `未抓到可用指标（${metrics.failures.slice(0, 2).join("；") || "无数据"}），降权不杀`
      );
    }
    if (scored.score >= o.minMetricsScore) {
      return gate(
        "metrics",
        "pass",
        `推荐指数 ${scored.score} ≥ ${o.minMetricsScore}`,
        { score: scored.score, grade: scored.grade }
      );
    }
    return gate(
      "metrics",
      "fail",
      `推荐指数 ${scored.score} < ${o.minMetricsScore}`,
      { score: scored.score, grade: scored.grade }
    );
  } catch (e) {
    return gate(
      "metrics",
      "unknown",
      `指标抓取异常（${e instanceof Error ? e.message : "未知错误"}），降权不杀`
    );
  }
}

/* ------------------------------------------------------------------ */
/* 第 4 道：盈亏门（复用盈利测算）                                        */
/* ------------------------------------------------------------------ */
function profitGate(_item: PipelineItemInput, o: ResolvedOptions): GateResult {
  const { estimatedCpc, commission } = o;
  if (estimatedCpc === null || commission === null) {
    return gate("profit", "unknown", "未填预估 CPC/佣金，无法测算（降权不杀）");
  }
  const p = computeProfitability(commission, "USD", estimatedCpc);
  const be = p.breakEvenCvrPct;
  // 第十一批：每次点击盈亏 + 推荐出价（cvr 默认 2% 预估值）
  const clickProfit = computeClickProfit({
    fixedCommission: commission,
    cvr: 0.02,
    cpc: estimatedCpc,
  });
  const detail = { breakEvenCvrPct: be, clickProfit };
  if (be === null) {
    return gate("profit", "unknown", "CPC/佣金非法，无法测算（降权不杀）", detail);
  }
  if (be > 100) {
    return gate(
      "profit",
      "fail",
      `数学上打不平：CPC $${estimatedCpc} > 佣金 $${commission}，点击一次就亏，直接杀`,
      detail
    );
  }
  if (be > o.maxBreakEvenCvrPct) {
    return gate(
      "profit",
      "fail",
      `盈亏平衡转化率 ${be}% > 上限 ${o.maxBreakEvenCvrPct}%（CPC $${estimatedCpc} / 佣金 $${commission}）`,
      detail
    );
  }
  return gate(
    "profit",
    "pass",
    `盈亏平衡转化率 ${be}% ≤ ${o.maxBreakEvenCvrPct}%（CPC $${estimatedCpc} / 佣金 $${commission}）`,
    detail
  );
}

/* ------------------------------------------------------------------ */
/* 第 5 道：风险门（AI 风控：品牌词/政策风险）                             */
/* ------------------------------------------------------------------ */

interface LlmSettings {
  baseUrl?: string;
  model?: string;
  apiKeyEnc?: string;
}

async function readLlmSettings(prisma: PrismaClient): Promise<LlmSettings> {
  const rows = await prisma.aiSetting.findMany();
  const out: LlmSettings = {};
  for (const r of rows as Array<{ key: string; value: string }>) {
    if (r.key === "llm.baseUrl") out.baseUrl = r.value;
    else if (r.key === "llm.model") out.model = r.value;
    else if (r.key === "llm.apiKeyEnc") out.apiKeyEnc = r.value;
  }
  return out;
}

function riskCacheKey(item: PipelineItemInput): string {
  const h = createHash("sha256")
    .update(`${item.asin ?? ""}|${item.brand ?? ""}|${item.title}`)
    .digest("hex")
    .slice(0, 16);
  return `amazon-pipeline:risk:${h}`;
}

function validateRiskShape(raw: unknown): {
  riskLevel: "low" | "medium" | "high";
  reasons: string[];
} {
  const o = raw as Record<string, unknown>;
  const level = o.riskLevel;
  if (level !== "low" && level !== "medium" && level !== "high") {
    throw new AiError("风险评估返回形状非法：riskLevel");
  }
  const reasons = Array.isArray(o.reasons)
    ? (o.reasons as unknown[]).filter((x) => typeof x === "string").map((x) => (x as string).trim()).filter(Boolean).slice(0, 5)
    : [];
  return { riskLevel: level, reasons };
}

async function riskGate(
  item: PipelineItemInput,
  o: ResolvedOptions,
  deps: EvaluateDeps
): Promise<GateResult> {
  if (!o.riskCheck) {
    return gate("risk", "unknown", "风险门已关闭（降权不杀）");
  }
  try {
    const key = riskCacheKey(item);
    if (deps.redis) {
      try {
        const hit = await deps.redis.get(key);
        if (hit) {
          const cached = JSON.parse(hit) as { riskLevel: "low" | "medium" | "high"; reasons: string[] };
          return riskGateFromLevel(cached.riskLevel, cached.reasons, true);
        }
      } catch {
        // 缓存失败不阻塞
      }
    }
    const settings = await readLlmSettings(deps.prisma);
    if (!settings.baseUrl || !settings.model || !settings.apiKeyEnc) {
      return gate("risk", "unknown", "LLM 未配置，风险门无法评估（降权不杀）");
    }
    const pepper = assertAiSettingsPepperConfigured();
    const apiKey = decryptSecret(settings.apiKeyEnc, pepper);
    const result = await chatJsonValidated(
      {
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey,
        system:
          "你是 Google Ads 联盟推广风控助手。只返回严格 JSON，不要 markdown 围栏、不要解释。",
        user:
          `评估以下 Amazon 商品做 Google Ads 联盟推广的品牌词/政策风险（只看品牌词风险与政策合规风险，不评估销量）：\n` +
          `标题：${item.title}\n品牌：${item.brand ?? "未知"}\nASIN：${item.asin ?? "未知"}\n\n` +
          `严格按此 JSON 返回：{"riskLevel": "low|medium|high", "reasons": ["原因1", "原因2"]}\n` +
          `high = 明确品牌词侵权/仿品/政策禁区（如医疗功效宣称、成人用品等）；medium = 有风险点需人工复核；low = 未见明显风险。`,
      },
      validateRiskShape,
      deps.chatJsonImpl ?? chatJson
    );
    if (deps.redis) {
      try {
        await deps.redis.set(key, JSON.stringify(result), "EX", 7 * 24 * 3600);
      } catch {
        // 忽略
      }
    }
    return riskGateFromLevel(result.riskLevel, result.reasons, false);
  } catch (e) {
    return gate(
      "risk",
      "unknown",
      `风险门评估异常（${e instanceof Error ? e.message : "未知错误"}），降权不杀`
    );
  }
}

function riskGateFromLevel(
  level: "low" | "medium" | "high",
  reasons: string[],
  cached: boolean
): GateResult {
  const suffix = reasons.length > 0 ? `：${reasons.join("；")}` : "";
  const cacheNote = cached ? "（缓存）" : "";
  // 品牌词/政策风险标记：供第 6 道"否定清单门"复用（批次5追加）
  const joined = reasons.join(" ");
  const brandRisk = /品牌/.test(joined);
  const policyRisk = /政策|成人|医疗|武器|烟草|仿品|违禁/.test(joined);
  const detail = { riskLevel: level, brandRisk, policyRisk };
  if (level === "high") {
    return gate("risk", "fail", `AI 风控判定高风险，打回${suffix}${cacheNote}`, detail);
  }
  if (level === "medium") {
    return gate("risk", "unknown", `AI 风控判定中风险，需人工复核${suffix}${cacheNote}（降权不杀）`, detail);
  }
  return gate("risk", "pass", `AI 风控未见明显风险${suffix}${cacheNote}`, detail);
}

/* ------------------------------------------------------------------ */
/* 第 6 道门：否定清单门（批次5追加）                                                  */
/* ------------------------------------------------------------------ */

interface DenylistEntryLite {
  type: string;
  value: string;
}

async function loadDenylistEntries(
  deps: EvaluateDeps,
  tenantId: string | null
): Promise<DenylistEntryLite[]> {
  if (!tenantId) return [];
  try {
    const rows = (await deps.prisma.denylistEntry.findMany({
      where: { tenantId },
      select: { type: true, value: true },
    })) as DenylistEntryLite[];
    return rows;
  } catch {
    // DB 失败降级：只跑内置规则，不抛错
    return [];
  }
}

function matchDenylist(
  item: PipelineItemInput,
  entries: DenylistEntryLite[]
): string | null {
  const asin = (item.asin ?? "").toUpperCase();
  const title = (item.title ?? "").toLowerCase();
  const brand = (item.brand ?? "").toLowerCase();
  for (const e of entries) {
    const v = (e.value ?? "").trim();
    if (!v) continue;
    const vl = v.toLowerCase();
    if (e.type === "asin" && asin && asin === v.toUpperCase()) {
      return `命中别碰清单（ASIN：${v}）`;
    }
    if (e.type === "brand" && ((brand && brand === vl) || (title && title.includes(vl)))) {
      return `命中别碰清单（品牌词：${v}）`;
    }
    if (e.type === "keyword" && title && title.includes(vl)) {
      return `命中别碰清单（关键词：${v}）`;
    }
    if (e.type === "category" && ((title && title.includes(vl)) || (brand && brand.includes(vl)))) {
      return `命中别碰清单（品类：${v}）`;
    }
  }
  return null;
}

/**
 * 第 6 道门：否定清单门。
 * 命中 → fail + 直接杀（killed=true），与"数学打不平"同级。
 * 检查顺序：用户别碰名单 → 内置规则（评分<3.5 / AI 标记品牌词风险 / AI 标记政策风险）。
 */
/** 导出供单测直接覆盖（正常经 evaluateItem 调用）。 */
export async function denylistGate(
  item: PipelineItemInput,
  o: ResolvedOptions,
  deps: EvaluateDeps,
  tenantId: string | null,
  risk: GateResult
): Promise<GateResult> {
  const entries = await loadDenylistEntries(deps, tenantId);
  const hit = matchDenylist(item, entries);
  if (hit) {
    return gate("denylist", "fail", `${hit}，直接淘汰`, { source: "denylist" });
  }
  if (o.denyLowRating && item.rating !== null && item.rating !== undefined && item.rating < 3.5) {
    return gate("denylist", "fail", `内置规则：评分 ${item.rating} < 3.5，直接淘汰`, {
      source: "builtin-low-rating",
    });
  }
  const riskDetail = (risk.detail ?? {}) as { brandRisk?: boolean; policyRisk?: boolean };
  if (o.denyBrandWord && riskDetail.brandRisk === true) {
    return gate("denylist", "fail", "内置规则：AI 风控标记品牌词风险，直接淘汰", {
      source: "builtin-brand-word",
    });
  }
  if (o.denyPolicyCategory && riskDetail.policyRisk === true) {
    return gate("denylist", "fail", "内置规则：AI 风控标记政策风险品类，直接淘汰", {
      source: "builtin-policy-category",
    });
  }
  const parts: string[] = [];
  if (entries.length > 0) parts.push(`已比对 ${entries.length} 条别碰清单`);
  parts.push("内置规则：评分≥3.5、无品牌词/政策风险标记");
  return gate("denylist", "pass", parts.join("；"), { source: "none" });
}

/* ------------------------------------------------------------------ */
/* 单品评估 + 整轮                                                                    */
/* ------------------------------------------------------------------ */

async function evaluateItem(
  item: PipelineItemInput,
  o: ResolvedOptions,
  deps: EvaluateDeps,
  tenantId: string | null
): Promise<PipelineItemResult> {
  // 模块级回退：evaluatePipeline 总是传入 tenantId
  const evaluateTenantId = tenantId;
  const quality = qualityGate(item, o);
  // 需求门与指标门并行（都调外部）
  const [demand, metrics] = await Promise.all([
    demandGate(item, o, deps),
    metricsGate(item, o, deps),
  ]);
  const profit = profitGate(item, o);
  const risk = await riskGate(item, o, deps);
  // 第 6 道门在风险门之后：复用 AI 风控的品牌词/政策风险标记
  const denylist = await denylistGate(item, o, deps, evaluateTenantId, risk);

  const gates: GateResult[] = [quality, demand, metrics, profit, risk, denylist];
  // 值得测试指数 = Σ 权重 × 门得分（权重见 PIPELINE_WEIGHTS，注释 + API + 页面三处透明）
  // 第八批：机会品（高需求 + 低满意度）额外 +10，上限 100
  let worthIndex = Math.round(
    gates.reduce((s, g) => s + PIPELINE_WEIGHTS[g.key] * g.score, 0)
  );
  if (item.opportunity === true) {
    worthIndex = Math.min(100, worthIndex + 10);
  }
  // 直接杀：数学上打不平（profit 门 fail 且 break-even >100%）或否定清单门命中
  const killed =
    (profit.status === "fail" &&
      typeof profit.detail?.breakEvenCvrPct === "number" &&
      (profit.detail.breakEvenCvrPct as number) > 100) ||
    denylist.status === "fail";

  return { input: item, gates, worthIndex, killed };
}

/**
 * 整轮评估：并发度 3；按 worthIndex 降序排列。
 * 内部永不抛错：单品异常收敛为全 unknown 的降权结果。
 */
export async function evaluatePipeline(
  items: PipelineItemInput[],
  options: PipelineOptions,
  deps: EvaluateDeps,
  tenantId: string | null = null
): Promise<PipelineRunResult> {
  const o = resolveOptions(options);
  const results: PipelineItemResult[] = [];
  const CONCURRENCY = 3;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (item) => {
        try {
          return await evaluateItem(item, o, deps, tenantId);
        } catch (e) {
          const reason = `评估异常（${e instanceof Error ? e.message : "未知错误"}），降权不杀`;
          const gates: GateResult[] = (
            ["quality", "demand", "metrics", "profit", "risk", "denylist"] as const
          ).map((key) => gate(key, "unknown", reason));
          return {
            input: item,
            gates,
            worthIndex: 50,
            killed: false,
          } satisfies PipelineItemResult;
        }
      })
    );
    results.push(...settled);
  }
  results.sort((a, b) => b.worthIndex - a.worthIndex);
  return {
    items: results,
    weights: { ...PIPELINE_WEIGHTS },
    evaluatedAt: new Date().toISOString(),
  };
}
