/**
 * 流量需求门评估（Traffic Gate）。
 *
 * 判定逻辑：
 * - 有官网（自动检测到，或调用方直接提供 domain 跳过检测）：
 *   ① SimilarWeb key 已配置 → 官网月访问量（付费绝对值）>= 阈值；
 *   ② 无 key/获取失败 → Google Trends 品牌热度（免费 0-100 相对值）>= 阈值兜底。
 * - 无官网：
 *   ① Google Trends 核心关键词热度（免费相对值）>= 阈值；
 *   ② DataForSEO key 已配置 → 关键词月均搜索量（付费绝对值）仅展示，不判定。
 *
 * 铁律：相对热度（Trends）绝不写成访问量/搜索量；任一判定信号无数据时
 * 整体 passed=null（unknown），不直接判 fail；内部永不抛错。
 */
import type { PrismaClient } from "@adlinklab/database";
import { registrableDomain } from "../ai/compliance.js";
import { detectOfficialSite } from "./official-site.js";
import { getKeywordInterest } from "./trends.js";
import { SimilarWebProvider } from "./similarweb.js";
import { DataForSeoProvider } from "./dataforseo.js";
import type {
  OfficialSiteInfo,
  TrafficGateResult,
  TrafficSignal,
  TrafficThresholds,
} from "./types.js";

export interface EvaluateTrafficGateInput {
  brand: string | null;
  title: string;
  keywords: string[];
  thresholds: TrafficThresholds;
  prisma: PrismaClient;
  fetchImpl?: typeof fetch;
  /**
   * 调用方直接提供的官网域名：非空时跳过 DuckDuckGo 自动检测，
   * officialSite = { found: true, domain, confidence: 'medium' }。
   */
  domain?: string | null;
  /** Trends 地理区域，默认 'US'。 */
  geo?: string;
}

/** 中英文停用词（标题分词/品牌提取时过滤）。 */
const STOPWORDS: ReadonlySet<string> = new Set([
  // 英文
  "a", "an", "the", "and", "or", "for", "with", "of", "to", "in", "on",
  "at", "by", "new", "best", "top", "hot", "sale", "official", "original",
  "genuine", "premium", "deluxe", "portable", "mini", "large", "small",
  "pack", "set", "pro", "plus", "max", "ultra",
  // 中文
  "的", "地", "得", "和", "与", "或", "在", "了", "是", "有",
  "新款", "正品", "官方", "旗舰", "迷你", "便携", "套装", "新品",
]);

/** 标题分词：去停用词，保留长度>=2 或含数字的 token。 */
function tokenizeTitle(title: string): string[] {
  return (title ?? "")
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((t) => t.trim())
    .filter(
      (t) => t !== "" && !STOPWORDS.has(t) && (t.length >= 2 || /\d/.test(t))
    );
}

/**
 * 从产品标题启发式提取品牌：取前 2 个有效 token。
 * 例："Anker 737 Power Bank 120W" → "anker 737"；"安克 充电宝 20000mAh" → "安克 充电宝"。
 * 无有效 token → null。
 */
export function deriveBrandFromTitle(title: string): string | null {
  const tokens = tokenizeTitle(title);
  if (tokens.length === 0) return null;
  return tokens.slice(0, 2).join(" ");
}

/**
 * 提取核心关键词：优先用调用方给的 keywords（前 2 个），
 * 否则从标题分词取 1-2 个词组（每组最多 2 个 token）。
 */
export function extractCoreKeywords(
  title: string,
  fallbackKeywords: string[]
): string[] {
  const fromFallback = (fallbackKeywords ?? [])
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (fromFallback.length > 0) return fromFallback;
  const tokens = tokenizeTitle(title);
  const phrases: string[] = [];
  for (let i = 0; i < tokens.length && phrases.length < 2; i += 2) {
    phrases.push(tokens.slice(i, i + 2).join(" "));
  }
  return phrases;
}

/** 归一化调用方提供的域名：去协议/路径/首尾空白，转小写。 */
function normalizeProvidedDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    ?.trim() ?? "";
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function describeSignal(s: TrafficSignal): string {
  const v = s.value === null ? "暂无数据" : fmtInt(s.value);
  const t = s.threshold === null ? "无" : fmtInt(s.threshold);
  return `${s.label}：${v}（阈值 ${t}）`;
}

