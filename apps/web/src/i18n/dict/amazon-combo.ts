/**
 * 组合测试（第九批）i18n.
 */
export interface AmazonComboDict {
  title: string;
  description: string;
  empty: string;
  running: string;
  completed: string;
  totalClicks: string;
  itemCount: string;
  viewDetail: string;
  backToList: string;
  rankingTitle: string;
  rank: string;
  product: string;
  clicks: string;
  share: string;
  conversions: string;
  conclusionTitle: string;
  testProgress: string;
  daysElapsed: string;
  targetClicksLabel: string;
  testDaysLabel: string;
  htmlTitle: string;
  copyHtml: string;
  copied: string;
  methodTitle: string;
  methodBody: string;
  clickUrlLabel: string;
  loadError: string;
}

export const zh: AmazonComboDict = {
  title: "组合测试",
  description: "以测代选：一次测 5-10 个品，一个榜单页 + 一份预算，数据说了算。",
  empty: "还没有组合测试。从选品流水线结果页勾选 5-10 个候选品生成。",
  running: "测试中",
  completed: "已完成",
  totalClicks: "总点击",
  itemCount: "产品数",
  viewDetail: "查看仪表盘",
  backToList: "← 返回组合测试",
  rankingTitle: "点击排名",
  rank: "排名",
  product: "产品",
  clicks: "出站点击",
  share: "点击份额",
  conversions: "转化",
  conclusionTitle: "测试结论",
  testProgress: "测试进度",
  daysElapsed: "已跑天数",
  targetClicksLabel: "目标点击",
  testDaysLabel: "测试天数",
  htmlTitle: "榜单页 HTML",
  copyHtml: "复制 HTML",
  copied: "已复制，去你的建站工具粘贴发布。",
  methodTitle: "方法论：一份预算、一个页面、数据排序",
  methodBody:
    "把 5-10 个候选品放进同一个榜单页，每个品带各自的跟踪链接，用同一份广告预算引流。跑满设定天数或点击数后，按出站点击数排名——点击最高者值得单独深入测试。CTR 需要页面浏览数据，当前仅按出站点击与转化排名。",
  clickUrlLabel: "点击链接",
  loadError: "加载失败",
};

export const en: AmazonComboDict = {
  title: "Combo tests",
  description: "Test instead of guess: 5-10 products, one listicle page, one budget — let the data decide.",
  empty: "No combo tests yet. Select 5-10 candidates on the pipeline results page to create one.",
  running: "Running",
  completed: "Completed",
  totalClicks: "Total clicks",
  itemCount: "Products",
  viewDetail: "View dashboard",
  backToList: "← Back to combo tests",
  rankingTitle: "Click ranking",
  rank: "Rank",
  product: "Product",
  clicks: "Outbound clicks",
  share: "Click share",
  conversions: "Conversions",
  conclusionTitle: "Conclusion",
  testProgress: "Test progress",
  daysElapsed: "Days elapsed",
  targetClicksLabel: "Target clicks",
  testDaysLabel: "Test days",
  htmlTitle: "Listicle HTML",
  copyHtml: "Copy HTML",
  copied: "Copied — paste it into your site builder to publish.",
  methodTitle: "Method: one budget, one page, data-ranked",
  methodBody:
    "Put 5-10 candidates on one listicle page, each with its own tracking link, and drive them with a single ad budget. After the set days or clicks, rank by outbound clicks — the top click-getter deserves a dedicated deep test. CTR needs page-view data; current ranking uses outbound clicks and conversions only.",
  clickUrlLabel: "Click URL",
  loadError: "Load failed",
};
