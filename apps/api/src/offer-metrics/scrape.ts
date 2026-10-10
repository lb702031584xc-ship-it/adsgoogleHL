/**
 * Offer 最终链接指标抓取（第三批）。
 *
 * 复用 ai/fetch-page.ts 的 SSRF-safe 抓取能力（fetchPageHtml）：
 * 先解析跳转链到最终 URL，再抓最终页。非法 URL / SSRF 风险由 fetchPageHtml 拒绝。
 *
 * 解析优先级：
 *  1. JSON-LD Product + aggregateRating → rating / reviewCount
 *  2. JSON-LD offers → price / priceCurrency / availability
 *  3. 文本模式兜底（中英）：Amazon "X bought in past month"、"Best Sellers Rank #N"、
 *     通用 "sold X / 已售 X 件"、"$X.XX"、"X out of 5"、"X ratings"
 *
 * 内部永不抛错：拿不到的字段为 null 并在 failures 里记原因；
 * 抓取失败也不抛 500，由调用方决定 HTTP 状态。
 */
import { fetchPageHtml } from "../ai/fetch-page.js";

export interface OfferMetrics {
  /** 用户提供的原始 URL。 */
  url: string;
  /** 跟随跳转后的最终 URL（抓取失败时为 null）。 */
  finalUrl: string | null;
  title: string | null;
  price: number | null;
  currency: string | null;
  /** 评分（0-5）。 */
  rating: number | null;
  reviewCount: number | null;
  soldCount: number | null;
  /** 如 "InStock"。 */
  availability: string | null;
  /** Best Sellers Rank 名次（数字）。 */
  bsr: number | null;
  fetchedAt: string;
  /** 未拿到字段的原因记录。 */
  failures: string[];
}

const SCRAPE_TIMEOUT_MS = 15_000;

interface ProductJsonLd {
  name?: unknown;
  aggregateRating?: { ratingValue?: unknown; reviewCount?: unknown };
  offers?: unknown;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asInt(v: unknown): number | null {
  const n = asNumber(v);
  return n === null ? null : Math.round(n);
}

/** 从 HTML 里抽出所有 JSON-LD 脚本块并解析。 */
function extractJsonLdObjects(html: string): unknown[] {
  const out: unknown[] = [];
  const re =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed: unknown = JSON.parse(m[1] ?? "");
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      // 单个块解析失败不影响其他块
    }
  }
  return out;
}

function findProduct(objs: unknown[]): ProductJsonLd | null {
  const flat: unknown[] = [];
  for (const o of objs) {
    const rec = o as Record<string, unknown>;
    if (rec && typeof rec === "object" && Array.isArray(rec["@graph"])) {
      flat.push(...(rec["@graph"] as unknown[]));
    } else {
      flat.push(o);
    }
  }
  for (const o of flat) {
    const rec = o as Record<string, unknown>;
    if (!rec || typeof rec !== "object") continue;
    const t = rec["@type"];
    const types = Array.isArray(t) ? t : [t];
    if (types.some((x) => typeof x === "string" && x.toLowerCase() === "product")) {
      return rec as unknown as ProductJsonLd;
    }
  }
  return null;
}

function firstOffer(offers: unknown): Record<string, unknown> | null {
  const arr = Array.isArray(offers) ? offers : [offers];
  for (const o of arr) {
    if (o && typeof o === "object") return o as Record<string, unknown>;
  }
  return null;
}

