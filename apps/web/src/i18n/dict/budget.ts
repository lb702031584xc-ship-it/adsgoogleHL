/**
 * Phase 3 budget recommendation + §16 monitoring rule strings.
 * Standalone fragment (not yet wired into dictionaries.ts — coordinator owns
 * that); import directly from "@/i18n/dict/budget" and pick by lang.
 */
export const zh = {
  budget: {
    title: "预算建议",
    dailyBudget: "建议日预算",
    totalTestBudget: "总测试预算",
    scenarioBudgets: "分场景预算",
    scenarios: {
      worst: "悲观",
      base: "基准",
      best: "乐观",
    },
    breakEvenCpc: "盈亏平衡 CPC",
    recommendedMaxCpc: "建议最高 CPC",
    reasons: "测算依据",
    dataQuality: "数据质量",
    loading: "预算建议加载中…",
    failed: "获取预算建议失败",
    testBasis: (clicks: number, days: number) =>
      `按约 ${clicks} 次点击、${days} 天测算`,
  },
  metrics: {
    duplicate_clicks: "重复点击",
    click_burst: "点击突增",
    ctr_anomaly: "CTR 异常",
    device_anomaly: "设备异常",
  },
  defaultRuleNames: {
    duplicate_clicks: "重复点击监控",
    click_burst: "点击突增监控",
    ctr_anomaly: "CTR 异常监控",
    device_anomaly: "设备异常监控",
  },
};

export const en = {
  budget: {
    title: "Budget Recommendation",
    dailyBudget: "Suggested daily budget",
    totalTestBudget: "Total test budget",
    scenarioBudgets: "Budget by scenario",
    scenarios: {
      worst: "Worst",
      base: "Base",
      best: "Best",
    },
    breakEvenCpc: "Break-even CPC",
    recommendedMaxCpc: "Recommended max CPC",
    reasons: "Basis",
    dataQuality: "Data quality",
    loading: "Loading budget recommendation…",
    failed: "Failed to load the budget recommendation",
    testBasis: (clicks: number, days: number) =>
      `Sized for ~${clicks} clicks over ${days} days`,
  },
  metrics: {
    duplicate_clicks: "Duplicate clicks",
    click_burst: "Click burst",
    ctr_anomaly: "CTR anomaly",
    device_anomaly: "Device anomaly",
  },
  defaultRuleNames: {
    duplicate_clicks: "Duplicate clicks guard",
    click_burst: "Click burst guard",
    ctr_anomaly: "CTR anomaly guard",
    device_anomaly: "Device anomaly guard",
  },
};
