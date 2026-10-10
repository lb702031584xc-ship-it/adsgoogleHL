/**
 * Keepa 官方 API 客户端（Day5 Keepa 自动筛选）。
 *
 * 请求：GET https://api.keepa.com/product?key=&domain=&asin=&history=1&offers=1
 * - history=1：返回价格/排名历史（csv）。
 * - offers=1：官方文档要求 RATING(16)/COUNT_REVIEWS(17) 必须带 offers 参数，
 *   评论数增长指标依赖它，所以必须带（会多消耗一点 token）。
 *
 * 字段依据：https://keepa.com/api-docs/product-object.html
 * - domainId：1=com, 2=co.uk, 3=de, 4=fr, 5=co.jp, 6=ca, 8=it, 9=es, 10=in, 11=com.mx
 *   （文档无 com.au，AU 站点回退 US=1）
 * - csv 下标：0=AMAZON, 1=NEW, 2=USED, 3=SALES, 16=RATING, 17=COUNT_REVIEWS
 * - Keepa 时间：(keepaTime + 21564000) * 60000 = Unix 毫秒
 * - 价格 -1 = 该时段无货/无报价
 */

/** Keepa domainId（官方文档 product-object.html 的 domainId 表）。 */
export const KEEPA_DOMAINS: Record<string, number> = {
  US: 1, // amazon.com
  UK: 2, // amazon.co.uk
  DE: 3, // amazon.de
  FR: 4, // amazon.fr
  JP: 5, // amazon.co.jp
  CA: 6, // amazon.ca
  IT: 8, // amazon.it
  ES: 9, // amazon.es
  // 注意：官方文档 domainId 无 AU（com.au），AU 回退 US。
  AU: 1,
};

export function keepaDomainId(country: string): number {
  return KEEPA_DOMAINS[(country ?? "").toUpperCase()] ?? 1;
}

export interface KeepaProduct {
  asin: string;
  title: string | null;
  productType: number | null;
  /** csv[下标] = [keepaTime, value, keepaTime, value, ...]；无数据为 null。 */
  csv: Array<number[] | null>;
}

export type KeepaFetchError =
  | "network"
  | "rate_limited"
  | "invalid_key"
  | "tokens_exhausted"
  | "no_data";

export interface KeepaFetchResult {
  product: KeepaProduct | null;
  tokensLeft: number | null;
  error: KeepaFetchError | null;
}

type FetchImpl = typeof fetch;

const KEEPA_API_BASE = "https://api.keepa.com/product";
const REQUEST_TIMEOUT_MS = 20000;

/**
 * 拉取单个 ASIN 的 Keepa 产品数据。
 * 永远不抛错（除 invalid_key 由调用方转 400）：失败时 error 字段说明原因，
 * 调用方据此判 unknown，绝不抛 500。
 */
export async function fetchKeepaProduct(
  apiKey: string,
  asin: string,
  domain: number,
  fetchImpl: FetchImpl = fetch
): Promise<KeepaFetchResult> {
  const empty: KeepaFetchResult = { product: null, tokensLeft: null, error: null };
  const url =
    `${KEEPA_API_BASE}?key=${encodeURIComponent(apiKey)}` +
    `&domain=${domain}&asin=${encodeURIComponent(asin)}&history=1&offers=1`;

  let res: Response;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      res = await fetchImpl(url, {
        headers: { Accept: "application/json", "User-Agent": "AdLinkLab/1.0" },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { ...empty, error: "network" };
  }

  if (res.status === 429) return { ...empty, error: "rate_limited" };
  if (res.status === 401 || res.status === 403) return { ...empty, error: "invalid_key" };
  if (!res.ok) return { ...empty, error: "network" };

  let body: {
    products?: Array<Record<string, unknown>> | null;
    tokensLeft?: number;
  };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { ...empty, error: "network" };
  }

  const tokensLeft = typeof body.tokensLeft === "number" ? body.tokensLeft : null;
  if (tokensLeft !== null && tokensLeft <= 0) {
    return { product: null, tokensLeft, error: "tokens_exhausted" };
  }

  const raw = Array.isArray(body.products) ? body.products[0] : null;
  if (!raw || typeof raw.asin !== "string") {
    return { product: null, tokensLeft, error: "no_data" };
  }

  return {
    product: {
      asin: raw.asin,
      title: typeof raw.title === "string" ? raw.title : null,
      productType: typeof raw.productType === "number" ? raw.productType : null,
      csv: Array.isArray(raw.csv) ? (raw.csv as Array<number[] | null>) : [],
    },
    tokensLeft,
    error: null,
  };
}
