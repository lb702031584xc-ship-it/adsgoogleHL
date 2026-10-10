/**
 * 第十六批：类目关键词启动包字典。
 */
export interface KeywordStarterDict {
  pageTitle: string;
  pageSubtitle: string;
  pickCategory: string;
  templateNames: Record<"best" | "review" | "vs", string>;
  templateHints: Record<"best" | "review" | "vs", string>;
  copyAll: string;
  copied: string;
  goDiscover: string;
  goAds: string;
  importNote: string;
}

export const zh: KeywordStarterDict = {
  pageTitle: "关键词启动包",
  pageSubtitle: "选类目 → 按模板生成种子词 → 复制去投放或做 AI 扩词。",
  pickCategory: "选类目",
  templateNames: { best: "best X", review: "X review", vs: "X vs Y" },
  templateHints: {
    best: "购买意向最强，直接冲转化",
    review: "评测意向，适合评测落地页",
    vs: "对比意向，适合对比落地页",
  },
  copyAll: "复制全部",
  copied: "已复制，去粘贴吧",
  goDiscover: "去选品",
  goAds: "去广告创建",
  importNote:
    "导入方式：点“复制全部”粘贴到 Google Ads 关键词规划师或 AI 扩词；也可逐个去选品验证需求。",
};

export const en: KeywordStarterDict = {
  pageTitle: "Keyword Starter Pack",
  pageSubtitle: "Pick a category → generate seed keywords from templates → copy to use.",
  pickCategory: "Category",
  templateNames: { best: "best X", review: "X review", vs: "X vs Y" },
  templateHints: {
    best: "Strongest buying intent — go for conversions",
    review: "Review intent — fits review landing pages",
    vs: "Comparison intent — fits comparison pages",
  },
  copyAll: "Copy all",
  copied: "Copied — go paste them",
  goDiscover: "Discover",
  goAds: "Create ads",
  importNote:
    "Import: hit “Copy all” and paste into Google Ads Keyword Planner or AI expansion; or validate demand per keyword in discovery.",
};