async function evaluate(
  input: EvaluateTrafficGateInput
): Promise<TrafficGateResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const geo = (input.geo ?? "US").trim() || "US";
  const thresholds = input.thresholds;
  const signals: TrafficSignal[] = [];

  // ---- 官网：调用方直给 domain 时跳过自动检测 ----
  const providedDomain = normalizeProvidedDomain(input.domain ?? "");
  let officialSite: OfficialSiteInfo;
  let detectionNote = "";
  if (providedDomain) {
    officialSite = { found: true, domain: providedDomain, confidence: "medium" };
    detectionNote = "官网域名由调用方提供，跳过自动检测";
  } else {
    const brand = (input.brand ?? "").trim() || deriveBrandFromTitle(input.title ?? "");
    officialSite = await detectOfficialSite(brand ?? "", fetchImpl);
    detectionNote =
      officialSite.found && officialSite.domain
        ? `官网 ${officialSite.domain}（DuckDuckGo 免费自动检测，置信度 ${officialSite.confidence}）`
        : "未找到品牌官网（DuckDuckGo 免费自动检测）";
  }

  if (officialSite.found && officialSite.domain) {
    const domain = officialSite.domain;
    // ---- 有官网：优先 SimilarWeb 付费绝对流量 ----
    const sw = new SimilarWebProvider(input.prisma, fetchImpl);
    const visits = await sw.getMonthlyVisits(domain);
    if (visits !== null) {
      signals.push({
        source: "similarweb",
        label: "官网月访问量（SimilarWeb 付费 API）",
        value: visits,
        threshold: thresholds.officialSiteMonthlyVisits,
        passed: visits >= thresholds.officialSiteMonthlyVisits,
        note: detectionNote,
      });
    } else {
      // ---- 无 key/获取失败：Trends 品牌热度兜底（免费相对值） ----
      const brandKeyword =
        (input.brand ?? "").trim() ||
        deriveBrandFromTitle(input.title ?? "") ||
        (registrableDomain(domain).split(".")[0] ?? domain);
      const interest = await getKeywordInterest([brandKeyword], geo, fetchImpl);
      signals.push({
        source: "trends",
        label: "品牌热度（Google Trends 免费相对值，非访问量）",
        value: interest,
        threshold: thresholds.brandInterest,
        passed: interest === null ? null : interest >= thresholds.brandInterest,
        note:
          `${detectionNote}；SimilarWeb 未配置（需付费 key）或获取失败，` +
          `改用免费品牌热度。关键词：${brandKeyword}`,
      });
    }
  } else {
    // ---- 无官网：Trends 核心关键词热度（免费相对值） ----
    const coreKeywords = extractCoreKeywords(
      input.title ?? "",
      input.keywords ?? []
    );
    const interest =
      coreKeywords.length > 0
        ? await getKeywordInterest(coreKeywords, geo, fetchImpl)
        : null;
    signals.push({
      source: "trends",
      label: "核心关键词热度（Google Trends 免费相对值，非搜索量）",
      value: interest,
      threshold: coreKeywords.length > 0 ? thresholds.keywordInterest : null,
      passed:
        interest === null ? null : interest >= thresholds.keywordInterest,
      note: `${detectionNote}。关键词：${coreKeywords.join(" / ") || "无"}`,
    });
    // ---- DataForSEO 绝对搜索量：仅展示，不判定 ----
    const df = new DataForSeoProvider(input.prisma, fetchImpl);
    const volumes = await df.getKeywordVolume(coreKeywords);
    for (const v of volumes) {
      signals.push({
        source: "dataforseo",
        label: `关键词月均搜索量（DataForSEO 付费 API，仅展示）`,
        value: v.volume,
        threshold: null,
        passed: null,
        note: `关键词：${v.keyword}`,
      });
    }
  }

  // ---- 综合判定：只看带阈值的信号 ----
  const decisive = signals.filter((s) => s.threshold !== null);
  let passed: boolean | null;
  let reason: string;
  if (decisive.length === 0 || decisive.some((s) => s.passed === null)) {
    passed = null;
    const missing = decisive
      .filter((s) => s.passed === null)
      .map((s) => s.label);
    reason =
      `流量门结果未知（unknown）：暂无数据——` +
      (missing.length > 0
        ? `${missing.join("；")}未配置（需付费 key）或获取失败`
        : "无可判定的数据源") +
      `。免费数据源（Google Trends）与付费数据源（SimilarWeb/DataForSEO）均未能返回有效判定数据。`;
  } else if (decisive.every((s) => s.passed === true)) {
    passed = true;
    reason =
      `流量门通过：${decisive.map(describeSignal).join("；")}。` +
      (providedDomain ? "官网域名由调用方提供，跳过自动检测。" : "");
  } else {
    passed = false;
    reason =
      `流量门未通过：${decisive
        .filter((s) => s.passed === false)
        .map(describeSignal)
        .join("；")}。` +
      (providedDomain ? "官网域名由调用方提供，跳过自动检测。" : "");
  }

  return { passed, reason, officialSite, signals };
}

/**
 * 流量门评估入口。内部永不抛错：任何异常都收敛为
 * passed=null（unknown）+ 说明原因的 TrafficGateResult。
 */
export async function evaluateTrafficGate(
  input: EvaluateTrafficGateInput
): Promise<TrafficGateResult> {
  try {
    return await evaluate(input);
  } catch (e) {
    return {
      passed: null,
      reason:
        "流量门评估异常（unknown）：内部错误，未拿到任何数据源数据——" +
        (e instanceof Error ? e.message : String(e)),
      officialSite: null,
      signals: [],
    };
  }
}
