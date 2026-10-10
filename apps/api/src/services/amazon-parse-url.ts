/**
 * Amazon 产品链接解析（纯函数，无外部请求）。
 *
 * - ASIN：从 /dp/、/gp/product/、/gp/aw/d/、/exec/obidos/ASIN/ 等路径正则提取，100% 可靠。
 * - 产品名：从 URL 的 slug 段提取（amazon.com/<slug>/dp/ASIN），decode 后可读即用；
 *   slug 缺失或乱码时返回 null，由调用方提示用户手填。
 * - 类目排名（BSR）：服务器被亚马逊反爬拦，无法提取，调用方留空手填。
 */

const ASIN_RE =
  /(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|\/exec\/obidos\/ASIN\/)([A-Z0-9]{10})(?:[/?#]|$)/i;

export interface ParsedAmazonUrl {
  asin: string | null;
  /** 从 URL slug 还原的产品名；拿不到为 null */
  name: string | null;
  /** name 的来源：slug=链接自带，可编辑 */
  nameSource: "slug" | "none";
}

const EMPTY: ParsedAmazonUrl = { asin: null, name: null, nameSource: "none" };

export function parseAmazonUrl(raw: string): ParsedAmazonUrl {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return EMPTY;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return EMPTY;
  }
  if (!/^https?:$/.test(url.protocol)) return EMPTY;

  const asinMatch = url.pathname.match(ASIN_RE) ?? url.href.match(ASIN_RE);
  const asin = asinMatch ? asinMatch[1].toUpperCase() : null;

  let name: string | null = null;
  const slugMatch = url.pathname.match(/\/([^/]+)\/dp\/[A-Z0-9]{10}/i);
  if (slugMatch) {
    try {
      const decoded = decodeURIComponent(slugMatch[1])
        .replace(/[-_+]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      // 过滤乱码 slug：太短或一个字母都没有的不要
      if (decoded.length >= 4 && /[a-zA-Z\u4e00-\u9fa5]/.test(decoded)) {
        name = decoded;
      }
    } catch {
      name = null;
    }
  }

  return { asin, name, nameSource: name ? "slug" : "none" };
}
