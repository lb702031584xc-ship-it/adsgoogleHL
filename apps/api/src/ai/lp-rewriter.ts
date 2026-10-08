/**
 * LP AI Rewriter (automation round 2) — prompt builder, strict-JSON
 * validator, and the deterministic before→after text applier.
 *
 * The LLM produces per-issue "改写前 → 改写后" pairs. Nothing here touches
 * I/O: the route layer supplies the page content and issues, calls
 * `chatJsonValidated` (same pattern as lander-analyzer's suggestions), and
 * re-scores the rewritten HTML with the existing `analyzeLander` — the
 * scorer is never re-implemented here.
 */
import { AiError } from "./llm.js";
import { analyzeLander } from "./lander-analyzer.js";
import { stripHtml } from "./fetch-page.js";

export interface LpRewriteIssue {
  dimension?: string;
  severity?: string;
  message?: string;
}

export interface LpRewrite {
  /** Which page element the rewrite targets (H1, 首屏 CTA, 价格区, ...). */
  element: string;
  /** Where on the page (首屏 H1 下方, 页脚, ...). */
  location: string;
  /** Original copy, quoted verbatim from the page text. */
  before: string;
  /** Full replacement copy — never a vague instruction. */
  after: string;
  reason: string;
}

export interface LpRewriteLlmResult {
  rewrites: LpRewrite[];
  /** The model's own optimistic guess; the route overwrites newScore with
   *  the analyzer re-run, which is the recorded estimate. */
  aiEstimatedNewScore: number;
}

export interface BuildRewritePromptInput {
  pageName: string;
  pageUrl: string;
  /** Plain-text excerpt of the page (visible copy, no tags). */
  pageText: string;
  issues: LpRewriteIssue[];
  lang: "zh" | "en";
}

const REWRITE_SPEC = `{
  "rewrites": [
    {
      "element": "<改写的元素，如 H1 / 首屏 CTA 按钮 / 价格区>",
      "location": "<页面位置，如 首屏 H1 下方 / 页脚>",
      "before": "<逐字引用的原文，必须是下方页面文本中真实出现的片段>",
      "after": "<完整的替换文案，直接可用>",
      "reason": "<为什么这样改，40 字以内>"
    }
  ],
  "estimatedNewScore": 85
}`;

export const MAX_REWRITES = 10;

