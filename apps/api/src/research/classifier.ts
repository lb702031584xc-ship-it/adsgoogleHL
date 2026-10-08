/**
 * Phase 4 Research Lab — differential classifier (§22).
 *
 * Eight heuristic classifiers, evaluated in priority order. Rules are
 * axis-first: a differential is only labelled benign when it is clearly
 * explained by the variant axes (geo / language / device / cookies /
 * redirects). Anything large and unexplained falls through to
 * SUSPICIOUS_CLOAKING — with explicit reasons, never a bare label.
 *
 * 差异≠恶意：every result carries the disclaimer below. A differential is a
 * research signal for human review, never proof of malicious cloaking.
 */
import { registrableDomain } from "../ai/compliance.js";
import {
  scoreDifferential,
  type DifferentialMetrics,
  type ResponseSnapshot,
} from "./detector.js";

export type CloakClassification =
  | "GEO_PERSONALIZATION"
  | "LANGUAGE_VARIATION"
  | "DEVICE_VARIATION"
  | "COOKIE_PERSONALIZATION"
  | "NORMAL_AB_TEST"
  | "REDIRECT_VARIATION"
  | "CONTENT_VARIATION"
  | "SUSPICIOUS_CLOAKING";

export const CLASSIFICATIONS: readonly CloakClassification[] = [
  "GEO_PERSONALIZATION",
  "LANGUAGE_VARIATION",
  "DEVICE_VARIATION",
  "COOKIE_PERSONALIZATION",
  "NORMAL_AB_TEST",
  "REDIRECT_VARIATION",
  "CONTENT_VARIATION",
  "SUSPICIOUS_CLOAKING",
];

/**
 * 差异≠恶意 — attached to every classification result and persisted in the
 * finding evidence.
 */
export const DIFFERENCE_DISCLAIMER =
  "差异≠恶意：本分类为启发式规则判断，差异本身不等于恶意 cloaking；结论仅供人工复核参考，不构成违规判定。";

export interface VariantDescriptor {
  name: string;
  userAgent?: string;
  acceptLanguage?: string;
}

/** A fetched response plus the variant config that produced it. */
export interface ClassifiedResponse extends ResponseSnapshot {
  userAgent?: string;
  acceptLanguage?: string;
}

export interface VariantAxes {
  device: "desktop" | "mobile" | "unknown";
  language: string | null;
  country: string | null;
}

export interface ClassificationResult {
  classification: CloakClassification;
  /** Heuristic confidence 0-1 — not a probability, just rule strength. */
  confidence: number;
  /** Human-readable rule trace; always ends with DIFFERENCE_DISCLAIMER. */
  reasons: string[];
  disclaimer: string;
  axes: { a: VariantAxes; b: VariantAxes };
}

const UNKNOWN_AXES: VariantAxes = {
  device: "unknown",
  language: null,
  country: null,
};

/** Derive geo/language/device axes from variant config (best effort). */
export function deriveAxes(v: VariantDescriptor): VariantAxes {
  const out: VariantAxes = { ...UNKNOWN_AXES };
  const ua = (v.userAgent ?? "").toLowerCase();
  if (/mobile|iphone|ipad|android/.test(ua)) out.device = "mobile";
  else if (/windows|macintosh|linux/.test(ua)) out.device = "desktop";
  else if (/mobile/i.test(v.name)) out.device = "mobile";
  else if (/desktop/i.test(v.name)) out.device = "desktop";

  // accept-language first ("de-DE,de;q=0.9" → de / DE), then name suffix ("desktop-de").
  const langTag = (v.acceptLanguage ?? "").split(",")[0]?.split(";")[0]?.trim();
  const tagMatch = /^([a-z]{2})(?:-([a-z]{2}))?$/i.exec(langTag ?? "");
  if (tagMatch) {
    out.language = tagMatch[1]!.toLowerCase();
    if (tagMatch[2]) out.country = tagMatch[2].toUpperCase();
  } else {
    const nameMatch = /-([a-z]{2})$/i.exec(v.name.trim());
    if (nameMatch) {
      out.language = nameMatch[1]!.toLowerCase();
      out.country = nameMatch[1]!.toUpperCase();
    }
  }
  return out;
}

