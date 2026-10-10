/**
 * 类目关键词启动包（第十六批）：纯静态模板数据，不调外部 API。
 *
 * 6 个类目 × 种子词 → 三组模板：
 *  - best X   （购买意向最强）
 *  - X review （评测意向）
 *  - X vs Y   （对比意向）
 */
export type StarterCategoryKey =
  | "electronics"
  | "home"
  | "outdoor"
  | "beauty"
  | "pet"
  | "baby";

export interface StarterCategory {
  key: StarterCategoryKey;
  nameZh: string;
  nameEn: string;
  /** 英文种子词（Google Ads 投放用英文）。 */
  seeds: string[];
}

export const STARTER_CATEGORIES: StarterCategory[] = [
  {
    key: "electronics",
    nameZh: "3C数码",
    nameEn: "Electronics",
    seeds: ["wireless earbuds", "power bank", "smart watch", "bluetooth speaker"],
  },
  {
    key: "home",
    nameZh: "家居",
    nameEn: "Home & Kitchen",
    seeds: ["air fryer", "robot vacuum", "led strip lights", "storage organizer"],
  },
  {
    key: "outdoor",
    nameZh: "户外",
    nameEn: "Outdoor",
    seeds: ["camping tent", "hiking backpack", "portable chair", "insulated water bottle"],
  },
  {
    key: "beauty",
    nameZh: "美妆个护",
    nameEn: "Beauty",
    seeds: ["vitamin c serum", "electric toothbrush", "hair dryer", "facial cleanser"],
  },
  {
    key: "pet",
    nameZh: "宠物",
    nameEn: "Pet",
    seeds: ["cat tree", "dog chew toys", "pet camera", "automatic feeder"],
  },
  {
    key: "baby",
    nameZh: "母婴",
    nameEn: "Baby",
    seeds: ["baby monitor", "stroller", "diaper bag", "baby carrier"],
  },
];

export type StarterTemplate = "best" | "review" | "vs";

export interface StarterKeywordGroup {
  template: StarterTemplate;
  keywords: string[];
}

/**
 * 按模板生成种子词：
 *  best:  "best X"（每个种子一个）
 *  review:"X review"（每个种子一个）
 *  vs:    "X vs Y"（相邻种子两两对比）
 */
export function generateStarterKeywords(
  categoryKey: StarterCategoryKey
): StarterKeywordGroup[] {
  const cat = STARTER_CATEGORIES.find((c) => c.key === categoryKey);
  if (!cat) return [];
  const seeds = cat.seeds;
  const vs: string[] = [];
  for (let i = 0; i + 1 < seeds.length; i++) {
    vs.push(`${seeds[i]} vs ${seeds[i + 1]}`);
  }
  return [
    { template: "best", keywords: seeds.map((s) => `best ${s}`) },
    { template: "review", keywords: seeds.map((s) => `${s} review`) },
    { template: "vs", keywords: vs },
  ];
}

/** 拍平所有关键词（复制/导出用）。 */
export function flattenStarterKeywords(groups: StarterKeywordGroup[]): string[] {
  return groups.flatMap((g) => g.keywords);
}
