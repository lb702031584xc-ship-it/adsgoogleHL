/**
 * 卖家工具 AI 推荐（线索层，不是核实层）。
 *
 * 链路：DataForSEO SERP（公开榜单/文章标题+链接）→ 大模型综合成候选
 * → 每候选再查 1 次批发货源 SERP（优先 Alibaba / Faire / DHgate 等
 *   国外批发平台链接，只取 SERP 结果，不经模型）→ 前端“导入为待核实”，
 *   再走 Keepa 粘贴核实 + 补录成本 + 利润门。
 *
 * 硬规则（与用户定的证据口径一致）：
 * - 没有 SERP 证据就不推荐：SERP 0 条可用结果时直接返回空候选，绝不
 *   用模型知识编造候选、销量、排名、评论数（候选 schema 里根本没有这些字段）。
 * - 每条候选必须引用 ≥1 条本次 SERP 返回的 URL；引用了 SERP 之外 URL
 *   的候选直接丢弃，不修补、不猜测。
 * - priceHint 只能来自 SERP 摘要里明确写出的价格，否则 null；绝不估算。
 * - 货源链接只取货源 SERP 的 organic 结果，批发平台域名排在前面；
 *   货源链接只作询价起点，价格、起订量、运费以用户打开页面为准。
 * - 不碰亚马逊商品页、不调 Keepa API（用户无 Keepa API）、不爬取任何站点。
 * - 费用：每次推荐 =（3 条方向查询 + 每候选 1 条货源查询）× SERP_QUERY_PRICE_USD
 *   （单价唯一出处见 services/brand-ad-count.ts），返回里写明估算值，不当精确账单。
 */
import { AiError, chatJsonValidated, type ChatJsonArgs } from "./llm.js";
import { SERP_QUERY_PRICE_USD } from "../services/brand-ad-count.js";

const SERP_API_URL =
  "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";
/** DataForSEO 美国站 location_code（与 brand-ad-count.ts 同口径）。 */
const LOCATION_CODE_US = 2840;
/** 单次推荐的 SERP 查询词数（固定 3 条，费用可预估）。 */
export const RECO_SERP_QUERY_COUNT = 3;
/** 每次推荐最多返回的 SERP 来源数（喂给模型前截断，控 token 与费用）。 */
const MAX_SOURCES = 30;

export interface SerpSource {
  title: string;
  url: string;
  snippet: string;
}

export interface SourcingLink {
  title: string;
  url: string;
  /** wholesale = 国外批发/供货平台（见 WHOLESALE_DOMAINS）；other = 其他来源。 */
  kind: "wholesale" | "other";
}

export interface RecoCandidate {
  /** 具体商品类型（如“宠物除毛梳”），不是模糊类目。 */
  name: string;
  category: string;
  /** 一句话推荐理由，必须来自 SERP 摘要内容。 */
  why: string;
  /** SERP 摘要里明确写出的价格才有值，否则 null（绝不估算）。 */
  priceHint: number | null;
  /** 本次 SERP 返回的 URL 子集，≥1 条。 */
  sources: string[];
  /** 货源 SERP 结果（≤3 条，批发平台优先）；货源搜索失败时为空数组。 */
  sourcing: SourcingLink[];
}

export interface RecoResult {
  candidates: RecoCandidate[];
  sources: SerpSource[];
  queries: string[];
  /** 每候选 1 条的货源查询词（与 candidates 一一对应）。 */
  sourcingQueries: string[];
  serpCalls: number;
  serpCostEstimateUsd: number;
  warnings: string[];
}

/** DataForSEO 账号未验证（403 + verify 文案）：服务端改不了，需用户去官网验证。 */
export class DataForSeoUnverifiedError extends Error {
  constructor() {
    super("DataForSEO 账号未验证");
    this.name = "DataForSeoUnverifiedError";
  }
}

export interface RecoDeps {
  fetchImpl?: typeof fetch;
  chatJsonImpl?: (args: ChatJsonArgs) => Promise<unknown>;
  dataforseoCreds: { login: string; password: string };
  llm: { baseUrl: string; model: string; apiKey: string };
}

export function buildRecoQueries(direction: string): string[] {
  const d = direction.trim();
  return [
    `${d} best products 2026`,
    `${d} trending products`,
    `best ${d} to sell online`,
  ];
}

/** 国外批发/供货平台域名（类似阿里巴巴的 B2B 平台），货源排序时优先。 */
export const WHOLESALE_DOMAINS = [
  "alibaba.com",
  "faire.com",
  "dhgate.com",
  "globalsources.com",
  "made-in-china.com",
  "thomasnet.com",
  "wholesalecentral.com",
  "salehoo.com",
  "abound.com",
  "handshake.com",
];