const num = (s: string): number | null => {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

export interface ScrapeDeps {
  fetchHtml?: typeof fetchPageHtml;
}

export async function scrapeOfferMetrics(
  url: string,
  deps: ScrapeDeps = {}
): Promise<OfferMetrics> {
  const fetchHtml = deps.fetchHtml ?? fetchPageHtml;
  const fetchedAt = new Date().toISOString();
  const failures: string[] = [];
  const base: OfferMetrics = {
    url,
    finalUrl: null,
    title: null,
    price: null,
    currency: null,
    rating: null,
    reviewCount: null,
    soldCount: null,
    availability: null,
    bsr: null,
    fetchedAt,
    failures,
  };

  let html = "";
  let finalUrl: string | null = null;
  try {
    const page = await Promise.race([
      fetchHtml(url),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("scrape timeout")), SCRAPE_TIMEOUT_MS)
      ),
    ]);
    html = page.html;
    finalUrl = page.finalUrl;
    base.finalUrl = finalUrl;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isAmazon = /amazon\./i.test(url);
    if (/status 403/.test(msg) && isAmazon) {
      failures.push("亚马逊反爬 403：最终页抓取被拒绝");
    } else if (msg === "scrape timeout") {
      failures.push("抓取超时（15s）");
    } else {
      failures.push(`最终页抓取失败：${msg}`);
    }
    return base;
  }

  // ---- JSON-LD ----
  try {
    const product = findProduct(extractJsonLdObjects(html));
    if (product) {
      if (typeof product.name === "string" && product.name.trim()) {
        base.title = product.name.trim().slice(0, 200);
      }
      const agg = product.aggregateRating;
      if (agg && typeof agg === "object") {
        const r = asNumber(agg.ratingValue);
        if (r !== null && r >= 0 && r <= 5) base.rating = Math.round(r * 100) / 100;
        const rc = asInt(agg.reviewCount);
        if (rc !== null && rc >= 0) base.reviewCount = rc;
      }
      const offer = firstOffer(product.offers);
      if (offer) {
        const p = asNumber(offer["price"]);
        if (p !== null && p > 0) {
          base.price = p;
          base.currency =
            typeof offer["priceCurrency"] === "string"
              ? (offer["priceCurrency"] as string).toUpperCase().slice(0, 8)
              : null;
        }
        if (typeof offer["availability"] === "string") {
          base.availability = (offer["availability"] as string)
            .split("/")
            .pop()!
            .trim()
            .slice(0, 32);
        }
      }
    }
  } catch {
    failures.push("JSON-LD 解析异常");
  }

  // ---- 文本兜底 ----
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  if (base.rating === null) {
    const m = text.match(/(\d\.\d)\s*out of 5/i);
    if (m) {
      const r = num(m[1]!);
      if (r !== null && r >= 0 && r <= 5) base.rating = r;
    }
  }
  if (base.reviewCount === null) {
    const m = text.match(/([\d,]+)\s*(?:ratings?|reviews?|条评价|条评论)/i);
    if (m) {
      const rc = num(m[1]!);
      if (rc !== null && rc >= 0) base.reviewCount = Math.round(rc);
    }
  }
  if (base.price === null) {
    const m = text.match(/\$\s?([\d,]+\.\d{2})/);
    if (m) {
      const p = num(m[1]!);
      if (p !== null && p > 0) {
        base.price = p;
        base.currency = "USD";
      }
    }
  }
  if (base.soldCount === null) {
    const m =
      text.match(/([\d,]+)\+?\s*bought in past month/i) ??
      text.match(/已售\s*([\d,]+)\s*件/) ??
      text.match(/(?:sold|sales)\s*:?\s*([\d,]+)/i);
    if (m) {
      const sc = num(m[1]!);
      if (sc !== null && sc >= 0) base.soldCount = Math.round(sc);
    }
  }
  if (base.bsr === null) {
    const m = text.match(/best sellers rank\s*#([\d,]+)/i);
    if (m) {
      const b = num(m[1]!);
      if (b !== null && b > 0) base.bsr = Math.round(b);
    }
  }

  // ---- 缺失原因 ----
  if (base.rating === null) failures.push("未获取到评分");
  if (base.reviewCount === null) failures.push("未获取到评论数");
  if (base.price === null) failures.push("未获取到价格");
  if (base.soldCount === null) failures.push("未获取到销量");
  if (base.title === null) failures.push("未获取到商品标题");

  return base;
}
