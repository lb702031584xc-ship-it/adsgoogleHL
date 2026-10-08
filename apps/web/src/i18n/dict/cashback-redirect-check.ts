/**
 * Feature 4 — 跳转链检测（redirect-check）strings.
 * Imported directly by the redirect-check client component (same pattern as
 * dead-link). Shared vocabulary (nav, actions, generic empty/error) lives in
 * `t.common.*` — do not duplicate it here.
 */
export const zh = {
  page: {
    title: "跳转链检测",
    description:
      "每天自动跟随每条活跃跟踪链接的跳转链（最多 10 跳）：跳数过多、循环重定向、终链域名不符、某跳失败都会被标记并发出告警。",
    checkAll: "全部检查",
    checking: "检查中…",
    checkSummary: (s: { checked: number; clean: number; warning: number; error: number }) =>
      `检查完成：共 ${s.checked} 个链接，无问题 ${s.clean} 个，有警告 ${s.warning} 个，检查失败 ${s.error} 个。`,
    checkFailedPrefix: "检查失败：",
  },
  table: {
    link: "链接",
    status: "状态",
    hopCount: "跳数",
    issues: "问题",
    finalUrl: "最终 URL",
    checkedAt: "检查时间",
    hops: "跳转明细",
    hopUrl: "URL",
    hopDomain: "域名",
    hopStatus: "状态码",
    noResponse: "无响应",
    empty: "暂无检查记录，点击「全部检查」开始首次检测。",
    noIssues: "无",
  },
  status: {
    ok: "正常",
    warning: "警告",
    error: "失败",
  },
  issues: {
    too_many_hops: "跳数过多（>5）",
    redirect_loop: "循环重定向",
    final_domain_mismatch: "终链域名不符",
    hop_failed: "某跳失败",
    target_blocked: "目标被拦截",
  },
  pager: {
    prev: "上一页",
    next: "下一页",
    of: (page: number, totalPages: number) => `第 ${page} / ${totalPages} 页`,
  },
};

export const en = {
  page: {
    title: "Redirect Chain Check",
    description:
      "Daily follow of every active tracking link's redirect chain (up to 10 hops): too many hops, redirect loops, final-domain mismatches and failed hops are flagged and alerted.",
    checkAll: "Check all",
    checking: "Checking…",
    checkSummary: (s: { checked: number; clean: number; warning: number; error: number }) =>
      `Check complete: ${s.checked} links checked, ${s.clean} clean, ${s.warning} with warnings, ${s.error} failed.`,
    checkFailedPrefix: "Check failed: ",
  },
  table: {
    link: "Link",
    status: "Status",
    hopCount: "Hops",
    issues: "Issues",
    finalUrl: "Final URL",
    checkedAt: "Checked at",
    hops: "Hop details",
    hopUrl: "URL",
    hopDomain: "Domain",
    hopStatus: "Status",
    noResponse: "no response",
    empty: "No check records yet. Click “Check all” to run the first scan.",
    noIssues: "none",
  },
  status: {
    ok: "OK",
    warning: "Warning",
    error: "Error",
  },
  issues: {
    too_many_hops: "too many hops (>5)",
    redirect_loop: "redirect loop",
    final_domain_mismatch: "final domain mismatch",
    hop_failed: "hop failed",
    target_blocked: "target blocked",
  },
  pager: {
    prev: "Previous",
    next: "Next",
    of: (page: number, totalPages: number) => `Page ${page} / ${totalPages}`,
  },
};
