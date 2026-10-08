/**
 * 功能 1 — 返利比例监控（rate-watch）页面文案。
 *
 * Standalone dictionary module: imported directly by the rate-watch page /
 * component. Intentionally NOT merged into `dictionaries.ts` (left
 * untouched per scope).
 */
export const zh = {
  page: {
    title: "返利比例监控",
    description:
      "每小时自动抓取各返利 offer 的页面，比对实际返利比例与你填写的宣传比例；不一致时写入告警。",
    noOffers: "还没有返利 offer，先去「返利 Offer」页面创建一个吧。",
    checkFailed: "检查失败：",
  },
  columns: {
    network: "返利网络",
    originalUrl: "原始链接",
    advertisedRate: "宣传比例",
    rateUrl: "抓取 URL",
    detectedRate: "实际比例",
    status: "状态",
    checkedAt: "检查时间",
    actions: "操作",
  },
  form: {
    advertisedRatePlaceholder: "如 8%",
    rateUrlPlaceholder: "留空则使用原始链接",
    saveAndCheck: "保存并检查",
    saving: "检查中…",
    checkNow: "立即检查",
    checking: "检查中…",
  },
  status: {
    ok: "一致",
    mismatch: "不一致",
    unreachable: "抓取失败",
    neverChecked: "未检查",
  },
  msg: {
    setFirst: "请先填写宣传比例再检查。",
    updated: "已更新并完成检查。",
    loadFailed: "加载失败",
    retry: "重试",
  },
};

export const en = {
  page: {
    title: "Cashback Rate Watch",
    description:
      "Automatically fetches each cashback offer page every hour and compares the detected rate against your advertised rate; writes an alert on mismatch.",
    noOffers: "No cashback offers yet — create one on the Cashback Offers page first.",
    checkFailed: "Check failed: ",
  },
  columns: {
    network: "Network",
    originalUrl: "Original URL",
    advertisedRate: "Advertised rate",
    rateUrl: "Fetch URL",
    detectedRate: "Detected rate",
    status: "Status",
    checkedAt: "Checked at",
    actions: "Actions",
  },
  form: {
    advertisedRatePlaceholder: "e.g. 8%",
    rateUrlPlaceholder: "Blank = use original URL",
    saveAndCheck: "Save & check",
    saving: "Checking…",
    checkNow: "Check now",
    checking: "Checking…",
  },
  status: {
    ok: "Match",
    mismatch: "Mismatch",
    unreachable: "Unreachable",
    neverChecked: "Not checked",
  },
  msg: {
    setFirst: "Set an advertised rate before checking.",
    updated: "Saved and checked.",
    loadFailed: "Load failed",
    retry: "Retry",
  },
};
