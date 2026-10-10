/**
 * ASIN 需求异动监控（第十批）i18n.
 */
export interface AmazonWatchDict {
  title: string;
  description: string;
  empty: string;
  asin: string;
  title_col: string;
  latestReviews: string;
  latestRating: string;
  growth7d: string;
  status: string;
  surged: string;
  normal: string;
  noData: string;
  unwatch: string;
  checkNow: string;
  checking: string;
  checkDone: string;
  thresholdsTitle: string;
  growthPctLabel: string;
  growthAbsLabel: string;
  save: string;
  saving: string;
  saved: string;
  thresholdsHint: string;
  methodNote: string;
  watch: string;
  watching: string;
  watched: string;
  surgeBadgeTitle: string;
  loadError: string;
}

export const zh: AmazonWatchDict = {
  title: "需求监控",
  description:
    "跟踪 ASIN 的评论数/评分每日快照（PA-API 无 BSR 字段，用评论数增速做需求代理）。7 天增长超阈值 → 站内通知。",
  empty: "还没有跟踪的 ASIN。从选品发现或流水线结果页一键“跟踪”。",
  asin: "ASIN",
  title_col: "标题",
  latestReviews: "最新评论数",
  latestRating: "最新评分",
  growth7d: "7 天增长",
  status: "状态",
  surged: "异动",
  normal: "正常",
  noData: "暂无快照",
  unwatch: "取消跟踪",
  checkNow: "立即检查",
  checking: "检查中…",
  checkDone: "检查完成",
  thresholdsTitle: "异动阈值",
  growthPctLabel: "评论增长百分比（%）",
  growthAbsLabel: "评论增长绝对数（条）",
  save: "保存",
  saving: "保存中…",
  saved: "已保存。",
  thresholdsHint: "满足任一条件即判定异动。默认：+50% 或 +500 条。",
  methodNote:
    "数据来源：Amazon PA-API GetItems 每日快照（评论数、评分、价格）。PA-API 不返回 BSR 排名，需求热度以评论数增速代理。",
  watch: "跟踪",
  watching: "跟踪中…",
  watched: "已跟踪",
  surgeBadgeTitle: "需求异动提醒",
  loadError: "加载失败",
};

export const en: AmazonWatchDict = {
  title: "Demand monitor",
  description:
    "Daily snapshots of review counts/ratings for tracked ASINs (PA-API has no BSR field; review growth is the demand proxy). 7-day growth over the threshold → in-site notification.",
  empty: "No tracked ASINs yet. Track one from discovery or pipeline results.",
  asin: "ASIN",
  title_col: "Title",
  latestReviews: "Latest reviews",
  latestRating: "Latest rating",
  growth7d: "7-day growth",
  status: "Status",
  surged: "Surging",
  normal: "Normal",
  noData: "No snapshot",
  unwatch: "Untrack",
  checkNow: "Check now",
  checking: "Checking…",
  checkDone: "Check complete",
  thresholdsTitle: "Surge thresholds",
  growthPctLabel: "Review growth percent (%)",
  growthAbsLabel: "Review growth absolute (count)",
  save: "Save",
  saving: "Saving…",
  saved: "Saved.",
  thresholdsHint: "Either condition triggers a surge. Defaults: +50% or +500 reviews.",
  methodNote:
    "Data: daily Amazon PA-API GetItems snapshots (reviews, rating, price). PA-API returns no BSR rank; demand heat is proxied by review-count growth.",
  watch: "Track",
  watching: "Tracking…",
  watched: "Tracked",
  surgeBadgeTitle: "Demand surge alerts",
  loadError: "Load failed",
};
