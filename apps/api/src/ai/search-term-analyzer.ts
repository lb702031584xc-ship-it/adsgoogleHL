/**
* 自动化套件 2/5 — 搜索词自动否词 (search term miner): LLM analyzer.
*
* Pure prompt / validation logic plus chunked batched calls (at most
* MAX_SEARCH_TERMS_PER_CALL terms per LLM request). This module never
* touches the DB or reads settings — the route layer supplies the LLM
* credentials (ChatJsonArgs built from AI settings). `chatJsonImpl` is
* injectable for unit tests.
*/
import {
AiError,
chatJson,
chatJsonValidated,
type ChatJsonArgs,
} from "./llm.js";

export type SearchTermSuggestedAction =
| "ADD_NEGATIVE_EXACT"
| "ADD_NEGATIVE_PHRASE"
| "IGNORE";

export interface SearchTermAnalysis {
searchTerm: string;
suggestedAction: SearchTermSuggestedAction;
reason: string;
}

export interface SearchTermAnalysisContext {
/** Campaign the search terms came from (helps relevance judgment). */
campaignName?: string;
/** What the campaign promotes, e.g. "电商返利 offer" — sharpens relevance. */
offerHint?: string;
lang?: "zh" | "en";
}

/** One LLM call handles at most this many search terms. */
export const MAX_SEARCH_TERMS_PER_CALL = 50;

/** Reason strings must be concrete — reject lazy one-liners at the boundary. */
export const MIN_REASON_LENGTH = 10;

const ACTIONS: readonly SearchTermSuggestedAction[] = [
"ADD_NEGATIVE_EXACT",
"ADD_NEGATIVE_PHRASE",
"IGNORE",
];

const SEARCH_TERM_SPEC = `{
"items": [
{
"searchTerm": "<原搜索词，原样返回>",
"suggestedAction": "ADD_NEGATIVE_EXACT | ADD_NEGATIVE_PHRASE | IGNORE",
"reason": "<具体理由，见下方“禁止空话”条款>"
}
]
}`;

function normalizeTerm(value: string): string {
return value.toLowerCase().trim().replace(/\s+/g, " ");
}

export function buildSearchTermPrompt(
terms: string[],
context: SearchTermAnalysisContext = {}
): { system: string; user: string} {
const lang = context.lang?? "zh";
const zhOut = lang === "zh";
const system =
"你是联盟营销（affiliate arbitrage）投放的搜索词分析专家。用户通过 Google Ads 为联盟 offer（电商/返利/试用类推广）买量，流量导向商家直链赚取佣金。你的任务：逐条判断搜索词是否值得保留，并给出否词建议，返回 STRICT JSON，格式如下：\n" +
`${SEARCH_TERM_SPEC}\n` +
"判定规则：\n" +
"- ADD_NEGATIVE_EXACT：该词本身明显与 offer 无关、几乎不可能转化。典型：招聘/求职类（jobs、招聘、career、hiring）、免费/盗版类（free download、破解、torrent）、DIY 教程/维修类（how to fix、教程、维修）、色情、与品类完全无关的词。精确否词只屏蔽该词本身，误伤最小，优先使用。\n" +
"- ADD_NEGATIVE_PHRASE：无关意图附着在某个子串上且存在大量变体时使用，例如词中含“二手”“招聘”“维修教程”“免费下载”——词组否词可一次性拦截同类变体。\n" +
"- IGNORE：与 offer 相关或购买意图明确（品牌词、品类词、比价、测评、优惠券/折扣码）→ 保留。注意：商家品牌词和品类核心词即使意图模糊也不要否掉，宁可保留人工复核；拿不准的词一律 IGNORE。\n" +
"- 禁止输出“该词不相关”“建议否掉”这类空话。reason 必须写明：命中的具体规则 + 为什么无转化可能。例如：“命中规则：词含 'warehouse jobs'，offer 为电商返利，求职流量无购买转化可能，故精确否词”。\n" +
"- 每个输入的搜索词都必须在 items 里出现一次（原样返回 searchTerm）。\n" +
"- 只返回 JSON，不要 markdown 代码块，不要任何解释文字。";

const numbered = terms
.map((t, i) => `${i + 1}. ${t}`)
.join("\n");
const user =
`搜索词列表（共 ${terms.length} 个）：\n${numbered}\n` +
(context.campaignName
? `投放系列：${context.campaignName}\n`
: "") +
(context.offerHint? `推广内容：${context.offerHint}\n`: "") +
(zhOut? "请用中文输出 reason。": "Please output reason in English.");

return { system, user};
}

