"use client";

import { useState } from "react";
import Link from "next/link";
import type { AmazonPipelineDict } from "@/i18n/dict/amazon-pipeline";
import {
runAmazonDiscoveryAction,
} from "@/lib/api/amazon-actions";
import {
runPipelineAction,
type PipelineItemResult,
} from "@/lib/api/amazon-pipeline-actions";

/**
* 新手模式（第六批）：只问 3 个问题 → 系统按预算反推可行价格带 → 自动跑流水线 → 输出 top 3。
*
* 预算数学（公式透明，写在页面上）：
* - 假设 CPC $1.00（固定假设，页面明示）
* - 日点击数 ≈ 预算 ÷ CPC
* - 为使盈亏平衡转化率 ≤ 15%，单均佣金需 ≥ CPC ÷ 15%
* - 按 Amazon 类目佣金率"估算值" → 建议最低价格 = 所需佣金 ÷ 佣金率
* - 止损线：单品花费 ≥ 3 × 预估佣金 且 0 转化 → 暂停
*
* 测试包：落地页模板推荐（链到现有模板库）+ 确定性广告文案草稿（非 LLM，需人工优化）
* + 止损线。不重写现有模板/launch 能力，只复用与链接。
*/

export type NoviceDict = AmazonPipelineDict["novice"];

interface Category {
id: string;
zh: string;
en: string;
keywords: string;
/** Amazon 佣金率估算值（页面明确标注"估算值"）。 */
rate: number;
}

const CATEGORIES: Category[] = [
{ id: "home", zh: "家居", en: "Home", keywords: "home organization storage", rate: 0.04},
{ id: "electronics", zh: "电子", en: "Electronics", keywords: "bluetooth speaker smart home", rate: 0.04},
{ id: "outdoor", zh: "户外", en: "Outdoor", keywords: "camping hiking outdoor gear", rate: 0.04},
{ id: "beauty", zh: "美妆个护", en: "Beauty", keywords: "skincare beauty tools", rate: 0.04},
{ id: "pet", zh: "宠物", en: "Pet", keywords: "pet supplies dog cat", rate: 0.04},
{ id: "baby", zh: "母婴", en: "Baby", keywords: "baby essentials", rate: 0.04},
{ id: "sports", zh: "运动健身", en: "Sports & fitness", keywords: "fitness resistance bands", rate: 0.04},
{ id: "kitchen", zh: "厨房", en: "Kitchen", keywords: "kitchen gadgets", rate: 0.045},
];

const ASSUMED_CPC = 1.0;
const MAX_BE_CVR = 0.15;

