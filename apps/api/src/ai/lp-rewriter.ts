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

/** Rewrite conditions supplied by the rewrite workbench UI. */
export interface RewriteRequirements {
  /** Who the copy speaks to, e.g. "25-35 岁新手妈妈". */
  targetAudience?: string;
  /** Core selling points, one per entry. */
  sellingPoints?: string[];
  /** professional | friendly | urgent | humorous | authoritative | concise */
  tone?: string;
  ctaText?: string;
  discountInfo?: string;
  seoKeywords?: string;
  language?: "zh" | "en";
  /** short | medium | long */
  length?: string;
}

export interface BuildRequirementsRewritePromptInput {
  pageName: string;
  pageUrl: string;
  /** Plain-text excerpt of the page (visible copy, no tags). */
  pageText: string;
  requirements: RewriteRequirements;
}

const TONE_GUIDANCE: Record<string, { zh: string; en: string }> = {
  professional: {
    zh: "专业严谨：用数据和事实说话，避免夸张修辞",
    en: "Professional and rigorous: lead with data and facts, avoid hype",
  },
  friendly: {
    zh: "亲切自然：像朋友聊天一样，拉近距离",
    en: "Friendly and conversational: write like talking to a friend",
  },
  urgent: {
    zh: "紧迫促销：强调限时、稀缺，推动立刻行动",
    en: "Urgent and promotional: stress limited time and scarcity, push immediate action",
  },
  humorous: {
    zh: "幽默风趣：适度玩笑，读起来轻松不油腻",
    en: "Humorous: light jokes, fun to read without being cheesy",
  },
  authoritative: {
    zh: "权威可信：专家口吻，强调背书与依据",
    en: "Authoritative: expert voice, emphasize credentials and evidence",
  },
  concise: {
    zh: "简洁有力：短句为主，删掉一切废话",
    en: "Concise and punchy: short sentences, zero fluff",
  },
};

const LENGTH_GUIDANCE: Record<string, { zh: string; en: string }> = {
  short: {
    zh: "精简篇幅：每处改写后文案尽量短，抓核心卖点",
    en: "Keep it short: rewritten copy should be terse, lead with the core selling point",
  },
  medium: {
    zh: "中等篇幅：信息完整但不啰嗦",
    en: "Medium length: complete information without rambling",
  },
  long: {
    zh: "详细篇幅：充分展开卖点、细节与信任背书",
    en: "Long form: fully expand selling points, details and trust signals",
  },
};

/**
 * Requirements-driven rewrite prompt (rewrite workbench): the user describes
 * WHO the copy is for and HOW it should sound instead of fixing analyzer
 * issues. Output shape is the same strict JSON as buildRewritePrompt, so the
 * route layer reuses the validator, the deterministic applier and rescoring.
 */