/** 货源 SERP 每候选最多附的链接数。 */
export const MAX_SOURCING_LINKS = 3;

export function buildSourcingQuery(name: string): string {
  return `wholesale ${name.trim()} supplier`;
}

export function isWholesaleDomain(url: string): boolean {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return WHOLESALE_DOMAINS.some(
    (d) => host === d || host.endsWith(`.${d}`)
  );
}

/** 货源排序（纯函数）：去重 → 批发平台在前、其余在后，各组内保持 SERP 顺序 → 截断。 */
export function rankSourcing(
  items: SerpSource[],
  max: number = MAX_SOURCING_LINKS
): SourcingLink[] {
  const seen = new Set<string>();
  const wholesale: SourcingLink[] = [];
  const other: SourcingLink[] = [];
  for (const item of items) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    const link: SourcingLink = {
      title: item.title,
      url: item.url,
      kind: isWholesaleDomain(item.url) ? "wholesale" : "other",
    };
    (link.kind === "wholesale" ? wholesale : other).push(link);
  }
  return [...wholesale, ...other].slice(0, max);
}

interface SerpItem {
  type?: unknown;
  title?: unknown;
  url?: unknown;
  description?: unknown;
}

async function fetchSerpOrganic(
  fetchImpl: typeof fetch,
  creds: { login: string; password: string },
  keyword: string,
  depth = 20
): Promise<SerpSource[]> {
  const auth = Buffer.from(`${creds.login}:${creds.password}`).toString(
    "base64"
  );
  let res: Response;
  try {
    res = await fetchImpl(SERP_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          keyword,
          location_code: LOCATION_CODE_US,
          language_code: "en",
          device: "desktop",
          os: "windows",
          depth,
        },
      ]),
    });
  } catch {
    throw new Error("DataForSEO 请求失败（网络异常）");
  }
  if (!res.ok) {
    let statusMessage = "";
    try {
      const body = (await res.json()) as {
        tasks?: Array<{ status_message?: string }>;
      };
      statusMessage = body?.tasks?.[0]?.status_message ?? "";
    } catch {
      /* 读不到原文时只报状态码 */
    }
    if (res.status === 403 && /verify/i.test(statusMessage)) {
      throw new DataForSeoUnverifiedError();
    }
    throw new Error(
      `DataForSEO SERP HTTP ${res.status}${statusMessage ? `：${statusMessage}` : ""}`
    );
  }
  const data = (await res.json()) as {
    tasks?: Array<{
      status_code?: number;
      status_message?: string;
      result?: Array<{ items?: SerpItem[] }>;
    }>;
  };
  const task = data?.tasks?.[0];
  if (!task || task.status_code !== 20000) {
    throw new Error(
      `DataForSEO 任务异常（status_code=${task?.status_code ?? "?"}${task?.status_message ? `：${task.status_message}` : ""}）`
    );
  }
  const items = task.result?.[0]?.items ?? [];
  const out: SerpSource[] = [];
  for (const item of items) {
    if (item?.type !== "organic") continue;
    if (typeof item.url !== "string" || !item.url.startsWith("http")) continue;
    out.push({
      title:
        typeof item.title === "string" && item.title.trim()
          ? item.title.trim()
          : item.url,
      url: item.url,
      snippet:
        typeof item.description === "string" ? item.description.trim() : "",
    });
    if (out.length >= 20) break;
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asFiniteNonNegative(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  return null;
}

/** 校验并清洗模型输出：只保留引用了本次 SERP URL 的候选；0 条则抛错。 */
function validateCandidates(
  raw: unknown,
  serpUrls: Set<string>
): RecoCandidate[] {
  if (!isRecord(raw) || !Array.isArray(raw["candidates"])) {
    throw new AiError("模型返回结构不符合推荐格式");
  }
  const out: RecoCandidate[] = [];
  for (const c of raw["candidates"] as unknown[]) {
    if (!isRecord(c)) continue;
    const name =
      typeof c["name"] === "string" ? c["name"].trim() : "";
    const why = typeof c["why"] === "string" ? c["why"].trim() : "";
    if (!name || !why) continue;
    const sources = Array.isArray(c["sources"])
      ? (c["sources"] as unknown[]).filter(
          (u): u is string => typeof u === "string" && serpUrls.has(u)
        )
      : [];
    if (sources.length === 0) continue;
    out.push({
      name,
      category:
        typeof c["category"] === "string" ? c["category"].trim() : "",
      why,
      priceHint: asFiniteNonNegative(c["priceHint"]),
      sources: [...new Set(sources)],
      sourcing: [],
    });
  }
  if (out.length === 0) {
    throw new AiError("模型未返回带有效来源的候选");
  }
  return out;
}

export async function recommendSellerProducts(
  deps: RecoDeps,
  input: { direction: string; limit: number }
): Promise<RecoResult> {
  const direction = input.direction.trim();
  const limit = Math.min(10, Math.max(3, Math.floor(input.limit) || 5));
  const queries = buildRecoQueries(direction);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const warnings: string[] = [];
  const byUrl = new Map<string, SerpSource>();
  let serpCalls = 0;
  for (const q of queries) {
    try {
      const items = await fetchSerpOrganic(
        fetchImpl,
        deps.dataforseoCreds,
        q
      );
      serpCalls += 1;
      for (const s of items) {
        if (!byUrl.has(s.url)) byUrl.set(s.url, s);
      }
    } catch (e) {
      // 账号未验证是全局问题，继续查下去只会重复失败，直接抛给路由层明示。
      if (e instanceof DataForSeoUnverifiedError) throw e;
      warnings.push(
        `查询“${q}”失败：${e instanceof Error ? e.message : "未知错误"}`
      );
    }
  }
  const sources = [...byUrl.values()].slice(0, MAX_SOURCES);
  const cost = serpCalls * SERP_QUERY_PRICE_USD;
  if (sources.length === 0) {
    return {
      candidates: [],
      sources: [],
      queries,
      sourcingQueries: [],
      serpCalls,
      serpCostEstimateUsd: cost,
      warnings: [
        ...warnings,
        "公开搜索未返回可用榜单/文章，无法给出带来源的推荐（未用模型知识编造）。请换个方向词再试。",
      ],
    };
  }
  const serpUrls = new Set(sources.map((s) => s.url));
  const sourceBlock = sources
    .map((s, i) => `[${i + 1}] ${s.title}\n${s.url}\n${s.snippet}`)
    .join("\n\n");
  const chatImpl =
    deps.chatJsonImpl ??
    (async (args: ChatJsonArgs) => {
      const { chatJson } = await import("./llm.js");
      return chatJson(args);
    });
  const candidates = await chatJsonValidated<RecoCandidate[]>(
    {
      baseUrl: deps.llm.baseUrl,
      model: deps.llm.model,
      apiKey: deps.llm.apiKey,
      system:
        "You are a product-research assistant. Return ONLY a STRICT JSON object " +
        '{"candidates":[{"name":string,"category":string,"why":string,"priceHint":number|null,"sources":[string]}]} ' +
        "Rules: recommend ONLY product types evidenced by the supplied search results; " +
        "every candidate's sources MUST be URLs copied verbatim from the supplied list, at least one; " +
        "never invent sales, rank, review counts, or prices; priceHint is a number ONLY if a supplied " +
        "snippet explicitly states a price, otherwise null; before setting priceHint to null, check every " +
        "snippet for a price of that product type and copy it when found; why must be one sentence grounded in the snippets.",
      user:
        `方向：${direction}\n最多推荐 ${limit} 个具体商品类型。\n\n搜索结果：\n${sourceBlock}`,
    },
    (raw) => validateCandidates(raw, serpUrls),
    chatImpl
  );
  const final = candidates.slice(0, limit);
  // 找货源（附加步骤，不经模型）：每候选 1 次 SERP，只取 organic 结果，
  // 批发平台域名排前面；单条失败不影响候选本身，只记警告。
  const sourcingQueries = final.map((c) => buildSourcingQuery(c.name));
  const settled = await Promise.allSettled(
    sourcingQueries.map((q) =>
      fetchSerpOrganic(fetchImpl, deps.dataforseoCreds, q, 10)
    )
  );
  for (let i = 0; i < final.length; i += 1) {
    const r = settled[i];
    if (r.status === "fulfilled") {
      serpCalls += 1;
      final[i] = { ...final[i], sourcing: rankSourcing(r.value) };
    } else {
      warnings.push(
        `“${final[i].name}”的货源搜索失败：${r.reason instanceof Error ? r.reason.message : "未知错误"}（候选本身不受影响）`
      );
      final[i] = { ...final[i], sourcing: [] };
    }
  }
  return {
    candidates: final,
    sources,
    queries,
    sourcingQueries,
    serpCalls,
    serpCostEstimateUsd: serpCalls * SERP_QUERY_PRICE_USD,
    warnings,
  };
}
