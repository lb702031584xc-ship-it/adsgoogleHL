/**
 * Lander Intel ① — landing-page efficiency analyzer (deterministic part).
 *
 * Pure functions over raw HTML: no I/O, no LLM, fully unit-testable.
 * Scores every dimension 0-100; `bounceRisk` is a risk score (higher = worse).
 * Issues carry Chinese messages with severity; the LLM suggestion prompt and
 * its lenient validator live here too.
 */
import { AiError } from "./llm.js";
import { stripHtml } from "./fetch-page.js";

export type LanderDimension =
  | "performance"
  | "cta"
  | "trust"
  | "mobile"
  | "copy"
  | "bounceRisk";

export interface LanderScores {
  performance: number;
  cta: number;
  trust: number;
  mobile: number;
  copy: number;
  bounceRisk: number;
}

export interface LanderIssue {
  dimension: LanderDimension;
  severity: "high" | "medium" | "low";
  message: string;
}

export interface LanderPageSummary {
  title: string;
  h1: string;
  excerpt: string;
}

export interface LanderAnalysisResult {
  scores: LanderScores;
  issues: LanderIssue[];
  overallScore: number;
  summary: LanderPageSummary;
}

export interface LanderSuggestion {
  text: string;
  /** Suggestions are always AI-generated — never OBSERVED. */
  dataQuality: "PREDICTED";
}

// ---------------------------------------------------------------------------
// HTML helpers (regex-based, same lightweight style as research/fetcher.ts)
// ---------------------------------------------------------------------------

function countMatches(html: string, re: RegExp): number {
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(html)) !== null && n < 100_000) {
    n += 1;
    if (m[0].length === 0) rx.lastIndex += 1;
  }
  return n;
}

function innerTexts(html: string, tag: "a" | "button"): string[] {
  const out: string[] = [];
  const rx = new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}\\s*>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = rx.exec(html)) !== null && out.length < 5000) {
    out.push(
      m[0]
        .replace(/^<[^>]+>/, "")
        .replace(/<\/[^>]+>\s*$/, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    );
    if (m[0].length === 0) rx.lastIndex += 1;
  }
  return out;
}

function tagTexts(html: string, tag: string): string[] {
  const out: string[] = [];
  const rx = new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}\\s*>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = rx.exec(html)) !== null && out.length < 100) {
    out.push(
      m[0]
        .replace(/^<[^>]+>/, "")
        .replace(/<\/[^>]+>\s*$/, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    );
    if (m[0].length === 0) rx.lastIndex += 1;
  }
  return out;
}

