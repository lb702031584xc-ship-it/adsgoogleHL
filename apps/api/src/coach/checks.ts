/**
 * 教练模式（第十三批）：防蠢拦截器 — 纯函数检查模块。
 *
 * 四条规则：
 *  1. brand_keyword      — 建广告/关键词命中品牌词 → 拦截 + 解释 + 正确做法
 *  2. disclosure         — 落地页发布时无 Affiliate Disclosure → 拦截
 *  3. marketplace_target — Offer/跟踪链接目标直连平台域 → 拦截
 *  4. budget_limit        — 日预算超过用户设定的上限 → 二次确认（非硬拦截）
 *
 * 返回 findings（机器码 + 插值参数），文案由 Web 字典翻译。
 * 品牌词判断复用 apps/api/src/ai/brand-check.ts；
 * 平台域复用 apps/api/src/traffic/official-site.ts 的 isMarketplaceDomain()。
 */
import { isMarketplaceDomain } from "../traffic/official-site.js";
import { checkBrandConflicts } from "../ai/brand-check.js";

export type CoachRule =
  | "brand_keyword"
  | "disclosure"
  | "marketplace_target"
  | "budget_limit";

export interface CoachFinding {
  rule: CoachRule;
  /** block = 硬拦截；confirm = 二次确认 */
  kind: "block" | "confirm";
  /** Web 字典 key */
  code: string;
  params: Record<string, string>;
}

export interface CoachCheckInput {
  keywords?: string[];
  brandTerms?: string[];
  /** 落地页 HTML/文本内容（发布前检查 disclosure） */
  content?: string | null;
  /** offer/跟踪链接目标 URL */
  url?: string | null;
  /** 日预算（美元） */
  dailyBudget?: number | null;
}

/** 品牌词：关键词命中品牌词 → 每条命中一条 block finding。 */
export function checkBrandKeywords(
  keywords: string[],
  brandTerms: string[]
): CoachFinding[] {
  const terms = (brandTerms ?? []).filter((t) => t.trim());
  if (keywords.length === 0 || terms.length === 0) return [];
  return checkBrandConflicts(keywords, terms)
    .filter((r) => r.conflict)
    .map((r) => ({
      rule: "brand_keyword" as CoachRule,
      kind: "block" as const,
      code: "brandKeyword",
      params: { keyword: r.keyword, terms: r.matchedTerms.join("、") },
    }));
}

/** Disclosure 标记（紧凑，避免误杀）：出现任一即视为有披露。 */
const DISCLOSURE_MARKERS = ["disclosure", "affiliate disclosure", "披露声明", "推广披露"];

export function checkDisclosure(
  content: string | null | undefined
): CoachFinding | null {
  const text = (content ?? "").toLowerCase();
  const found = DISCLOSURE_MARKERS.some((m) => text.includes(m.toLowerCase()));
  return found
    ? null
    : { rule: "disclosure", kind: "block", code: "disclosure", params: {} };
}

/** 目标直连平台域 → 拦截（平台链接必须经自己的落地页/跟踪）。 */
export function checkMarketplaceTarget(
  url: string | null | undefined
): CoachFinding | null {
  if (!url) return null;
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const hit = isMarketplaceDomain(host);
  return hit
    ? {
        rule: "marketplace_target",
        kind: "block",
        code: "marketplaceTarget",
        params: { domain: host },
      }
    : null;
}

/** 日预算超用户上限 → 二次确认（kind=confirm，非硬拦截）。 */
export function checkDailyBudget(
  dailyBudget: number | null | undefined,
  limit: number | null | undefined
): CoachFinding | null {
  if (
    dailyBudget === null ||
    dailyBudget === undefined ||
    limit === null ||
    limit === undefined ||
    !(dailyBudget > 0) ||
    !(limit > 0)
  ) {
    return null;
  }
  return dailyBudget > limit
    ? {
        rule: "budget_limit",
        kind: "confirm",
        code: "budgetLimit",
        params: { budget: String(dailyBudget), limit: String(limit) },
      }
    : null;
}

/** 聚合入口：只检查明确传入的输入（undefined = 不检查该项）。 */
export function runCoachChecks(
  input: CoachCheckInput & { budgetLimit?: number | null }
): CoachFinding[] {
  const findings: CoachFinding[] = [];
  if (input.keywords !== undefined || input.brandTerms !== undefined) {
    findings.push(
      ...checkBrandKeywords(input.keywords ?? [], input.brandTerms ?? [])
    );
  }
  if (input.content !== undefined) {
    const d = checkDisclosure(input.content);
    if (d) findings.push(d);
  }
  if (input.url !== undefined) {
    const m = checkMarketplaceTarget(input.url);
    if (m) findings.push(m);
  }
  if (input.dailyBudget !== undefined) {
    const b = checkDailyBudget(input.dailyBudget, input.budgetLimit ?? null);
    if (b) findings.push(b);
  }
  return findings;
}
