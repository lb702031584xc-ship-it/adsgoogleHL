/**
 * Google Trends 品牌/关键词相对热度（免费、无需 key）。
 *
 * 流程：GET /trends/api/explore 取 TIMESERIES widget 的 token
 * → GET /trends/api/widgetdata/multiline 取 timeline
 * → default.averages（多词各一个）或 timelineData 按词取平均 → 0-100。
 *
 * 注意：
 * - 返回体前 5 个字符是 `)]}',` 防 XSSI 前缀，必须剥离。
 * - 机房 IP 可能被 429：任何失败（429/解析失败/无数据/网络异常）返回 null，
 *   绝不抛错。
 * - Redis 缓存 24h（key `traffic:trends:<geo>:<kw1,kw2>`）；redis 不可用时
 *   跳过缓存，不抛错。调用方不传 redis 则不缓存。
 *
 * 重要：返回的是相对热度（0-100），绝不是访问量/搜索量；展示时必须注明。
 */
const TRENDS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const CACHE_TTL_SECONDS = 86400;

/** Redis 缓存最小接口（ioredis 的 Redis 满足该结构；测试可用 stub）。 */
export interface TrendsCache {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
}

function cacheKey(keywords: string[], geo: string): string {
  return `traffic:trends:${geo}:${keywords.join(",")}`;
}

/** 剥离 Google API 的 `)]}',` 防 XSSI 前缀。 */
function stripXssiPrefix(text: string): string {
  return text.startsWith(")]}',") ? text.slice(5) : text;
}

async function readCache(
  redis: TrendsCache | undefined,
  key: string
): Promise<number | null> {
  if (!redis) return null;
  try {
    const cached = await redis.get(key);
    if (cached === null || cached === "") return null;
    const n = Number(cached);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null; // redis 不可用 → 跳过缓存
  }
}

async function writeCache(
  redis: TrendsCache | undefined,
  key: string,
  value: number
): Promise<void> {
  if (!redis) return;
  try {
    await redis.setex(key, CACHE_TTL_SECONDS, String(value));
  } catch {
    // redis 不可用 → 跳过缓存，不抛错
  }
}

interface TrendsWidget {
  id?: unknown;
  token?: unknown;
}

/** 从 widgetdata 响应计算平均热度：优先 averages，退回 timelineData。 */
function averageInterest(data: unknown, keywordCount: number): number | null {
  const root = data as {
    default?: { averages?: unknown; timelineData?: unknown };
  };
  const averages = root?.default?.averages;
  if (Array.isArray(averages) && averages.length > 0) {
    const nums = averages.filter(
      (v): v is number => typeof v === "number" && Number.isFinite(v)
    );
    if (nums.length === 0) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }
  const timeline = root?.default?.timelineData;
  if (Array.isArray(timeline) && timeline.length > 0) {
    const sums = new Array<number>(keywordCount).fill(0);
    const counts = new Array<number>(keywordCount).fill(0);
    for (const entry of timeline) {
      const values = (entry as { value?: unknown })?.value;
      if (!Array.isArray(values)) continue;
      for (let i = 0; i < keywordCount; i++) {
        const v = values[i];
        if (typeof v === "number" && Number.isFinite(v)) {
          sums[i] = (sums[i] ?? 0) + v;
          counts[i] = (counts[i] ?? 0) + 1;
        }
      }
    }
    const perKeyword: number[] = [];
    for (let i = 0; i < keywordCount; i++) {
      const c = counts[i] ?? 0;
      if (c > 0) perKeyword.push((sums[i] ?? 0) / c);
    }
    if (perKeyword.length === 0) return null;
    return perKeyword.reduce((a, b) => a + b, 0) / perKeyword.length;
  }
  return null;
}

async function fetchTrendsInterest(
  keywords: string[],
  geo: string,
  fetchImpl: typeof fetch
): Promise<number | null> {
  const comparisonItem = keywords.map((keyword) => ({
    keyword,
    geo,
    time: "today 12-m",
  }));

  // 1. explore：拿 TIMESERIES widget 的 token
  const exploreUrl =
    "https://trends.google.com/trends/api/explore?hl=en-US&tz=-240&req=" +
    encodeURIComponent(
      JSON.stringify({ comparisonItem, category: 0, property: "" })
    );
  const exploreRes = await fetchImpl(exploreUrl, {
    headers: { "User-Agent": TRENDS_UA },
  });
  if (!exploreRes.ok) return null; // 429 等 → null
  const exploreJson = JSON.parse(
    stripXssiPrefix(await exploreRes.text())
  ) as { widgets?: TrendsWidget[] };
  const widgets = exploreJson?.widgets;
  if (!Array.isArray(widgets)) return null;
  const token = widgets.find((w) => w?.id === "TIMESERIES")?.token;
  if (typeof token !== "string" || !token) return null;

  // 2. widgetdata/multiline：拿 timeline 数据
  const widgetUrl =
    "https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=-240&req=" +
    encodeURIComponent(
      JSON.stringify({
        time: "today 12-m",
        resolution: "WEEK",
        locale: "en-US",
        comparisonItem,
        requestOptions: { property: "", backend: "IZG", category: 0 },
        token,
      })
    );
  const dataRes = await fetchImpl(widgetUrl, {
    headers: { "User-Agent": TRENDS_UA },
  });
  if (!dataRes.ok) return null;
  const data = JSON.parse(stripXssiPrefix(await dataRes.text()));
  return averageInterest(data, keywords.length);
}

/**
 * 取关键词平均相对热度（0-100，多词取各词平均）。
 * 空关键词 / 429 / 解析失败 / 无数据 / 网络异常 → null，绝不抛错。
 */
export async function getKeywordInterest(
  keywords: string[],
  geo = "US",
  fetchImpl: typeof fetch = fetch,
  redis?: TrendsCache
): Promise<number | null> {
  const kws = keywords.map((k) => k.trim()).filter(Boolean);
  if (kws.length === 0) return null;
  const key = cacheKey(kws, geo);

  const cached = await readCache(redis, key);
  if (cached !== null) return cached;

  try {
    const value = await fetchTrendsInterest(kws, geo, fetchImpl);
    if (value !== null) await writeCache(redis, key, value);
    return value;
  } catch {
    return null;
  }
}
