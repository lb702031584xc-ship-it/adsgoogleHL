/**
 * 功能1 — 网盟自动换链 (link swap) strings.
 * Registered in dictionaries.ts as `linkSwap` (parent wires the import).
 * Shared vocabulary (nav, actions, generic empty/error) lives in
 * `t.common.*` — do not duplicate it here.
 */
export const zh = {
  panel: {
    title: "换链推送",
    description:
      "把新的目标 URL 推送到 Google Ads：创建换链请求（DRAFT），并下发 push-url-change 脚本任务。",
    newUrl: "新目标 URL",
    newUrlPlaceholder: "https://merchant.example/deal?promo=1",
    referralUrl: "Referral URL（可选）",
    referralUrlPlaceholder: "https://referral.example/go?aff=123",
    referralUrlHint: "将把它的查询参数拼接到新目标 URL 后面。",
    deviceTarget: "设备",
    deviceDesktop: "桌面",
    deviceMobile: "移动",
    deviceAll: "全部",
    googleAccount: "Google Ads 账户",
    googleAccountAuto: "自动（按广告所属系列推导）",
    submit: "创建换链请求",
    submitting: "提交中…",
    success: "换链请求已创建，脚本任务已下发。",
    requestLabel: "请求 ID",
    taskLabel: "脚本任务",
    failedPrefix: "创建失败：",
  },
};

export const en = {
  panel: {
    title: "Link Swap Push",
    description:
      "Push a new destination URL to Google Ads: creates a URL change request (DRAFT) and dispatches a push-url-change script task.",
    newUrl: "New destination URL",
    newUrlPlaceholder: "https://merchant.example/deal?promo=1",
    referralUrl: "Referral URL (optional)",
    referralUrlPlaceholder: "https://referral.example/go?aff=123",
    referralUrlHint:
      "Its query string will be appended to the new destination URL.",
    deviceTarget: "Device",
    deviceDesktop: "Desktop",
    deviceMobile: "Mobile",
    deviceAll: "All",
    googleAccount: "Google Ads account",
    googleAccountAuto: "Auto (derived from the ad's campaign)",
    submit: "Create swap request",
    submitting: "Submitting…",
    success: "Swap request created and script task dispatched.",
    requestLabel: "Request ID",
    taskLabel: "Script task",
    failedPrefix: "Failed: ",
  },
};