function isRecord(v: unknown): v is Record<string, unknown> {
return typeof v === "object" && v!== null &&!Array.isArray(v);
}

/**
* Strict validator for the search-term payload. Throws AiError (→ one guided
* retry via chatJsonValidated) when the shape is unusable. Every item must
* carry a concrete reason (see MIN_REASON_LENGTH) — this is the boundary that
* enforces the “禁止空话” rule instead of trusting the prompt alone.
*/
export function validateSearchTermShape(obj: unknown): SearchTermAnalysis[] {
if (!isRecord(obj)) throw new AiError("items: expected JSON object");
const raw = obj["items"]?? obj["Items"];
if (!Array.isArray(raw) || raw.length === 0) {
throw new AiError("items: expected non-empty array");
}
return raw.map((entry, i) => {
if (!isRecord(entry)) {
throw new AiError(`items[${i}]: expected object`);
}
const searchTerm =
typeof entry["searchTerm"] === "string"
? entry["searchTerm"].trim()
: "";
if (!searchTerm) {
throw new AiError(`items[${i}].searchTerm: expected non-empty string`);
}
const action = entry["suggestedAction"];
if (typeof action!== "string" ||!ACTIONS.includes(action as SearchTermSuggestedAction)) {
throw new AiError(
`items[${i}].suggestedAction: expected one of ${ACTIONS.join(" | ")}`
);
}
const reason =
typeof entry["reason"] === "string"? entry["reason"].trim(): "";
if (reason.length < MIN_REASON_LENGTH) {
throw new AiError(
`items[${i}].reason: too short — must name the rule hit and why the term cannot convert (≥${MIN_REASON_LENGTH} chars)`
);
}
return {
searchTerm,
suggestedAction: action as SearchTermSuggestedAction,
reason,
};
});
}

const MISSING_TERM_REASON_ZH =
"模型未返回该词，默认保留以免误杀（请人工复核）。";
const MISSING_TERM_REASON_EN =
"Model did not return this term; kept by default to avoid false negatives (manual review recommended).";

/**
* Analyze search terms in chunks of ≤ MAX_SEARCH_TERMS_PER_CALL. Terms the
* model drops from its response are conservatively kept (IGNORE) rather than
* treated as negative — a missing row must never become a false negative.
*/
export async function analyzeSearchTerms(
terms: string[],
llm: ChatJsonArgs,
context: SearchTermAnalysisContext & {
chatJsonImpl?: typeof chatJson;
} = {}
): Promise<SearchTermAnalysis[]> {
const clean = terms.map((t) => t.trim()).filter(Boolean);
const { chatJsonImpl = chatJson,...promptContext} = context;
const missingReason =
promptContext.lang === "en"? MISSING_TERM_REASON_EN: MISSING_TERM_REASON_ZH;

const out: SearchTermAnalysis[] = [];
for (let i = 0; i < clean.length; i += MAX_SEARCH_TERMS_PER_CALL) {
const chunk = clean.slice(i, i + MAX_SEARCH_TERMS_PER_CALL);
const { system, user} = buildSearchTermPrompt(chunk, promptContext);
const items = await chatJsonValidated(
{...llm, system, user},
validateSearchTermShape,
chatJsonImpl
);
const byKey = new Map<string, SearchTermAnalysis>();
for (const item of items) {
byKey.set(normalizeTerm(item.searchTerm), item);
}
for (const term of chunk) {
const hit = byKey.get(normalizeTerm(term));
out.push(
hit?? {
searchTerm: term,
suggestedAction: "IGNORE",
reason: missingReason,
}
);
}
}
return out;
}
