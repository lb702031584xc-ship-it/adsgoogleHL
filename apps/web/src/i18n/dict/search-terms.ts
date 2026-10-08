/**
 * 自动化套件 2/5 — 搜索词自动否词 (search term miner) strings.
 * Imported directly by the search-terms client component and actions
 * (parent wires dictionaries.ts registration, if desired).
 * Shared vocabulary (nav, actions, generic empty/error) lives in
 * `t.common.*` — do not duplicate it here.
 */
export const zh = {
  panel: {
    title: "搜索词自动否词",
    description:
      "粘贴 Google Ads 搜索词报告，AI 逐条判断是否与 offer 相关：无关词（招聘、免费、DIY 教程等）建议否掉，品牌词谨慎保留。",
    pasteLabel: "搜索词报告",
    pastePlaceholder:
      "每行一个搜索词，或粘贴带表头的 CSV（自动识别“搜索词”列）…\nwarehouse jobs\ncheap shoes free download\nbest running shoes",
    campaignLabel: "系列名称（可选）",
    campaignPlaceholder: "例如：US-Shoes-返利",
    analyze: "分析",
    analyzing: "分析中…",
    analyzeFailed: "分析失败：",
    emptyHint: "粘贴搜索词后点击「分析」，AI 会给出否词建议。",
    aiNotConfigured:
      "AI 未配置：请先在「AI 设置」中填写 LLM 地址、模型和密钥。",
    analyzed: "分析完成，建议已保存。",
  },
  list: {
    title: "否词建议",
    filterAll: "全部",
    filterPending: "待处理",
    filterApplied: "已应用",
    filterDismissed: "已忽略",
    colTerm: "搜索词",
    colAction: "建议动作",
    colReason: "AI 理由",
    colStatus: "状态",
    colOps: "操作",
    actionExact: "精确否词",
    actionPhrase: "词组否词",
    actionIgnore: "忽略（保留）",
    statusPending: "待处理",
    statusApplied: "已应用",
    statusDismissed: "已忽略",
    apply: "应用",
    dismiss: "忽略",
    applying: "处理中…",
    applied: "已应用，建议已加入推送队列。",
    dismissed: "已忽略该建议。",
    negativeTextLabel: "否词文本（复制到 Google Ads）：",
    queuedNote: "已创建推送任务（PENDING），待脚本执行；也可手动复制上面的否词粘贴到 Google Ads。",
    empty: "暂无建议。",
    loadFailed: "加载失败：",
  },
};

export const en = {
  panel: {
    title: "Search Term Miner",
    description:
      "Paste a Google Ads search term report; AI judges each term's relevance to your offer: irrelevant terms (jobs, free, DIY tutorials, …) get negative-keyword suggestions, brand terms are kept cautiously.",
    pasteLabel: "Search term report",
    pastePlaceholder:
      "One term per line, or paste CSV with a header (the “search term” column is auto-detected)…\nwarehouse jobs\ncheap shoes free download\nbest running shoes",
    campaignLabel: "Campaign name (optional)",
    campaignPlaceholder: "e.g. US-Shoes-Cashback",
    analyze: "Analyze",
    analyzing: "Analyzing…",
    analyzeFailed: "Analysis failed: ",
    emptyHint: "Paste search terms and click Analyze — AI will suggest negatives.",
    aiNotConfigured:
      "AI is not configured: fill in the LLM endpoint, model and key in AI Settings first.",
    analyzed: "Analysis complete; suggestions saved.",
  },
  list: {
    title: "Negative keyword suggestions",
    filterAll: "All",
    filterPending: "Pending",
    filterApplied: "Applied",
    filterDismissed: "Dismissed",
    colTerm: "Search term",
    colAction: "Suggested action",
    colReason: "AI reason",
    colStatus: "Status",
    colOps: "Actions",
    actionExact: "Negative exact",
    actionPhrase: "Negative phrase",
    actionIgnore: "Ignore (keep)",
    statusPending: "Pending",
    statusApplied: "Applied",
    statusDismissed: "Dismissed",
    apply: "Apply",
    dismiss: "Dismiss",
    applying: "Working…",
    applied: "Applied; suggestion queued for push.",
    dismissed: "Suggestion dismissed.",
    negativeTextLabel: "Negative keyword (copy into Google Ads):",
    queuedNote: "Push task created (PENDING), awaiting script execution; you can also paste the negative above into Google Ads manually.",
    empty: "No suggestions yet.",
    loadFailed: "Load failed: ",
  },
};
