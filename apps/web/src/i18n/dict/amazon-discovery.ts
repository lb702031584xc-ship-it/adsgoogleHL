export interface AmazonDiscoveryDict {
  title: string;
  description: string;
  noCredentials: string;
  criteriaTitle: string;
  keywordsLabel: string;
  keywordsPlaceholder: string;
  keywordsHint: string;
  priceRangeLabel: string;
  minRatingLabel: string;
  minReviewsLabel: string;
  regionLabel: string;
  discover: string;
  discovering: string;
  resultsTitle: string;
  scoreLabel: string;
  commissionLabel: string;
  import: string;
  importSelected: string;
  importing: string;
  imported: string;
  historyTitle: string;
  totalFound: string;
  totalKept: string;
  paidTrafficWarningTitle: string;
  paidTrafficWarningBody: string;
}

export const zh: AmazonDiscoveryDict = {
  title: "Amazon 自动选品",
  description:
    "配置选品条件，系统通过 Amazon PA-API 抓取产品，按评分算法推荐高潜力 Offer，一键导入投放流程。",
  noCredentials:
    "未配置 Amazon PA-API 凭证。请先在 AI 设置中配置 amazon_paapi_key（格式：AccessKey|SecretKey|PartnerTag|Region），或设置环境变量 AMAZON_PAAPI_KEY。",
  criteriaTitle: "选品条件",
  keywordsLabel: "关键词（每行一个，最多 10 个）",
  keywordsPlaceholder: "wireless earbuds\nmechanical keyboard",
  keywordsHint: "每个关键词会单独搜索一次，结果合并去重。",
  priceRangeLabel: "价格区间（USD）",
  minRatingLabel: "最低评分",
  minReviewsLabel: "最低评论数",
  regionLabel: "站点",
  discover: "开始选品",
  discovering: "抓取中…",
  resultsTitle: "推荐产品",
  scoreLabel: "评分",
  commissionLabel: "预估佣金",
  import: "导入为 Offer",
  importSelected: "导入选中",
  importing: "导入中…",
  imported: "导入成功",
  historyTitle: "历史选品",
  totalFound: "抓取到",
  totalKept: "推荐",
  paidTrafficWarningTitle: "⚠️ 付费流量不计佣金",
  paidTrafficWarningBody:
    "Amazon Associates 协议（2026 年 4 月更新）：来自付费广告（包括 Google Ads）的流量不计佣金。用 Google Ads 直链 Amazon 商品页 = 广告费白花、佣金为零。正确做法：先把流量引到自己的内容落地页（评测 / 对比文章），再从落地页链到 Amazon。",
};

export const en: AmazonDiscoveryDict = {
  title: "Amazon Product Discovery",
  description:
    "Configure criteria, fetch products via Amazon PA-API, get scored recommendations, and import as offers in one click.",
  noCredentials:
    "Amazon PA-API credentials not configured. Set amazon_paapi_key in AI settings (format: AccessKey|SecretKey|PartnerTag|Region) or the AMAZON_PAAPI_KEY env var.",
  criteriaTitle: "Discovery Criteria",
  keywordsLabel: "Keywords (one per line, max 10)",
  keywordsPlaceholder: "wireless earbuds\nmechanical keyboard",
  keywordsHint: "Each keyword is searched separately; results are merged and deduped.",
  priceRangeLabel: "Price range (USD)",
  minRatingLabel: "Min rating",
  minReviewsLabel: "Min reviews",
  regionLabel: "Marketplace",
  discover: "Start Discovery",
  discovering: "Fetching…",
  resultsTitle: "Recommended Products",
  scoreLabel: "Score",
  commissionLabel: "Est. commission",
  import: "Import as Offer",
  importSelected: "Import selected",
  importing: "Importing…",
  imported: "Imported",
  historyTitle: "Discovery History",
  totalFound: "Found",
  totalKept: "Recommended",
  paidTrafficWarningTitle: "⚠️ Paid traffic earns no commission",
  paidTrafficWarningBody:
    "Per the Amazon Associates agreement (April 2026 update), traffic from paid ads (including Google Ads) is disqualified from commissions. Direct-linking Google Ads to Amazon product pages means paying for clicks and earning zero. The compliant path: send traffic to your own content landing page (review / comparison article) first, then link out to Amazon.",
};
