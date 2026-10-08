/**
 * 落地页优化队列 — 独立 dict 文件（不接入 dictionaries.ts）。
 * 任务由分析器自动创建：总分低于 70 的分析结果进入队列，按优先级排序。
 */
export const zh = {
  title: "落地页优化队列",
  description:
    "分析器评分低于 70 的落地页会自动进入此队列。按优先级逐个修复：从高优先级开始，点击「开始处理」标记为处理中，完成后「标记完成」。",

  statusFilter: {
    all: "全部",
    PENDING: "待处理",
    IN_PROGRESS: "处理中",
    DONE: "已完成",
  },
  status: {
    PENDING: "待处理",
    IN_PROGRESS: "处理中",
    DONE: "已完成",
  },
  priority: {
    HIGH: "高优先级",
    MEDIUM: "中优先级",
    LOW: "低优先级",
  },
  dimensions: {
    performance: "性能",
    cta: "行动号召",
    trust: "信任感",
    mobile: "移动端",
    copy: "文案",
    bounceRisk: "跳出风险",
  },

  scoreLabel: "总分",
  worstDimensionLabel: "最弱维度",
  issuesTitle: "问题",
  issuesCount: "个问题",
  showAllIssues: "展开全部",
  collapseIssues: "收起",
  createdAtLabel: "创建",
  completedAtLabel: "完成",
  unknownPage: "（落地页已删除）",
  visitPage: "访问落地页",

  actions: {
    start: "开始处理",
    complete: "标记完成",
    archive: "归档",
    confirmArchive: "确定归档该任务吗？归档后将从队列中删除。",
    busy: "处理中…",
    rewrite: "AI 改写",
  },

  rewrite: {
    modalTitle: "AI 改写对照",
    generating: "AI 正在根据问题清单生成改写版本，请稍候…",
    element: "元素",
    location: "位置",
    before: "改写前",
    after: "改写后",
    reason: "改写理由",
    originalScore: "当前评分",
    estimatedScore: "预估新评分",
    appliedCount: "处替换已可应用",
    skippedCount: "处因原文未找到或多处匹配被跳过",
    confirmApply: "确认应用",
    applying: "应用中…",
    cancel: "取消",
    backupNote: "应用前会自动备份原页面内容，可随时对照查看。",
    applySuccess: "改写版本已应用到落地页",
    errorGenerate: "生成改写版本失败",
    errorApply: "应用改写版本失败",
    noRewrites: "AI 未返回改写内容，请重试",
    close: "关闭",
  },

  empty: "暂无优化任务 — 评分低于 70 的落地页分析结果会自动出现在这里。",
  loading: "加载中…",
  errorLoading: "加载任务失败",
  errorAction: "操作失败，请重试",
};

export const en = {
  title: "Landing Page Optimization Queue",
  description:
    "Landing pages scoring below 70 automatically land here. Work through them by priority: start a task to mark it in progress, then mark it done when the fixes ship.",

  statusFilter: {
    all: "All",
    PENDING: "Pending",
    IN_PROGRESS: "In progress",
    DONE: "Done",
  },
  status: {
    PENDING: "Pending",
    IN_PROGRESS: "In progress",
    DONE: "Done",
  },
  priority: {
    HIGH: "High priority",
    MEDIUM: "Medium priority",
    LOW: "Low priority",
  },
  dimensions: {
    performance: "Performance",
    cta: "Call to action",
    trust: "Trust",
    mobile: "Mobile",
    copy: "Copy",
    bounceRisk: "Bounce risk",
  },

  scoreLabel: "Score",
  worstDimensionLabel: "Weakest dimension",
  issuesTitle: "Issues",
  issuesCount: "issues",
  showAllIssues: "Show all",
  collapseIssues: "Collapse",
  createdAtLabel: "Created",
  completedAtLabel: "Completed",
  unknownPage: "(landing page deleted)",
  visitPage: "Visit page",

  actions: {
    start: "Start",
    complete: "Mark done",
    archive: "Archive",
    confirmArchive: "Archive this task? It will be removed from the queue.",
    busy: "Working…",
    rewrite: "AI rewrite",
  },

  rewrite: {
    modalTitle: "AI rewrite — before / after",
    generating: "Generating the rewritten version from the issue list…",
    element: "Element",
    location: "Location",
    before: "Before",
    after: "After",
    reason: "Reason",
    originalScore: "Current score",
    estimatedScore: "Estimated new score",
    appliedCount: "replacements ready to apply",
    skippedCount: "skipped (original text not found or matched multiple places)",
    confirmApply: "Apply",
    applying: "Applying…",
    cancel: "Cancel",
    backupNote: "The original page content is backed up automatically before applying.",
    applySuccess: "The rewrite has been applied to the landing page",
    errorGenerate: "Failed to generate the rewrite",
    errorApply: "Failed to apply the rewrite",
    noRewrites: "The AI returned no rewrites — please retry",
    close: "Close",
  },

  empty: "No optimization tasks yet — analyzed landing pages scoring below 70 will appear here automatically.",
  loading: "Loading…",
  errorLoading: "Failed to load tasks",
  errorAction: "Operation failed, please retry",
};

export type LpOptimizationDict = typeof zh;
