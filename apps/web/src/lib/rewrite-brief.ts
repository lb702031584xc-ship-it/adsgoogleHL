/**
 * Task 4 — AI rewrite workbench: pure helpers (no I/O, no server-only
 * imports) so they are unit-testable from the web vitest suite.
 */

/** Mirrors RewriteRequirements in apps/api/src/ai/lp-rewriter.ts. */
export interface RewriteRequirements {
  targetAudience?: string;
  sellingPoints?: string[];
  tone?: string;
  ctaText?: string;
  discountInfo?: string;
  seoKeywords?: string;
  language?: "zh" | "en";
  length?: string;
}

export const REWRITE_TONES = [
  "professional",
  "friendly",
  "urgent",
  "humorous",
  "authoritative",
  "concise",
] as const;

export const REWRITE_LENGTHS = ["short", "medium", "long"] as const;

export type RewriteValidationError = {
  field: string;
  message: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Validate the workbench condition form. Returns the normalized payload
 * (empty strings dropped, lists trimmed) or the list of problems.
 */
export function validateRewriteBrief(input: {
  targetAudience?: unknown;
  sellingPoints?: unknown;
  tone?: unknown;
  ctaText?: unknown;
  discountInfo?: unknown;
  seoKeywords?: unknown;
  language?: unknown;
  length?: unknown;
}): { ok: true; data: RewriteRequirements } | { ok: false; errors: RewriteValidationError[] } {
  const errors: RewriteValidationError[] = [];
  const checkLen = (field: string, value: string, max: number) => {
    if (value.length > max)
      errors.push({ field, message: `${field} 最多 ${max} 个字符` });
  };

  const targetAudience = str(input.targetAudience);
  checkLen("targetAudience", targetAudience, 200);

  let sellingPoints: string[] | undefined;
  if (Array.isArray(input.sellingPoints)) {
    sellingPoints = input.sellingPoints
      .map(str)
      .filter(Boolean)
      .slice(0, 12);
    for (const p of sellingPoints) checkLen("sellingPoints", p, 200);
    if (sellingPoints.length === 0) sellingPoints = undefined;
  } else if (input.sellingPoints !== undefined && input.sellingPoints !== null) {
    errors.push({ field: "sellingPoints", message: "sellingPoints 必须是数组" });
  }

  const tone = str(input.tone).toLowerCase();
  if (tone && !(REWRITE_TONES as readonly string[]).includes(tone)) {
    errors.push({
      field: "tone",
      message: `tone 必须是 ${REWRITE_TONES.join(" / ")} 之一`,
    });
  }

  const ctaText = str(input.ctaText);
  checkLen("ctaText", ctaText, 100);
  const discountInfo = str(input.discountInfo);
  checkLen("discountInfo", discountInfo, 200);
  const seoKeywords = str(input.seoKeywords);
  checkLen("seoKeywords", seoKeywords, 300);

  const language = str(input.language).toLowerCase();
  if (language && language !== "zh" && language !== "en") {
    errors.push({ field: "language", message: "language 必须是 zh 或 en" });
  }

  const length = str(input.length).toLowerCase();
  if (length && !(REWRITE_LENGTHS as readonly string[]).includes(length)) {
    errors.push({
      field: "length",
      message: `length 必须是 ${REWRITE_LENGTHS.join(" / ")} 之一`,
    });
  }

  // Workbench-level rule: the AI needs a direction.
  if (!targetAudience && !sellingPoints) {
    errors.push({
      field: "targetAudience",
      message: "请至少填写目标受众或一条核心卖点",
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      ...(targetAudience ? { targetAudience } : {}),
      ...(sellingPoints ? { sellingPoints } : {}),
      ...(tone ? { tone } : {}),
      ...(ctaText ? { ctaText } : {}),
      ...(discountInfo ? { discountInfo } : {}),
      ...(seoKeywords ? { seoKeywords } : {}),
      language: language === "en" ? "en" : "zh",
      ...(length ? { length } : {}),
    },
  };
}

/** Default form state for the workbench. */
export function defaultRewriteBrief(): {
  targetAudience: string;
  sellingPoints: string[];
  tone: string;
  ctaText: string;
  discountInfo: string;
  seoKeywords: string;
  language: "zh" | "en";
  length: string;
} {
  return {
    targetAudience: "",
    sellingPoints: [""],
    tone: "friendly",
    ctaText: "",
    discountInfo: "",
    seoKeywords: "",
    language: "zh",
    length: "medium",
  };
}