export function buildRewritePrompt(
  input: BuildRewritePromptInput
): { system: string; user: string } {
  const zh = input.lang !== "en";
  const issueLines = input.issues.map(
    (i, idx) =>
      `${idx + 1}. [${i.severity ?? "medium"} · ${i.dimension ?? "unknown"}] ${
        i.message ?? ""
      }`
  );

  const system =
    (zh
      ? "你是落地页转化率优化专家，擅长逐字改写页面文案。输入是某落地页的可见文案和该页的 6 维检测问题清单。\n" +
        "请针对每条问题给出「改写前 → 改写后」对照，返回 STRICT JSON，格式如下：\n"
      : "You are a landing-page conversion copywriter. Input is a page's visible copy plus its detected issue list.\n" +
        "For every issue give a before → after rewrite. Return STRICT JSON in this shape:\n") +
    `${REWRITE_SPEC}\n` +
    (zh
      ? "规则：\n" +
        "- 禁止空话：不许输出「优化标题」「提升信任感」这类没有文案的建议。每条 rewrite 的 after 必须是可直接替换上线的完整文案。\n" +
        "- before 必须逐字引用下方页面文本中真实出现的片段（可复制粘贴，不要臆造）。改写只改文案，不改 HTML 结构。\n" +
        "- 每条 rewrite 只解决一个问题；location 写清楚页面位置。最多 10 条。\n" +
        "- estimatedNewScore 是你对改写后总分（0-100）的保守估计。\n" +
        "- 只返回 JSON，不要 markdown 代码块，不要任何解释文字。"
      : "Rules:\n" +
        "- No fluff: never output instructions like \"optimize the headline\" without actual copy. Every rewrite's `after` must be complete, publish-ready copy.\n" +
        "- `before` must quote a fragment that appears verbatim in the page text below (copy-paste it, do not invent). Rewrite copy only, never HTML structure.\n" +
        "- One issue per rewrite; name the page location precisely. At most 10 rewrites.\n" +
        "- estimatedNewScore is your conservative 0-100 estimate of the rewritten total score.\n" +
        "- Return JSON only — no markdown fences, no commentary.");

  const user =
    (zh ? "落地页名称：" : "Page name: ") +
    (input.pageName || "(无)") +
    "\n" +
    (zh ? "URL：" : "URL: ") +
    (input.pageUrl || "(无)") +
    "\n" +
    (zh ? "页面文本（可见文案）：\n" : "Page text (visible copy):\n") +
    (input.pageText || "(空)") +
    "\n" +
    (zh ? "问题清单：\n" : "Issues:\n") +
    (issueLines.length > 0 ? issueLines.join("\n") : "(无)") +
    "\n" +
    (zh ? "请用中文输出。" : "Please output in English.");

  return { system, user };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asNonEmptyString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

/**
 * Strict-ish validator for the rewrite payload (same style as
 * prompts.ts validators). Throws AiError → one guided retry via
 * chatJsonValidated. Accepts an optional `rewrites`/`Rewrites` key and
 * optional `reason`; everything else is required.
 */
export function validateRewriteShape(obj: unknown): LpRewriteLlmResult {
  if (!isRecord(obj)) throw new AiError("rewrite: expected JSON object");
  const rawList =
    (Array.isArray(obj["rewrites"]) ? obj["rewrites"] : undefined) ??
    (Array.isArray(obj["Rewrites"]) ? obj["Rewrites"] : undefined);
  if (!rawList || rawList.length === 0)
    throw new AiError("rewrite: expected non-empty rewrites array");
  if (rawList.length > MAX_REWRITES)
    throw new AiError(`rewrite: at most ${MAX_REWRITES} rewrites`);

  const rewrites: LpRewrite[] = [];
  for (let idx = 0; idx < rawList.length; idx += 1) {
    const item = rawList[idx];
    if (!isRecord(item))
      throw new AiError(`rewrite: rewrites[${idx}] must be an object`);
    const element = asNonEmptyString(item["element"]);
    const location = asNonEmptyString(item["location"]);
    const before = asNonEmptyString(item["before"]);
    const after = asNonEmptyString(item["after"]);
    if (!element || !location || !before || !after)
      throw new AiError(
        `rewrite: rewrites[${idx}] needs non-empty element/location/before/after`
      );
    const reasonRaw = item["reason"];
    rewrites.push({
      element,
      location,
      before,
      after,
      reason:
        typeof reasonRaw === "string" ? reasonRaw.trim() : "",
    });
  }

  const scoreRaw =
    typeof obj["estimatedNewScore"] === "number"
      ? obj["estimatedNewScore"]
      : typeof obj["estimated_new_score"] === "number"
        ? obj["estimated_new_score"]
        : undefined;
  if (
    scoreRaw === undefined ||
    !Number.isFinite(scoreRaw) ||
    scoreRaw < 0 ||
    scoreRaw > 100
  )
    throw new AiError("rewrite: estimatedNewScore must be a number 0-100");

  return { rewrites, aiEstimatedNewScore: Math.round(scoreRaw) };
}

export interface AppliedRewriteReport {
  /** HTML with the matched before→after substitutions applied. */
  html: string;
  applied: number;
  skipped: Array<{ element: string; reason: string }>;
}

/**
 * Deterministic textual apply: replace each rewrite's `before` with `after`
 * inside the HTML. A rewrite is applied only when its `before` appears
 * exactly once — zero matches (stale quote) or multiple matches
 * (ambiguous) are skipped and reported, never guessed.
 */
export function applyRewritesToHtml(
  html: string,
  rewrites: LpRewrite[]
): AppliedRewriteReport {
  let out = html;
  let applied = 0;
  const skipped: AppliedRewriteReport["skipped"] = [];

  for (const r of rewrites) {
    const before = r.before;
    if (!before) {
      skipped.push({ element: r.element, reason: "empty before text" });
      continue;
    }
    let count = 0;
    let pos = 0;
    while (true) {
      const idx = out.indexOf(before, pos);
      if (idx === -1) break;
      count += 1;
      pos = idx + before.length;
      if (count > 1) break;
    }
    if (count === 0) {
      skipped.push({ element: r.element, reason: "before text not found" });
      continue;
    }
    if (count > 1) {
      skipped.push({
        element: r.element,
        reason: "before text matches multiple locations, skipped as ambiguous",
      });
      continue;
    }
    out = out.replace(before, r.after);
    applied += 1;
  }

  return { html: out, applied, skipped };
}

/**
 * Re-score rewritten HTML with the existing analyzer (never re-implemented
 * scoring here). `fetchMs` is unknown for rewritten content — 0 keeps the
 * performance dimension neutral.
 */
export function rescoreRewrittenHtml(html: string): number {
  return analyzeLander(html, 0).overallScore;
}

/** Visible-copy excerpt the LLM quotes `before` fragments from. */
export function pageTextExcerpt(html: string, maxChars = 4000): string {
  return stripHtml(html).slice(0, maxChars);
}
