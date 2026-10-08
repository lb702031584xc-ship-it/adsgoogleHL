/**
 * Automation pack ① — dead link monitor strings.
 * Registered in dictionaries.ts as `deadLink` (parent wires the import).
 * Shared vocabulary (nav, actions, generic empty/error) lives in
 * `t.common.*` — do not duplicate it here.
 */
export const zh = {
  page: {
    title: "死链监控",
    description:
      "定时检测所有活跃跟踪链接的目标页面：404/410/5xx、超时、跳转到商家首页都视为死链，自动暂停链接并发出告警。",
    checkNow: "立即检查",
    checking: "检查中…",
    checkSummary: (s: { checked: number; dead: number; paused: number }) =>
      `检查完成：共 ${s.checked} 个链接，发现死链 ${s.dead} 个，已暂停 ${s.paused} 个。`,
    checkFailedPrefix: "检查失败：",
  },
  table: {
    link: "链接",
    status: "状态",
    statusCode: "状态码",
    finalUrl: "最终 URL",
    responseTime: "响应时间",
    checkedAt: "检查时间",
    failureReason: "失败原因",
    alive: "存活",
    dead: "死亡",
    empty: "暂无检查记录，点击「立即检查」开始首次检测。",
    responseTimeMs: (ms: number | null) =>
      ms == null ? "—" : `${ms} ms`,
  },
  pager: {
    prev: "上一页",
    next: "下一页",
    of: (page: number, totalPages: number) => `第 ${page} / ${totalPages} 页`,
  },
};

export const en = {
  page: {
    title: "Dead Link Monitor",
    description:
      "Periodically checks the destination pages of all active tracking links: 404/410/5xx, timeouts, and redirects to the merchant homepage all count as dead — the link is auto-paused and an alert is raised.",
    checkNow: "Check now",
    checking: "Checking…",
    checkSummary: (s: { checked: number; dead: number; paused: number }) =>
      `Check complete: ${s.checked} links checked, ${s.dead} dead, ${s.paused} paused.`,
    checkFailedPrefix: "Check failed: ",
  },
  table: {
    link: "Link",
    status: "Status",
    statusCode: "Status code",
    finalUrl: "Final URL",
    responseTime: "Response time",
    checkedAt: "Checked at",
    failureReason: "Failure reason",
    alive: "Alive",
    dead: "Dead",
    empty: "No check records yet — click “Check now” to start the first scan.",
    responseTimeMs: (ms: number | null) => (ms == null ? "—" : `${ms} ms`),
  },
  pager: {
    prev: "Previous",
    next: "Next",
    of: (page: number, totalPages: number) => `Page ${page} of ${totalPages}`,
  },
};
