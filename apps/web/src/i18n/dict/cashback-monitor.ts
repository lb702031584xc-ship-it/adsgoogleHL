/**
 * 返利监控统一页面（/cashback/monitor）文案。
 *
 * Standalone dictionary module: imported directly by the monitor page /
 * components. Intentionally NOT merged into `dictionaries.ts` (left
 * untouched per scope).
 */
export const zh = {
  page: {
    title: "返利监控中心",
    description:
      "返利 Offer 列表、返利比例监控、商家条款监控、跳转链检查、返利比例对比，全部集中在一个页面。",
  },
  tabs: {
    offers: "Offer 列表",
    rateWatch: "返利比例监控",
    termsWatch: "商家条款监控",
    redirectCheck: "跳转链检查",
    rateCompare: "返利比例对比",
  },
  offers: {
    addTitle: "添加返利 Offer",
    network: "返利网络名称",
    networkPlaceholder: "输入或选择，例如 rakuten",
    networkHint:
      "支持手动输入任意名称；下拉建议包含已有 offer 使用过的网络和常用返利网络。",
    networkRequired: "请填写返利网络名称（1–64 个字符）。",
    originalUrl: "原始链接",
    originalUrlPlaceholder: "https://…",
    urlRequired: "请填写有效的 http(s) 链接。",
    submit: "添加",
    adding: "添加中…",
    created: "已添加。",
    loadFailed: "加载失败",
    empty: "还没有返利 offer，先添加一个吧。",
    delete: "删除",
    deleteConfirm:
      "确定删除这个返利 offer 吗？它绑定的跟踪链接也会被暂停。",
    deleted: "已删除。",
    columns: {
      network: "返利网络",
      originalUrl: "原始链接",
      trackingLink: "跟踪链接",
      status: "状态",
      createdAt: "创建时间",
      actions: "操作",
    },
    status: {
      active: "启用",
      paused: "暂停",
    },
    loading: "加载中…",
    trafficGate: {
      check: "检测流量门",
      checking: "检测中…",
      close: "收起结果",
      passed: "通过",
      failed: "未通过",
      unknown: "暂无数据",
      officialSite: "官网",
      officialSiteSkipped: "已跳过官网检测（直接使用商家域名）",
      officialSiteNotFound: "未找到官网",
      confidence: "可信度",
      signals: "流量信号",
      notSet: "—",
      manualTitle: "手动输入流量值",
      manualBrandLabel: "品牌名（可选）",
      manualBrandPlaceholder: "如：Anker；链接是亚马逊/eBay 等平台时填品牌名才能查品牌官网",
      manualVisitsLabel: "手动输入月访问量（可选）",
      manualVisitsPlaceholder: "如：80000（正整数）",
      manualHint:
        "数字来源建议去 SimilarWeb 免费版查该域名；这是你手动提供的值，只对比“官网月访问量”阈值这一档，绝不记作实测流量。",
      recheck: "用该值重判",
      rechecking: "重判中…",
      manualInvalid: "请至少填写品牌名或有效的手动月访问量（正整数，≤ 1e12）。",
      ocrUpload: "截图识别",
      ocrUploading: "识别中…",
      ocrHint: "在浏览器里截商品页/流量页的图上传，自动识别评分、评论数、价格、月销，供你估算月访问量时参考（图片不保存）。",
      ocrReviewNote: "识别值，请核对",
      ocrFailed: "截图识别失败",
    },
  },
};

export const en = {
  page: {
    title: "Cashback Monitor",
    description:
      "Cashback offer list, rate watch, terms watch, redirect-chain check, and rate comparison — all in one place.",
  },
  tabs: {
    offers: "Offers",
    rateWatch: "Rate Watch",
    termsWatch: "Terms Watch",
    redirectCheck: "Redirect Check",
    rateCompare: "Rate Compare",
  },
  offers: {
    addTitle: "Add cashback offer",
    network: "Cashback network name",
    networkPlaceholder: "Type or pick, e.g. rakuten",
    networkHint:
      "Any name can be typed manually; suggestions include networks used by existing offers plus common ones.",
    networkRequired: "Enter a network name (1–64 characters).",
    originalUrl: "Original URL",
    originalUrlPlaceholder: "https://…",
    urlRequired: "Enter a valid http(s) URL.",
    submit: "Add",
    adding: "Adding…",
    created: "Added.",
    loadFailed: "Failed to load",
    empty: "No cashback offers yet — add one first.",
    delete: "Delete",
    deleteConfirm:
      "Delete this cashback offer? Its tracking link will be paused too.",
    deleted: "Deleted.",
    columns: {
      network: "Network",
      originalUrl: "Original URL",
      trackingLink: "Tracking link",
      status: "Status",
      createdAt: "Created at",
      actions: "Actions",
    },
    status: {
      active: "Active",
      paused: "Paused",
    },
    loading: "Loading…",
    trafficGate: {
      check: "Check traffic gate",
      checking: "Checking…",
      close: "Hide result",
      passed: "Passed",
      failed: "Blocked",
      unknown: "No data",
      officialSite: "Official site",
      officialSiteSkipped: "Official-site detection skipped (merchant domain provided)",
      officialSiteNotFound: "Official site not found",
      confidence: "confidence",
      signals: "Traffic signals",
      notSet: "—",
      manualTitle: "Enter traffic manually",
      manualBrandLabel: "Brand name (optional)",
      manualBrandPlaceholder: "e.g. Anker; required to detect the brand's official site when the link is from Amazon/eBay",
      manualVisitsLabel: "Manual monthly visits (optional)",
      manualVisitsPlaceholder: "e.g. 80000 (positive integer)",
      manualHint:
        "Suggestion: look up the domain on the free SimilarWeb plan. This is a value you provide manually; it is only compared against the official-site monthly-visits threshold and is never presented as measured traffic.",
      recheck: "Re-evaluate with this value",
      rechecking: "Re-evaluating…",
      manualInvalid: "Please fill in a brand name or a valid manual monthly-visit number (positive integer, ≤ 1e12).",
      ocrUpload: "OCR from screenshot",
      ocrUploading: "Recognizing…",
      ocrHint: "Upload a screenshot of the product/traffic page; rating, review count, price and monthly sales are recognized as reference for your visits estimate (image is not stored).",
      ocrReviewNote: "Recognized values — please verify",
      ocrFailed: "Screenshot recognition failed",
    },
  },
};

export type CashbackMonitorDict = typeof zh;