export function buildRequirementsRewritePrompt(
  input: BuildRequirementsRewritePromptInput
): { system: string; user: string } {
  const req = input.requirements ?? {};
  const zh = req.language !== "en";
  const toneKey = (req.tone ?? "").toLowerCase();
  const lengthKey = (req.length ?? "").toLowerCase();
  const toneGuide = TONE_GUIDANCE[toneKey];
  const lengthGuide = LENGTH_GUIDANCE[lengthKey];

  const reqLines: string[] = [];
  if (req.targetAudience?.trim())
    reqLines.push(
      (zh ? "目标受众：" : "Target audience: ") + req.targetAudience.trim()
    );
  const points = (req.sellingPoints ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (points.length > 0)
    reqLines.push(
      (zh ? "核心卖点：\n" : "Key selling points:\n") +
        points.map((p, i) => `${i + 1}. ${p}`).join("\n")
    );
  if (toneGuide)
    reqLines.push((zh ? "语气风格：" : "Tone: ") + (zh ? toneGuide.zh : toneGuide.en));
  if (req.ctaText?.trim())
    reqLines.push(
      (zh ? "CTA 文案（改写后的按钮请使用它）： " : "CTA copy (use it for rewritten buttons): ") +
        req.ctaText.trim()
    );
  if (req.discountInfo?.trim())
    reqLines.push(
      (zh ? "折扣信息（自然融入价格区/紧迫感文案）：" : "Discount info (weave into price/urgency copy): ") +
        req.discountInfo.trim()
    );
  if (req.seoKeywords?.trim())
    reqLines.push(
      (zh ? "SEO 关键词（自然融入标题与正文，不要堆砌）：" : "SEO keywords (weave naturally into headings/body, no stuffing): ") +
        req.seoKeywords.trim()
    );
  if (lengthGuide)
    reqLines.push(
      (zh ? "篇幅要求：" : "Length: ") + (zh ? lengthGuide.zh : lengthGuide.en)
    );

  const system =
    (zh
      ? "你是落地页转化率优化专家，擅长按甲方要求逐字改写页面文案。输入是某落地页的可见文案和一份改写要求清单。\n" +
        "请按要求给出「改写前 → 改写后」对照，返回 STRICT JSON，格式如下：\n"
      : "You are a landing-page conversion copywriter. Input is a page's visible copy plus a rewrite brief.\n" +
        "Rewrite the copy according to the brief and return STRICT JSON in this shape:\n") +
    `${REWRITE_SPEC}\n` +
    (zh
      ? "规则：\n" +
        "- 覆盖页面关键位置：H1 主标题、首屏副标题/信任背书、价格区、CTA 按钮、FAQ（如有）。每条 rewrite 只改一处。\n" +
        "- before 必须逐字引用下方页面文本中真实出现的片段（可复制粘贴，不要臆造）。只改文案，不改 HTML 结构。\n" +
        "- after 必须是完整可直接上线的文案：融入目标受众的语言、核心卖点和指定语气；CTA 按钮改写必须使用甲方给的 CTA 文案。\n" +
        "- 最多 10 条；没有必要改的地方不要硬凑。\n" +
        "- estimatedNewScore 是你对改写后总分（0-100）的保守估计。\n" +
        "- 只返回 JSON，不要 markdown 代码块，不要任何解释文字。"
      : "Rules:\n" +
        "- Cover the key spots: H1, hero subhead/trust line, price block, CTA buttons, FAQ (if present). One spot per rewrite.\n" +
        "- `before` must quote a fragment that appears verbatim in the page text below (copy-paste it, do not invent). Rewrite copy only, never HTML structure.\n" +
        "- `after` must be complete, publish-ready copy: speak the audience's language, weave in the selling points and the requested tone; rewritten buttons MUST use the CTA copy from the brief.\n" +
        "- At most 10 rewrites; skip spots that don't need changes.\n" +
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
    (zh ? "改写要求：\n" : "Rewrite brief:\n") +
    (reqLines.length > 0 ? reqLines.join("\n") : "(无)") +
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

const KNOWN_TONES = [
  "professional",
  "friendly",
  "urgent",
  "humorous",
  "authoritative",
  "concise",
];
const KNOWN_LENGTHS = ["short", "medium", "long"];

function reqString(
  r: Record<string, unknown>,
  key: string,
  max: number
): string | undefined {
  const v = r[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string")
    throw new AiError(`requirements.${key} must be a string`);
  const t = v.trim();
  if (!t) return undefined;
  if (t.length > max)
    throw new AiError(`requirements.${key} is too long (max ${max} chars)`);
  return t;
}

/**
 * Validate the rewrite-workbench condition form payload (pure, no I/O).
 * Throws AiError on shape violations; returns undefined when the payload is
 * absent so callers can distinguish "not provided" from "provided".
 */
export function parseRewriteRequirements(
  v: unknown
): RewriteRequirements | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v))
    throw new AiError("requirements must be an object");
  const r = v as Record<string, unknown>;
  const sellingPointsRaw = r["sellingPoints"];
  let sellingPoints: string[] | undefined;
  if (sellingPointsRaw !== undefined && sellingPointsRaw !== null) {
    if (!Array.isArray(sellingPointsRaw))
      throw new AiError("requirements.sellingPoints must be an array");
    sellingPoints = sellingPointsRaw
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12);
    for (const p of sellingPoints) {
      if (p.length > 200)
        throw new AiError(
          "requirements.sellingPoints items are too long (max 200 chars)"
        );
    }
    if (sellingPoints.length === 0) sellingPoints = undefined;
  }
  const tone = reqString(r, "tone", 30);
  if (tone && !KNOWN_TONES.includes(tone.toLowerCase()))
    throw new AiError(
      `requirements.tone must be one of ${KNOWN_TONES.join("|")}`
    );
  const length = reqString(r, "length", 20);
  if (length && !KNOWN_LENGTHS.includes(length.toLowerCase()))
    throw new AiError(
      `requirements.length must be one of ${KNOWN_LENGTHS.join("|")}`
    );
  const language = reqString(r, "language", 10);
  if (language && language.toLowerCase() !== "zh" && language.toLowerCase() !== "en")
    throw new AiError('requirements.language must be "zh" or "en"');
  return {
    targetAudience: reqString(r, "targetAudience", 200),
    sellingPoints,
    tone: tone?.toLowerCase(),
    ctaText: reqString(r, "ctaText", 100),
    discountInfo: reqString(r, "discountInfo", 200),
    seoKeywords: reqString(r, "seoKeywords", 300),
    language:
      language?.toLowerCase() === "en" ? "en" : ("zh" as "zh" | "en"),
    length: length?.toLowerCase(),
  };
}
