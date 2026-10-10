/**
 * 网站就绪检查（第十四批）：用户填域名 → 抓取检查合规三件套 + 文章数。
 *
 * 检查项：
 *  - disclosure: /affiliate-disclosure（或 /disclosure）存在且可达
 *  - privacy:    /privacy-policy（或 /privacy）存在且可达
 *  - contact:    /contact（或 /contact-us）存在且可达
 *  - articles:   首页文章数 ≥ 5（<article> 标签 + 博客链接启发式）
 *
 * 抓取复用 apps/api/src/ai/fetch-page.ts 的 fetchPageHtml（SSRF-safe）。
 * 单项失败不抛错：ok=false + 原因。
 */
import { fetchPageHtml } from "../ai/fetch-page.js";

export type SiteCheckKey = "disclosure" | "privacy" | "contact" | "articles";

export interface SiteCheckItem {
  key: SiteCheckKey;
  ok: boolean;
  /** 实际命中的 URL（或尝试过的 URL）。 */
  url: string | null;
  /** 失败原因 / 通过说明（英文技术串，文案由 Web 翻译）。 */
  detail: string;
}

export interface SiteCheckResult {
  domain: string;
  items: SiteCheckItem[];
  articleCount: number;
  checkedAt: string;
}

const PATH_SETS: Record<Exclude<SiteCheckKey, "articles">, string[]> = {
  disclosure: ["/affiliate-disclosure", "/disclosure"],
  privacy: ["/privacy-policy", "/privacy"],
  contact: ["/contact", "/contact-us"],
};

function normalizeDomain(raw: string): string | null {
  const t = (raw ?? "").trim().toLowerCase();
  if (!t) return null;
  const noProto = t.replace(/^https?:\/\//, "");
  const host = noProto.split("/")[0]?.trim() ?? "";
  if (!host || host.includes(" ") || !host.includes(".")) return null;
  return host;
}

async function tryFetch(
  base: string,
  paths: string[]
): Promise<{ ok: boolean; url: string | null; detail: string }> {
  let lastDetail = "not found";
  for (const p of paths) {
    const url = `${base}${p}`;
    try {
      const page = await fetchPageHtml(url);
      if (page.statusCode >= 200 && page.statusCode < 300 && page.text.trim().length > 200) {
        return { ok: true, url, detail: `HTTP ${page.statusCode}` };
      }
      lastDetail = `HTTP ${page.statusCode}`;
    } catch (e) {
      lastDetail = e instanceof Error ? e.message : "fetch failed";
    }
  }
  return { ok: false, url: `${base}${paths[0]}`, detail: lastDetail };
}

/** 首页文章数：<article> 标签数 + 博客链接数（去重，取较大启发值）。 */
function countArticles(html: string): number {
  const articleTags = (html.match(/<article[\s>]/gi) ?? []).length;
  const links = new Set<string>();
  const re = /href="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1] ?? "";
    if (
      /\/(blog|post|posts|article|articles|news)\//i.test(href) ||
      /\/20\d\d\/\d\d\//.test(href)
    ) {
      links.add(href.split("#")[0]?.split("?")[0] ?? href);
    }
  }
  return Math.max(articleTags, links.size);
}

export async function checkSiteReadiness(rawDomain: string): Promise<SiteCheckResult> {
  const domain = normalizeDomain(rawDomain);
  if (!domain) {
    throw Object.assign(new Error("invalid domain"), { statusCode: 400 });
  }
  const base = `https://${domain}`;
  const items: SiteCheckItem[] = [];
  let articleCount = 0;

  for (const key of ["disclosure", "privacy", "contact"] as const) {
    const r = await tryFetch(base, PATH_SETS[key]);
    items.push({ key, ok: r.ok, url: r.url, detail: r.detail });
  }

  // 文章数
  try {
    const home = await fetchPageHtml(base + "/");
    articleCount = countArticles(home.html);
    items.push({
      key: "articles",
      ok: articleCount >= 5,
      url: base + "/",
      detail: `found ${articleCount}`,
    });
  } catch (e) {
    items.push({
      key: "articles",
      ok: false,
      url: base + "/",
      detail: e instanceof Error ? e.message : "fetch failed",
    });
  }

  return { domain, items, articleCount, checkedAt: new Date().toISOString() };
}
