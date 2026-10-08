/**
 * Feature: 返利落地页合规评分 (lp-cashback-score) — page strings.
 *
 * Standalone dictionary module: imported directly by the cashback offers
 * list component. It is intentionally NOT merged into `dictionaries.ts`
 * (left untouched per scope). Issue codes mirror
 * apps/api/src/services/cashback-lp-scorer.ts LP_SCORE_ISSUES.
 */
export const zh = {
  score: {
    column: "合规分",
    noLandingPage: "未关联落地页",
    loadFailed: "加载合规分失败",
    issues: {
      no_content: "页面没有可分析的正文内容",
      content_too_short: "正文过短（少于 200 字）",
      content_thin: "正文内容偏少（少于 600 字）",
      missing_disclosure: "缺少返利 / Affiliate 声明",
      too_few_links: "页面链接过少",
      outbound_heavy: "外链占比过高且内容偏少",
      rate_mismatch: "页面宣称的返利比例与检测到的比例不一致",
      bridge_page_risk: "疑似 Bridge Page（正文过短且几乎只有跳转按钮）",
    } as Record<string, string>,
  },
};

export const en = {
  score: {
    column: "Compliance score",
    noLandingPage: "No landing page linked",
    loadFailed: "Failed to load compliance scores",
    issues: {
      no_content: "Page has no analyzable body content",
      content_too_short: "Body text too short (under 200 chars)",
      content_thin: "Body content is thin (under 600 chars)",
      missing_disclosure: "Missing cashback / affiliate disclosure",
      too_few_links: "Too few links on the page",
      outbound_heavy: "Outbound-link heavy with thin content",
      rate_mismatch: "Page-advertised cashback rate differs from detected rate",
      bridge_page_risk: "Looks like a bridge page (thin content, only a jump button)",
    } as Record<string, string>,
  },
};
