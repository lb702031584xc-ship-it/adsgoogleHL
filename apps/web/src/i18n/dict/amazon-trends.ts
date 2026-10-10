export interface AmazonTrendsDict {
  title: string;
  description: string;
  countryLabel: string;
  nowHotTitle: string;
  nowHotEmpty: string;
  upcomingTitle: string;
  upcomingEmpty: string;
  daysLeft: string;
  stagePlan: string;
  stagePrepare: string;
  stageSprint: string;
  categoriesLabel: string;
  recommendTitle: string;
  recommendDescription: string;
  recommendButton: string;
  recommending: string;
  recommendEmpty: string;
  recommendCached: string;
  recommendFailed: string;
  goDiscover: string;
  reasonLabel: string;
  keywordsLabel: string;
  adAngleLabel: string;
  examplesLabel: string;
  countries: Record<string, string>;
}

export const zh: AmazonTrendsDict = {
  title: "热销日历",
  description:
    "按国家看当下什么品类热销、未来 90 天有哪些购物节，并用 AI 生成热销品类推荐，一键跳转去选品。",
  countryLabel: "国家/站点",
  nowHotTitle: "现在热销",
  nowHotEmpty: "当前没有节日进入备货窗口，暂无当季热销品类。",
  upcomingTitle: "即将到来的购物节",
  upcomingEmpty: "未来 90 天暂无主要购物节。",
  daysLeft: "还有",
  stagePlan: "选品期",
  stagePrepare: "备货期",
  stageSprint: "冲刺期",
  categoriesLabel: "相关品类",
  recommendTitle: "AI 热销推荐",
  recommendDescription:
    "结合当前日期与临近节日，由 AI 生成 3-8 个热销品类（含商品举例、推荐理由、建议关键词与广告角度）。结果缓存 7 天。",
  recommendButton: "生成 AI 推荐",
  recommending: "生成中…",
  recommendEmpty: "还没有 AI 推荐，点击上方按钮生成。",
  recommendCached: "（7 天缓存）",
  recommendFailed: "AI 推荐生成失败",
  goDiscover: "去选品",
  reasonLabel: "推荐理由",
  keywordsLabel: "建议关键词",
  adAngleLabel: "广告角度",
  examplesLabel: "商品举例",
  countries: {
    US: "美国",
    UK: "英国",
    DE: "德国",
    FR: "法国",
    IT: "意大利",
    ES: "西班牙",
    CA: "加拿大",
    AU: "澳大利亚",
    JP: "日本",
  },
};

export const en: AmazonTrendsDict = {
  title: "Hot-selling calendar",
  description:
    "See which categories are hot now by country, upcoming shopping festivals in the next 90 days, and AI-generated hot-category recommendations — jump straight into product discovery.",
  countryLabel: "Country / marketplace",
  nowHotTitle: "Hot right now",
  nowHotEmpty: "No festival is inside its prep window right now.",
  upcomingTitle: "Upcoming shopping festivals",
  upcomingEmpty: "No major shopping festivals in the next 90 days.",
  daysLeft: "in",
  stagePlan: "Planning",
  stagePrepare: "Stock-up",
  stageSprint: "Sprint",
  categoriesLabel: "Related categories",
  recommendTitle: "AI hot picks",
  recommendDescription:
    "AI generates 3–8 hot categories based on today's date and upcoming festivals (examples, reasons, suggested keywords, ad angles). Results are cached for 7 days.",
  recommendButton: "Generate AI recommendations",
  recommending: "Generating…",
  recommendEmpty: "No AI recommendations yet — click the button above to generate.",
  recommendCached: "(7-day cache)",
  recommendFailed: "AI recommendation failed",
  goDiscover: "Discover",
  reasonLabel: "Why",
  keywordsLabel: "Suggested keywords",
  adAngleLabel: "Ad angle",
  examplesLabel: "Examples",
  countries: {
    US: "United States",
    UK: "United Kingdom",
    DE: "Germany",
    FR: "France",
    IT: "Italy",
    ES: "Spain",
    CA: "Canada",
    AU: "Australia",
    JP: "Japan",
  },
};
