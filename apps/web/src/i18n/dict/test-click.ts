/**
 * 功能5 — 测试点击链路验证 (test click chain verification).
 * Standalone fragment (not wired into dictionaries.ts — coordinator owns
 * that); import directly from "@/i18n/dict/test-click" and pick by lang,
 * following the dict/budget.ts precedent.
 */
export const zh = {
  testClick: {
    title: "链路验证",
    description: "模拟一次完整点击（追踪链接 → 落地页 → 联盟链接 → 终链），写入的点击会标记为测试流量，不计入任何统计。",
    runTest: "验证链路",
    testing: "验证中…",
    failed: "链路验证失败",
    chainOk: "链路通畅",
    chainBroken: "链路存在偏离",
    clickRecorded: "测试点击已记录",
    noConversion: "未触发真实转化上报",
    columns: {
      hop: "跳数",
      stage: "阶段",
      url: "URL",
      status: "状态码",
      ms: "耗时(ms)",
      deviated: "是否偏离",
    },
    stages: {
      tracking: "追踪链接",
      "landing-page": "落地页",
      affiliate: "联盟链接",
      final: "终链",
    },
    deviatedYes: "偏离",
    deviatedNo: "正常",
    requestFailed: "请求失败",
    expectedUrl: "预期",
  },
};

export const en = {
  testClick: {
    title: "Chain Verification",
    description:
      "Simulate one full click (tracking link → landing page → affiliate link → final URL). The recorded click is flagged as test traffic and excluded from all stats.",
    runTest: "Verify Chain",
    testing: "Verifying…",
    failed: "Chain verification failed",
    chainOk: "Chain healthy",
    chainBroken: "Chain has deviations",
    clickRecorded: "Test click recorded",
    noConversion: "No real conversion postback fired",
    columns: {
      hop: "#",
      stage: "Stage",
      url: "URL",
      status: "Status",
      ms: "ms",
      deviated: "Deviated",
    },
    stages: {
      tracking: "Tracking link",
      "landing-page": "Landing page",
      affiliate: "Affiliate link",
      final: "Final URL",
    },
    deviatedYes: "Deviated",
    deviatedNo: "OK",
    requestFailed: "Request failed",
    expectedUrl: "expected",
  },
};