export function NoviceMode({ dict: d, lang}: { dict: NoviceDict; lang: "zh" | "en"}) {
const [budget, setBudget] = useState("30");
const [categoryId, setCategoryId] = useState("home");
const [country, setCountry] = useState("US");
const [busy, setBusy] = useState(false);
const [error, setError] = useState<string | null>(null);
const [math, setMath] = useState<null | {
dailyClicks: number;
needCommission: number;
minPrice: number;
rate: number;
categoryName: string;
}>(null);
const [top3, setTop3] = useState<PipelineItemResult[]>([]);

const category = CATEGORIES.find((c) => c.id === categoryId)?? CATEGORIES[0]!;

async function onStart() {
const b = Number(budget);
if (!Number.isFinite(b) || b <= 0) {
setError(d.qBudgetHint);
return;
}
setBusy(true);
setError(null);
setTop3([]);
try {
// 1. 预算数学
const dailyClicks = Math.floor(b / ASSUMED_CPC);
const needCommission = ASSUMED_CPC / MAX_BE_CVR;
const minPrice = Math.ceil(needCommission / category.rate);
setMath({
dailyClicks,
needCommission: Math.round(needCommission * 100) / 100,
minPrice,
rate: category.rate,
categoryName: lang === "en"? category.en: category.zh,
});

// 2. 自动选品（复用 discovery）
const disc = await runAmazonDiscoveryAction({
keywords: category.keywords.split(" "),
minPrice,
maxPrice: 500,
minRating: 4.0,
minReviews: 100,
region: country,
});
if (!disc.ok) {
setError(`${d.discoverFailed}：${disc.error}`);
return;
}
const candidates = [...disc.data.products]
.sort((a, b2) => b2.score - a.score)
.slice(0, 5);
if (candidates.length === 0) {
setError(d.noProducts);
return;
}

// 3. 自动跑流水线
const pr = await runPipelineAction(
candidates.map((p) => ({
asin: p.asin,
title: p.title,
brand: p.brand?? undefined,
detailPageUrl: p.detailPageUrl,
price: p.price?? undefined,
rating: p.rating?? undefined,
reviewCount: p.reviewCount?? undefined,
})),
{
estimatedCpc: ASSUMED_CPC,
commission: needCommission,
country,
riskCheck: false,
},
`novice-${category.id}-${country}`
);
if (!pr.ok) {
setError(`${d.pipelineFailed}：${pr.error}`);
return;
}
setTop3(pr.data.items.filter((i) =>!i.killed).slice(0, 3));
} finally {
setBusy(false);
}
}

function adDraft(title: string, brand?: string): string[] {
const short = title.length > 40? `${title.slice(0, 40)}…`: title;
return [
`${brand? ``: ""}${short}`,
`Top Rated ${category.zh} 2026`,
`${short} - Honest Review`,
];
}

return (
<section className="rounded-xl border-2 border-amber-200 bg-amber-50/50 p-5">
<h2 className="text-base font-semibold text-ink">{d.title}</h2>
<p className="mt-1 text-sm text-ink/60">{d.description}</p>

<div className="mt-3 grid gap-3 md:grid-cols-3">
<div>
<label className="mb-1 block text-xs text-ink/60">{d.qBudget}</label>
<input
className="w-full rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink"
value={budget}
onChange={(e) => setBudget(e.target.value)}
inputMode="decimal"
/>
<p className="mt-1 text-xs text-ink/50">{d.qBudgetHint}</p>
</div>
<div>
<label className="mb-1 block text-xs text-ink/60">{d.qCategory}</label>
<select
className="w-full rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink"
value={categoryId}
onChange={(e) => setCategoryId(e.target.value)}
>
{CATEGORIES.map((c) => (
<option key={c.id} value={c.id}>
{lang === "en"? c.en: c.zh}
</option>
))}
</select>
</div>
<div>
<label className="mb-1 block text-xs text-ink/60">{d.qCountry}</label>
<select
className="w-full rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink"
value={country}
onChange={(e) => setCountry(e.target.value)}
>
{["US", "UK", "DE", "FR", "IT", "ES", "CA", "AU", "JP"].map((c) => (
<option key={c} value={c}>
{c}
</option>
))}
</select>
</div>
</div>

<button
type="button"
className="mt-3 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
disabled={busy}
onClick={onStart}
>
{busy? d.starting: d.start}
</button>
{error? <p className="mt-2 text-sm text-red-600">{error}</p>: null}

{math? (
<div className="mt-3 rounded-lg bg-white p-3 text-xs text-ink/70">
<p className="font-medium text-ink/80">{d.mathTitle}</p>
<ul className="mt-1 list-disc space-y-0.5 pl-4">
<li>{d.mathLine1.replace("{clicks}", String(math.dailyClicks))}</li>
<li>{d.mathLine2.replace("{commission}", math.needCommission.toFixed(2))}</li>
<li>
{d.mathLine3
.replace("{price}", String(math.minPrice))
.replace("{rate}", String(Math.round(math.rate * 100)))}
</li>
<li>{d.mathLine4.replace("{category}", math.categoryName)}</li>
</ul>
<p className="mt-1 text-ink/50">{d.rateNote}</p>
</div>
): null}

{top3.length > 0? (
<div className="mt-4">
<h3 className="text-sm font-semibold text-ink">{d.top3Title}</h3>
<div className="mt-2 grid gap-3 md:grid-cols-3">
{top3.map((item, i) => {
const price = item.input.price?? 0;
const estCommission = price * category.rate;
const stopLoss = estCommission > 0? (3 * estCommission).toFixed(2): "—";
return (
<div key={i} className="rounded-lg border border-ink/10 bg-white p-3">
<p className="text-xs font-bold text-emerald-700">
TOP {i + 1} · {item.worthIndex}
</p>
<p className="mt-1 text-sm font-medium text-ink">{item.input.title}</p>
{item.input.asin? (
<p className="text-xs text-ink/50">{item.input.asin}</p>
): null}
<div className="mt-2 text-xs text-ink/70">
<p className="font-medium text-ink/80">{d.testPackage}</p>
<p className="mt-1">
<span className="font-medium">{d.landerTitle}：</span>
{d.landerBody}{" "}
<Link href="/landing-pages/templates" className="text-signal hover:underline">
→
</Link>
</p>
<p className="mt-1">
<span className="font-medium">{d.adCopyTitle}：</span>
</p>
<ul className="list-disc pl-4">
{adDraft(item.input.title, item.input.brand).map((h, j) => (
<li key={j}>{h}</li>
))}
</ul>
<p className="mt-1 text-ink/50">{d.adCopyNote}</p>
<p className="mt-1">
<span className="font-medium">{d.stopLossTitle}：</span>
{d.stopLossBody.replace("{amount}", String(stopLoss))}
</p>
</div>
</div>
);
})}
</div>
</div>
): null}
</section>
);
}
