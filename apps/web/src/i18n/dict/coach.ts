/**
 * 第十三批：教练模式字典。
 */
export interface CoachDict {
  toggleLabel: string;
  toggleHint: string;
  budgetLimitLabel: string;
  budgetLimitHint: string;
  saved: string;
  blocked: string;
  confirmTitle: string;
  goFix: string;
  proceedAnyway: string;
  cancel: string;
  gotIt: string;
  findings: Record<
    string,
    { title: string; body: string; advice: string }
  >;
}

export const zh: CoachDict = {
  toggleLabel: "教练模式",
  toggleHint: "开启后在关键操作前拦截常见错误（默认开，老手可关）",
  budgetLimitLabel: "日预算上限（$）",
  budgetLimitHint: "超过此金额建广告/系列时二次确认；留空=不限制",
  saved: "已保存",
  blocked: "教练拦截",
  confirmTitle: "请确认",
  goFix: "去修改",
  proceedAnyway: "仍然继续",
  cancel: "取消",
  gotIt: "知道了",
  findings: {
    brandKeyword: {
      title: "品牌词拦截",
      body: "关键词「{keyword}」命中品牌词「{terms}」。直接竞价品牌词最容易被商家投诉，是联盟账号被封的常见原因。",
      advice: "正确做法：改投通用词（如 best + 品类词），把品牌词加入否定关键词。",
    },
    disclosure: {
      title: "缺少 Affiliate Disclosure",
      body: "页面内容中没有检测到 Affiliate Disclosure（联盟披露声明）。不披露可能违反 FTC 规定与联盟条款。",
      advice: "正确做法：在页面底部添加披露声明，例如“This page contains affiliate links…”或中文“推广披露”。",
    },
    marketplaceTarget: {
      title: "目标直连平台域",
      body: "目标链接 {domain} 是电商平台域名。把广告/跟踪流量直连平台，佣金可能归因失败，也违反多数联盟的直连政策。",
      advice: "正确做法：先经过自己的落地页或跟踪链接，再跳转到平台。",
    },
    budgetLimit: {
      title: "日预算超过上限",
      body: "日预算 ${budget} 超过了你设定的上限 ${limit}。",
      advice: "确认这是你想要的测试花费吗？",
    },
  },
};

export const en: CoachDict = {
  toggleLabel: "Coach mode",
  toggleHint: "Blocks common mistakes before key actions (on by default; veterans can turn it off)",
  budgetLimitLabel: "Daily budget cap ($)",
  budgetLimitHint: "Confirm when a campaign/ad exceeds this; empty = no limit",
  saved: "Saved",
  blocked: "Coach blocked",
  confirmTitle: "Please confirm",
  goFix: "Go fix it",
  proceedAnyway: "Proceed anyway",
  cancel: "Cancel",
  gotIt: "Got it",
  findings: {
    brandKeyword: {
      title: "Brand keyword blocked",
      body: "Keyword “{keyword}” hits brand term(s) “{terms}”. Bidding on brand terms invites merchant complaints — a common cause of affiliate account bans.",
      advice: "Do this instead: bid on generic terms (e.g. best + category) and add brand terms as negative keywords.",
    },
    disclosure: {
      title: "Missing Affiliate Disclosure",
      body: "No affiliate disclosure was detected in the page content. Missing disclosure may violate FTC rules and network terms.",
      advice: "Do this instead: add a disclosure at the page bottom, e.g. “This page contains affiliate links…”.",
    },
    marketplaceTarget: {
      title: "Target is a marketplace domain",
      body: "Target link {domain} is a marketplace domain. Sending ad/tracked traffic straight to a marketplace can break commission attribution and violates most networks' direct-linking policies.",
      advice: "Do this instead: route through your own landing page or tracking link first.",
    },
    budgetLimit: {
      title: "Daily budget over your cap",
      body: "Daily budget ${budget} exceeds your cap of ${limit}.",
      advice: "Is this the test spend you intended?",
    },
  },
};
