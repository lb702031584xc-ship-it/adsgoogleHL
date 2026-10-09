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
  },
};

export type CashbackMonitorDict = typeof zh;
