/**
 * 卖家工具 P1 关键词库：纯函数（无 IO），供关键词面板与后续的文案、
 * 埋词、校验切片复用。数据层（localStorage 键）见 seller-keyword-library.tsx。
 *
 * 口径说明：
 * - 词库不含搜索量：搜索量需 ABA 资格或工具数据另查，绝不编造；来源栏
 *   只记录人工填写的出处（如 ABA / 广告报告 / 竞品标题 / 手动）。
 * - ST 上限：课程对 250 字符与 250 字节说法不一，两项都计、都展示，
 *   不统一口径；亚马逊后台实际按字节计，超字节标红、仅超字符标黄提醒。
 * - 词根去重只做“拆词 → 小写 → 保序去重”，不做词干还原，不猜单复数同根。
 */

/** 关键词库的 10 类语义类型（方案第 3 节关键词库表结构）。 */
export const KEYWORD_TYPES = [
  "产品词",
  "品牌词",
  "属性词",
  "材质词",
  "形状词",
  "功能词",
  "场景词",
  "受众词",
  "节日词",
  "广告高转化词",
] as const;

export type KeywordType = (typeof KEYWORD_TYPES)[number];

export interface KeywordEntry {
  id: string;
  term: string;
  type: KeywordType;
  /** 出处（自由文本，如 ABA / 广告报告 / 竞品标题 / 手动），不验证。 */
  source: string;
  note: string;
  /** 关联商品 id；null = 通用词（不限单品）。 */
  productId: string | null;
  createdAt: number;
}

/** Search Terms 上限（字节；字符上限另计，两项都展示）。 */
export const ST_BYTE_LIMIT = 250;
export const ST_CHAR_LIMIT = 250;

function splitWords(term: string): string[] {
  return term
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/** ST 词根去重：多词条拆词后保序去重，返回词表。 */
export function dedupeWords(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of terms) {
    for (const w of splitWords(term)) {
      if (!seen.has(w)) {
        seen.add(w);
        out.push(w);
      }
    }
  }
  return out;
}

export interface SearchTermsResult {
  text: string;
  charCount: number;
  byteCount: number;
  overBytes: boolean;
  overChars: boolean;
}

/** 由选中词条生成 Search Terms：去重词用单个空格连接，并计字符数与字节数。 */
export function buildSearchTerms(terms: string[]): SearchTermsResult {
  const text = dedupeWords(terms).join(" ");
  const charCount = text.length;
  const byteCount = new TextEncoder().encode(text).length;
  return {
    text,
    charCount,
    byteCount,
    overBytes: byteCount > ST_BYTE_LIMIT,
    overChars: charCount > ST_CHAR_LIMIT,
  };
}