function firstTagText(html: string, tag: string): string {
  const rx = new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}\\s*>`, "i");
  const m = rx.exec(html);
  if (!m) return "";
  return m[0]
    .replace(/^<[^>]+>/, "")
    .replace(/<\/[^>]+>\s*$/, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

// ---------------------------------------------------------------------------
// 1. performance — fetch time, HTML size, images, external JS/CSS
// ---------------------------------------------------------------------------

function scorePerformance(
  html: string,
  fetchMs: number
): { score: number; issues: LanderIssue[] } {
  const issues: LanderIssue[] = [];
  let score = 100;

  if (fetchMs > 3000) {
    score -= 30;
    issues.push({
      dimension: "performance",
      severity: "high",
      message: `页面抓取耗时 ${fetchMs}ms，加载偏慢，建议压缩资源、启用缓存/CDN`,
    });
  } else if (fetchMs > 1500) {
    score -= 15;
    issues.push({
      dimension: "performance",
      severity: "medium",
      message: `页面抓取耗时 ${fetchMs}ms，建议优化到 1.5s 以内`,
    });
  } else if (fetchMs > 800) {
    score -= 5;
  }

  const bytes = Buffer.byteLength(html, "utf8");
  const kb = Math.round(bytes / 1024);
  if (bytes > 500 * 1024) {
    score -= 20;
    issues.push({
      dimension: "performance",
      severity: "medium",
      message: `HTML 体积约 ${kb}KB，过大，建议精简首屏 HTML、延迟加载非关键资源`,
    });
  } else if (bytes > 200 * 1024) {
    score -= 10;
  } else if (bytes > 100 * 1024) {
    score -= 5;
  }

  const imgCount = countMatches(html, /<img[\s>]/i);
  if (imgCount > 40) {
    score -= 20;
    issues.push({
      dimension: "performance",
      severity: "medium",
      message: `检测到 ${imgCount} 张图片，建议压缩、懒加载并使用现代格式（WebP/AVIF）`,
    });
  } else if (imgCount > 20) {
    score -= 10;
  } else if (imgCount > 10) {
    score -= 5;
  }

  const jsCount = countMatches(html, /<script[^>]+src=["']https?:\/\//i);
  if (jsCount > 15) {
    score -= 15;
    issues.push({
      dimension: "performance",
      severity: "medium",
      message: `检测到 ${jsCount} 个外部 JS，建议合并、延迟加载非关键脚本`,
    });
  } else if (jsCount > 8) {
    score -= 8;
  } else if (jsCount > 4) {
    score -= 3;
  }

  const cssCount = countMatches(html, /<link[^>]+rel=["']stylesheet["']/i);
  if (cssCount > 8) {
    score -= 8;
    issues.push({
      dimension: "performance",
      severity: "low",
      message: `检测到 ${cssCount} 个外部样式表，建议合并 CSS`,
    });
  } else if (cssCount > 4) {
    score -= 4;
  }

  return { score: clamp(score), issues };
}

// ---------------------------------------------------------------------------
// 2. cta — above-the-fold call-to-action presence
// ---------------------------------------------------------------------------

const CTA_WORDS = [
  // Chinese
  "购买",
  "立即购买",
  "马上购买",
  "免费试用",
  "免费注册",
  "立即注册",
  "马上注册",
  "了解更多",
  "查看详情",
  "开始使用",
  "免费开始",
  "立即开始",
  "马上开始",
  "领取优惠",
  "立即领取",
  "下单",
  "加入购物车",
  "立即下单",
  "马上预订",
  "预约",
  "订阅",
  "立即订阅",
  "开始免费",
  "免费下载",
  "立即下载",
  "马上体验",
  "免费体验",
  "抢购",
  "限时抢购",
  "立即咨询",
  "免费咨询",
  // English
  "buy now",
  "shop now",
  "order now",
  "add to cart",
  "sign up",
  "start free",
  "free trial",
  "get started",
  "learn more",
  "claim now",
  "claim offer",
  "subscribe",
  "book now",
  "download now",
  "try free",
  "start now",
  "get it now",
];

/** Above-the-fold region: first ~50KB of HTML. */
export const FOLD_BYTES = 50_000;

function findCtaMatches(html: string): string[] {
  const fold = html.slice(0, FOLD_BYTES);
  const candidates = [...innerTexts(fold, "a"), ...innerTexts(fold, "button")];
  const found: string[] = [];
  for (const text of candidates) {
    const lower = text.toLowerCase();
    if (!lower) continue;
    for (const word of CTA_WORDS) {
      if (lower.includes(word.toLowerCase()) || text.includes(word)) {
        found.push(text);
        break;
      }
    }
  }
  return found;
}

function scoreCta(html: string): { score: number; issues: LanderIssue[] } {
  const matches = findCtaMatches(html);
  const issues: LanderIssue[] = [];
  let score: number;
  if (matches.length >= 3) score = 95;
  else if (matches.length === 2) score = 85;
  else if (matches.length === 1) {
    score = 65;
    issues.push({
      dimension: "cta",
      severity: "medium",
      message:
        "首屏仅检测到 1 个 CTA，建议在 H1 下方等关键位置再增加 1-2 个 CTA 按钮",
    });
  } else {
    score = 20;
    issues.push({
      dimension: "cta",
      severity: "high",
      message:
        "首屏未检测到明确的 CTA 按钮（如“立即购买”/“免费试用”），访客可能不知道下一步做什么",
    });
  }
  return { score, issues };
}

// ---------------------------------------------------------------------------
// 3. trust — reviews, badges, contact info, privacy policy
// ---------------------------------------------------------------------------

const TRUST_SIGNALS: Array<{
  key: string;
  re: RegExp;
  weight: number;
  missingSeverity: "high" | "medium" | "low";
  missingMessage: string;
}> = [
  {
    key: "reviews",
    re: /review|评价|testimonial|客户评价|用户评价|★|rating|评分|口碑/i,
    weight: 25,
    missingSeverity: "medium",
    missingMessage:
      "未检测到用户评价/评分内容，建议增加评价、评分等社会证明",
  },
  {
    key: "badges",
    re: /trust|认证|verified|guarantee|保障|secure|ssl|norton|mcafee|badge/i,
    weight: 25,
    missingSeverity: "low",
    missingMessage: "未检测到认证/保障徽标，可考虑增加以提升信任感",
  },
  {
    key: "contact",
    re: /tel:|电话|contact|联系我们|联系电话|mailto:|\d{3,4}[- ]\d{3,4}[- ]?\d{4}/i,
    weight: 25,
    missingSeverity: "medium",
    missingMessage:
      "未检测到联系方式（电话/邮箱），建议增加以提升信任与转化",
  },
  {
    key: "privacy",
    re: /privacy|隐私政策|隐私声明/i,
    weight: 25,
    missingSeverity: "low",
    missingMessage: "未检测到隐私政策链接，建议在页脚增加",
  },
];

function scoreTrust(html: string): { score: number; issues: LanderIssue[] } {
  const issues: LanderIssue[] = [];
  let score = 0;
  for (const sig of TRUST_SIGNALS) {
    if (sig.re.test(html)) {
      score += sig.weight;
    } else {
      issues.push({
        dimension: "trust",
        severity: sig.missingSeverity,
        message: sig.missingMessage,
      });
    }
  }
  return { score: clamp(score), issues };
}

// ---------------------------------------------------------------------------
// 4. mobile — viewport meta, media queries, responsive frameworks
// ---------------------------------------------------------------------------

function scoreMobile(html: string): { score: number; issues: LanderIssue[] } {
  const issues: LanderIssue[] = [];
  let score = 0;
  const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  const hasMediaQuery = /@media/i.test(html);
  const hasFramework =
    /col-(xs|sm|md|lg)|container-fluid|navbar-toggle|md:|lg:|sm:|tailwind/i.test(
      html
    );

  if (hasViewport) score += 40;
  else
    issues.push({
      dimension: "mobile",
      severity: "high",
      message: "缺少 viewport meta 标签，移动端页面可能显示异常",
    });

  if (hasMediaQuery) score += 30;
  if (hasFramework) score += 30;
  if (!hasMediaQuery && !hasFramework)
    issues.push({
      dimension: "mobile",
      severity: "medium",
      message:
        "未检测到响应式布局线索（media query / 响应式框架类名），移动端体验可能不佳",
    });

  return { score: clamp(score), issues };
}

// ---------------------------------------------------------------------------
// 5. copy — H1 uniqueness/strength, price anchor, urgency
// ---------------------------------------------------------------------------

function scoreCopy(html: string): { score: number; issues: LanderIssue[] } {
  const issues: LanderIssue[] = [];
  let score = 0;

  const h1s = tagTexts(html, "h1");
  if (h1s.length === 1) {
    const len = h1s[0].length;
    if (len >= 10 && len <= 80) score += 40;
    else {
      score += 25;
      issues.push({
        dimension: "copy",
        severity: "low",
        message: `H1 长度 ${len} 字，建议控制在 10-80 字之间，突出核心卖点`,
      });
    }
  } else if (h1s.length === 0) {
    score += 10;
    issues.push({
      dimension: "copy",
      severity: "medium",
      message: "未检测到 H1 标题，建议增加唯一且有力的 H1（10-80 字）",
    });
  } else {
    score += 20;
    issues.push({
      dimension: "copy",
      severity: "medium",
      message: `检测到 ${h1s.length} 个 H1，建议只保留 1 个，避免权重分散`,
    });
  }

  const hasPriceAnchor =
    /[$¥€]\s?\d/.test(html) ||
    /\d+(\.\d+)?\s?(美元|元|dollars|USD)/i.test(html);
  if (hasPriceAnchor) score += 35;
  else
    issues.push({
      dimension: "copy",
      severity: "medium",
      message: "未检测到价格锚点（如 $99），建议在首屏展示价格信息",
    });

  const hasUrgency =
    /限时|仅剩|最后\d*|名额有限|limited|hurry|sale|discount|优惠|促销|倒计时|ends?\s+soon|only\s+\d+\s+left/i.test(
      html
    );
  if (hasUrgency) score += 25;
  else
    issues.push({
      dimension: "copy",
      severity: "low",
      message: "未检测到紧迫感文案（如“限时”/“仅剩”），可考虑增加以促进转化",
    });

  return { score: clamp(score), issues };
}

// ---------------------------------------------------------------------------
// 6. bounceRisk — interference elements (risk score: higher = worse)
// ---------------------------------------------------------------------------

function scoreBounceRisk(html: string): {
  score: number;
  issues: LanderIssue[];
} {
  const issues: LanderIssue[] = [];
  let risk = 0;

  if (/popup|modal|exit.intent|弹窗|订阅弹窗|newsletter/i.test(html)) risk += 35;
  if (/autoplay/i.test(html)) risk += 30;
  if (/<video[\s>]/i.test(html)) risk += 20;
  if (/interstitial|全屏广告|开屏/i.test(html)) risk += 25;

  risk = clamp(risk);
  if (risk >= 60)
    issues.push({
      dimension: "bounceRisk",
      severity: "high",
      message: "检测到较多干扰元素（弹窗/自动播放视频等），可能推高跳出率",
    });
  else if (risk >= 30)
    issues.push({
      dimension: "bounceRisk",
      severity: "medium",
      message: "检测到干扰元素（弹窗/自动播放），建议评估其对跳出率的影响",
    });

  return { score: risk, issues };
}

// ---------------------------------------------------------------------------
// Overall: performance 20 + cta 25 + trust 15 + mobile 15 + copy 15 +
//          (100 - bounceRisk) 10
// ---------------------------------------------------------------------------

export const SCORE_WEIGHTS: Record<LanderDimension, number> = {
  performance: 0.2,
  cta: 0.25,
  trust: 0.15,
  mobile: 0.15,
  copy: 0.15,
  bounceRisk: 0.1,
};

export function computeOverallScore(scores: LanderScores): number {
  const raw =
    scores.performance * SCORE_WEIGHTS.performance +
    scores.cta * SCORE_WEIGHTS.cta +
    scores.trust * SCORE_WEIGHTS.trust +
    scores.mobile * SCORE_WEIGHTS.mobile +
    scores.copy * SCORE_WEIGHTS.copy +
    (100 - scores.bounceRisk) * SCORE_WEIGHTS.bounceRisk;
  return Math.round(raw * 10) / 10;
}

/**
 * Run all six dimensions over raw HTML. `fetchMs` feeds the performance
 * dimension; everything else is HTML-structure only.
 */
export function analyzeLander(
  html: string,
  fetchMs: number
): LanderAnalysisResult {
  const perf = scorePerformance(html, fetchMs);
  const cta = scoreCta(html);
  const trust = scoreTrust(html);
  const mobile = scoreMobile(html);
  const copy = scoreCopy(html);
  const bounce = scoreBounceRisk(html);

  const scores: LanderScores = {
    performance: perf.score,
    cta: cta.score,
    trust: trust.score,
    mobile: mobile.score,
    copy: copy.score,
    bounceRisk: bounce.score,
  };

  const issues = [
    ...perf.issues,
    ...cta.issues,
    ...trust.issues,
    ...mobile.issues,
    ...copy.issues,
    ...bounce.issues,
  ].sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 } as const;
    return rank[a.severity] - rank[b.severity];
  });

  const h1s = tagTexts(html, "h1");
  const summary: LanderPageSummary = {
    title: firstTagText(html, "title"),
    h1: h1s[0] ?? "",
    excerpt: stripHtml(html).slice(0, 500),
  };

  return {
    scores,
    issues,
    overallScore: computeOverallScore(scores),
    summary,
  };
}

// ---------------------------------------------------------------------------
// LLM suggestions — strict JSON prompt + lenient validator (prompts.ts style)
// ---------------------------------------------------------------------------

export type LanderSuggestionLang = "zh" | "en";

const LANDER_SUGGESTION_SPEC = `{
  "suggestions": [
    { "text": "<具体建议，必须具体到元素和位置>" },
    "... (共 3-5 条)"
  ]
}`;

export function buildLanderSuggestionsPrompt(input: {
  scores: LanderScores;
  issues: LanderIssue[];
  summary: LanderPageSummary;
  lang: LanderSuggestionLang;
}): { system: string; user: string } {
  const system =
    "你是落地页转化率优化专家。输入是某落地页的 6 个维度实测评分（0-100；注意 bounceRisk 是风险分，越高越差）、已发现的问题列表、以及页面标题/H1/正文摘要。\n" +
    "请输出 3-5 条具体的优化建议，返回 STRICT JSON，格式如下：\n" +
    `${LANDER_SUGGESTION_SPEC}\n` +
    "规则：\n" +
    "- 禁止输出“优化用户体验”“提升转化率”这类空话。每条建议必须具体到元素和位置，例如“首屏缺少价格锚点，建议在 H1 下方增加原价 $99 划线价 $49”。\n" +
    "- 建议应优先针对评分最低、severity 为 high 的问题。\n" +
    "- 每条建议控制在 120 字以内。\n" +
    "- 只返回 JSON，不要 markdown 代码块，不要任何解释文字。";

  const user =
    `维度评分（0-100）：${JSON.stringify(input.scores)}\n` +
    `问题列表：${JSON.stringify(
      input.issues.map((i) => ({
        dimension: i.dimension,
        severity: i.severity,
        message: i.message,
      }))
    )}\n` +
    `页面标题：${input.summary.title || "(无)"}\n` +
    `H1：${input.summary.h1 || "(无)"}\n` +
    `正文摘要：${input.summary.excerpt || "(无)"}\n` +
    `请用${input.lang === "zh" ? "中文" : "英文"}输出建议。`;

  return { system, user };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function coerceSuggestionText(v: unknown): string | undefined {
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t : undefined;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (isRecord(v)) return coerceSuggestionText(v["text"]);
  return undefined;
}

function asSuggestionTexts(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v) {
    const t = coerceSuggestionText(item);
    if (t !== undefined) out.push(t);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Lenient validator for the LLM suggestion payload: tolerates a capitalized
 * `Suggestions` key, numeric suggestion texts, and `{ text }` wrappers.
 * Throws AiError (→ one guided retry via chatJsonValidated) when unusable.
 * Every accepted suggestion is stamped dataQuality "PREDICTED".
 */
export function validateLanderSuggestionsShape(
  obj: unknown
): LanderSuggestion[] {
  if (!isRecord(obj)) throw new AiError("suggestions: expected JSON object");
  const texts =
    asSuggestionTexts(obj["suggestions"]) ??
    asSuggestionTexts(obj["Suggestions"]);
  if (!texts) throw new AiError("suggestions: expected non-empty array");
  return texts
    .slice(0, 5)
    .map((text) => ({ text, dataQuality: "PREDICTED" as const }));
}