function isOkStatus(s: number | null): boolean {
  return s !== null && s >= 200 && s < 300;
}

function isErrStatus(s: number | null): boolean {
  return s !== null && s >= 400;
}

function withinRatio(
  x: number | null,
  y: number | null,
  tolerance: number
): boolean {
  if (x === null || y === null) return true;
  if (x === 0 && y === 0) return true;
  const denom = Math.max(Math.abs(x), Math.abs(y));
  if (denom === 0) return true;
  return Math.abs(x - y) / denom <= tolerance;
}

/** Page structure similar when link/script counts are within 40%. */
function structurallySimilar(
  a: ResponseSnapshot,
  b: ResponseSnapshot
): boolean {
  return (
    withinRatio(a.linksCount, b.linksCount, 0.4) &&
    withinRatio(a.scriptsCount, b.scriptsCount, 0.4)
  );
}

/**
 * Classify one differential pair. Rules are priority-ordered; the first
 * matching rule wins. Ambiguous large differentials end at
 * SUSPICIOUS_CLOAKING with explicit reasons.
 */
export function classifyDifferential(
  a: ClassifiedResponse,
  b: ClassifiedResponse,
  metrics: DifferentialMetrics
): ClassificationResult {
  const score = scoreDifferential(metrics);
  const axA = deriveAxes({
    name: a.variantName,
    userAgent: a.userAgent,
    acceptLanguage: a.acceptLanguage,
  });
  const axB = deriveAxes({
    name: b.variantName,
    userAgent: b.userAgent,
    acceptLanguage: b.acceptLanguage,
  });
  const axes = { a: axA, b: axB };

  const countryDiffers =
    !!axA.country && !!axB.country && axA.country !== axB.country;
  const languageDiffers =
    !!axA.language && !!axB.language && axA.language !== axB.language;
  const deviceDiffers =
    axA.device !== "unknown" &&
    axB.device !== "unknown" &&
    axA.device !== axB.device;

  const finish = (
    classification: CloakClassification,
    confidence: number,
    rs: string[]
  ): ClassificationResult => ({
    classification,
    confidence,
    reasons: [...rs, DIFFERENCE_DISCLAIMER],
    disclaimer: DIFFERENCE_DISCLAIMER,
    axes,
  });

  // R0 — no measurable differential: benign by default.
  if (score === 0) {
    return finish("NORMAL_AB_TEST", 0.05, [
      `变体 ${a.variantName} 与 ${b.variantName} 返回完全一致的响应，未检测到差异`,
    ]);
  }

  // R1 — one variant succeeds, the other errors.
  if (
    metrics.statusDiff &&
    ((isOkStatus(a.httpStatus) && isErrStatus(b.httpStatus)) ||
      (isOkStatus(b.httpStatus) && isErrStatus(a.httpStatus)))
  ) {
    if (countryDiffers) {
      return finish("GEO_PERSONALIZATION", 0.6, [
        `变体 ${a.variantName}(${a.httpStatus}) 与 ${b.variantName}(${b.httpStatus}) 一次成功一次被拦截，且国家不同(${axA.country} vs ${axB.country})——符合地域封锁(geo-blocking)特征`,
      ]);
    }
    return finish("SUSPICIOUS_CLOAKING", 0.7, [
      `变体 ${a.variantName} 返回 ${a.httpStatus}，变体 ${b.variantName} 返回 ${b.httpStatus}，差异无法用地域/语言/设备解释`,
    ]);
  }

  // R2 — final URLs land on different registrable domains.
  if (metrics.finalUrlDiff && a.finalUrl && b.finalUrl) {
    let hostA = "";
    let hostB = "";
    try {
      hostA = new URL(a.finalUrl).hostname;
      hostB = new URL(b.finalUrl).hostname;
    } catch {
      /* fall through to later rules */
    }
    if (hostA && hostB) {
      const rdA = registrableDomain(hostA);
      const rdB = registrableDomain(hostB);
      if (rdA !== rdB) {
        const sldA = rdA.split(".").slice(0, -1).join(".");
        const sldB = rdB.split(".").slice(0, -1).join(".");
        if (sldA && sldA === sldB && countryDiffers) {
          return finish("GEO_PERSONALIZATION", 0.65, [
            `跳转到同一品牌的不同国家域名(${rdA} → ${rdB})，符合地域分流`,
          ]);
        }
        return finish("SUSPICIOUS_CLOAKING", 0.75, [
          `最终 URL 落到不同的注册域(${rdA} vs ${rdB})，跳转目标与变体轴无关`,
        ]);
      }
    }
  }

  // R3 — only cookie-related headers differ, content (nearly) identical.
  const cookieKeys = metrics.headerDiffKeys.filter((k) =>
    k.toLowerCase().includes("cookie")
  );
  if (
    metrics.headerDiffKeys.length > 0 &&
    cookieKeys.length === metrics.headerDiffKeys.length &&
    metrics.textSimilarity > 0.9 &&
    !metrics.statusDiff &&
    !metrics.finalUrlDiff
  ) {
    return finish("COOKIE_PERSONALIZATION", 0.7, [
      `仅 Cookie 相关响应头不同(${metrics.headerDiffKeys.join(", ")})，页面内容几乎一致——符合个性化/会话标记`,
    ]);
  }

  // R4 — redirect chain / status / final URL differ, but bytes identical.
  if (
    (metrics.statusDiff || metrics.finalUrlDiff || metrics.redirectChainDiff) &&
    metrics.htmlHashEqual
  ) {
    return finish("REDIRECT_VARIATION", 0.7, [
      "跳转链/状态码/最终 URL 不同，但 HTML 字节完全一致——仅为跳转层差异",
    ]);
  }

  // R5 — language differs, wording differs, structure similar → translation.
  if (
    languageDiffers &&
    metrics.textSimilarity < 0.95 &&
    structurallySimilar(a, b) &&
    !metrics.finalUrlDiff
  ) {
    return finish("LANGUAGE_VARIATION", 0.65, [
      `语言不同(${axA.language} vs ${axB.language})，页面结构相似、措辞不同——符合翻译/本地化`,
    ]);
  }

  // R6 — only the device differs → responsive/adaptive rendering.
  if (deviceDiffers && !languageDiffers && !countryDiffers) {
    return finish("DEVICE_VARIATION", 0.65, [
      `仅设备不同(${axA.device} vs ${axB.device})——符合移动端/桌面端适配`,
    ]);
  }

  // R7 — countries differ and content differs, no hard signals → geo.
  if (countryDiffers && !metrics.htmlHashEqual) {
    return finish("GEO_PERSONALIZATION", 0.6, [
      `国家不同(${axA.country} vs ${axB.country})，内容不同——符合地域个性化(价格/货币/文案/合规)`,
    ]);
  }

  // R8 — minor tweaks only → plausibly an A/B test.
  if (metrics.textSimilarity > 0.75) {
    return finish("NORMAL_AB_TEST", 0.5, [
      "内容高度相似，仅有小幅措辞/元素差异——符合常规 A/B 测试",
    ]);
  }

  // R9 — substantial but unexplainable → content variation, not yet suspicious.
  if (metrics.textSimilarity > 0.3) {
    return finish("CONTENT_VARIATION", 0.5, [
      "内容差异较大，但无法明确归因到地域/语言/设备/跳转轴——需人工复核",
    ]);
  }

  // R10 — ambiguous: large unexplained differential → suspicious, with reasons.
  return finish("SUSPICIOUS_CLOAKING", 0.6, [
    `内容几乎完全不同(相似度 ${metrics.textSimilarity.toFixed(2)})，且差异无法用地域/语言/设备/跳转解释——需人工复核`,
  ]);
}
