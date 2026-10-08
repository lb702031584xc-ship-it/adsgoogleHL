/**
 * Feature: 返利落地页合规评分 (lp-cashback-score).
 *
 * Pure, deterministic scorer for cashback landing pages. No LLM, no I/O.
 * Builds on the HTML stored on LandingPage.htmlContent but does NOT touch
 * the existing landing-page analyzer — this module is standalone.
 *
 * Score model (start at 100, subtract penalties, clamp to 0..100):
 *
 *  1. 实质内容检查 (substantive content)
 *     - no extractable body text            → `no_content`,      -45
 *     - body text < 200 chars               → `content_too_short`, -20
 *     - body text < 600 chars               → `content_thin`,      -8
 *     - fewer than 2 links on the page      → `too_few_links`,     -6
 *     - >= 2 links but < 20% internal
 *       (non-redirect) links while the body is thin (< 600 chars)
 *                                           → `outbound_heavy`,   -10
 *  2. disclosure 检查
 *     - none of the disclosure keywords found (affiliate disclosure /
 *       返利声明 style phrases, zh + en)    → `missing_disclosure`, -20
 *  3. 比例声明准确性 (rate claim accuracy)
 *     - page mentions percentage numbers and opts.detectedRate is set:
 *       any page % differing from detectedRate by more than 0.5pp
 *                                           → `rate_mismatch`,    -25
 *     - skipped when detectedRate is null/undefined or the page
 *       mentions no percentage.
 *  4. bridge page 风险
 *     - body text < 150 chars AND at most 2 links total
 *       (page is basically just a jump button)
 *                                           → `bridge_page_risk`, -35
 *
 * Issues are returned as stable machine codes (string[]); the web UI maps
 * them to zh/en text via apps/web/src/i18n/dict/cashback-lp-score.ts.
 */

export interface CashbackLpScoreOptions {
  /**
   * Latest detected cashback rate for the linked cashback offer, e.g. "8%"
   * or "8". When null/undefined the rate-accuracy check is skipped.
   * (The CashbackRateCheck table referenced in the feature spec does not
   * exist in this codebase yet, so callers currently pass null.)
   */
  detectedRate?: string | null;
}

export interface CashbackLpScore {
  /** 0..100, integer. */
  score: number;
  /** Stable issue codes, e.g. "missing_disclosure". Empty when clean. */
  issues: string[];
}

/** Issue codes emitted by scoreCashbackLandingPage. */
export const LP_SCORE_ISSUES = {
  NO_CONTENT: "no_content",
  CONTENT_TOO_SHORT: "content_too_short",
  CONTENT_THIN: "content_thin",
  TOO_FEW_LINKS: "too_few_links",
  OUTBOUND_HEAVY: "outbound_heavy",
  MISSING_DISCLOSURE: "missing_disclosure",
  RATE_MISMATCH: "rate_mismatch",
  BRIDGE_PAGE_RISK: "bridge_page_risk",
} as const;

const TEXT_TOO_SHORT = 200;
const TEXT_THIN = 600;
const BRIDGE_TEXT_MAX = 150;
const BRIDGE_LINKS_MAX = 2;
const RATE_TOLERANCE_PP = 0.5;

/** Disclosure phrases (lowercased matching), zh + en. */
const DISCLOSURE_KEYWORDS: ReadonlyArray<string> = [
  // English
  "affiliate disclosure",
  "we may earn a commission",
  "we earn a commission",
  "may earn commission",
  "affiliate link",
  "paid link",
  "sponsored link",
  "advertising disclosure",
  "disclosure:",
  // Chinese
  "返利声明",
  "佣金披露",
  "推广声明",
  "联盟声明",
  "我们将获得佣金",
  "可能会获得佣金",
  "可能获得佣金",
  "通过以下链接购买",
  "通过链接购买",
];

interface ExtractedLink {
  href: string;
  text: string;
  outbound: boolean;
}

function stripToText(html: string): string {
  let s = html;
  // Remove script/style/noscript/template blocks and HTML comments first.
  s = s.replace(
    /<(script|style|noscript|template)[\s>][\s\S]*?<\/\1\s*>/gi,
    " "
  );
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Prefer <body> content when present.
  const bodyMatch = /<body[\s>][\s\S]*<\/body\s*>/i.exec(s);
  const scoped = bodyMatch ? bodyMatch[0] : s;
  // Drop tags, decode a few common entities, collapse whitespace.
  const text = scoped
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

function extractLinks(html: string): ExtractedLink[] {
  const out: ExtractedLink[] = [];
  const re = /<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = (m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (!href) continue;
    const text = m[5].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const outbound = /^https?:\/\//i.test(href);
    out.push({ href, text, outbound });
  }
  return out;
}

function extractPercentages(text: string): number[] {
  const out: number[] = [];
  const re = /(\d+(?:\.\d+)?)\s*%/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 100) out.push(n);
  }
  return out;
}

function parseRate(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/%/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/**
 * Score a cashback landing page's HTML for compliance.
 * Deterministic: same input always yields the same output.
 */
export function scoreCashbackLandingPage(
  html: string,
  opts: CashbackLpScoreOptions = {}
): CashbackLpScore {
  const issues: string[] = [];
  let penalty = 0;

  const text = stripToText(html ?? "");
  const links = extractLinks(html ?? "");

  // --- 1. 实质内容检查 -------------------------------------------------
  if (text.length === 0) {
    issues.push(LP_SCORE_ISSUES.NO_CONTENT);
    penalty += 45;
    return { score: Math.max(0, 100 - penalty), issues };
  }

  if (text.length < TEXT_TOO_SHORT) {
    issues.push(LP_SCORE_ISSUES.CONTENT_TOO_SHORT);
    penalty += 20;
  } else if (text.length < TEXT_THIN) {
    issues.push(LP_SCORE_ISSUES.CONTENT_THIN);
    penalty += 8;
  }

  if (links.length < 2) {
    issues.push(LP_SCORE_ISSUES.TOO_FEW_LINKS);
    penalty += 6;
  } else {
    const internal = links.filter((l) => !l.outbound).length;
    const internalRatio = internal / links.length;
    if (internalRatio < 0.2 && text.length < TEXT_THIN) {
      issues.push(LP_SCORE_ISSUES.OUTBOUND_HEAVY);
      penalty += 10;
    }
  }

  // --- 2. disclosure 检查 ------------------------------------------------
  const lowered = text.toLowerCase();
  const hasDisclosure = DISCLOSURE_KEYWORDS.some((kw) =>
    lowered.includes(kw.toLowerCase())
  );
  if (!hasDisclosure) {
    issues.push(LP_SCORE_ISSUES.MISSING_DISCLOSURE);
    penalty += 20;
  }

  // --- 3. 比例声明准确性 ------------------------------------------------
  const detectedRate = parseRate(opts.detectedRate);
  if (detectedRate !== null) {
    const claimed = extractPercentages(text);
    const mismatch = claimed.some(
      (p) => Math.abs(p - detectedRate) > RATE_TOLERANCE_PP
    );
    if (mismatch) {
      issues.push(LP_SCORE_ISSUES.RATE_MISMATCH);
      penalty += 25;
    }
  }

  // --- 4. bridge page 风险 ----------------------------------------------
  if (text.length < BRIDGE_TEXT_MAX && links.length <= BRIDGE_LINKS_MAX) {
    issues.push(LP_SCORE_ISSUES.BRIDGE_PAGE_RISK);
    penalty += 35;
  }

  return { score: Math.max(0, Math.min(100, 100 - penalty)), issues };
}
