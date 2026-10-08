/**
 * Dictionary fragment for operations pages: URL versions, change requests,
 * sync jobs, and audit logs. Shared vocabulary (nav, actions, misc labels)
 * lives in `common.ts` and is reused via `t.common.*` — only page-specific
 * strings go here.
 */
export const zh = {
  /** Labels shared across the ops pages. */
  labels: {
    entityType: "实体类型",
    entityId: "实体 ID",
    requestedBy: "申请人",
    requestedByRequired: "申请人 *",
    requestedByPlaceholder: "研究员姓名或昵称",
    reason: "原因",
    reasonRequired: "原因 *",
  },
  backToUrlVersions: "返回 URL 版本",
  urlVersions: {
    description:
      "不可变的 URL 版本历史（v1、v2、v3…）——永不覆盖历史行。",
    newRequest: "新建变更请求",
    versionsSection: "版本",
    requestsSection: "变更请求",
    versionsEmpty: "暂无 URL 版本",
    requestsEmpty: "暂无变更请求",
    columns: {
      version: "版本",
      finalUrl: "最终 URL",
      effective: "生效时间",
      entity: "实体",
      toVersion: "目标版本",
    },
  },
  changeRequest: {
    title: "变更请求",
    description: "URL 变更请求的详情与生命周期操作。",
    detail: {
      toVersionId: "目标版本 ID",
    },
    lifecycle: {
      title: "生命周期",
      description:
        "将请求推进到验证、排队、执行，或取消它。操作在当前租户上下文中运行。",
      ops: {
        validate: "验证",
        queue: "排队",
        execute: "执行",
      },
      opPending: (label: string) => `${label}…`,
      opSucceeded: (label: string) => `${label}成功。`,
      rollbackRequested: "已请求回滚。",
    },
    rollback: {
      title: "回滚",
      description:
        "请求回滚已应用的变更。将创建一个指向前一版本的新变更请求。",
      reasonPlaceholder: "回滚的可选原因",
      submit: "请求回滚",
      submitting: "请求中…",
    },
  },
  newChangeRequest: {
    title: "新建变更请求",
    description:
      "通过将实体指向一个已存在的不可变 URL 版本，为实体请求 URL 变更。",
    form: {
      entityId: "实体 ID *",
      entityIdPlaceholder: "目标实体的 UUID",
      toVersionId: "目标版本 ID *",
      toVersionIdPlaceholder: "目标 URL 版本的 UUID",
      reasonPlaceholder: "为什么要应用这次 URL 变更？",
      submit: "创建请求",
      submitting: "创建中…",
    },
  },
  jobs: {
    description:
      "BullMQ / SyncJob 状态：服务端 urlChange、转化上传及相关实验任务。",
    empty: "暂无任务",
    columns: {
      type: "类型",
      provider: "提供方",
      attempts: "尝试次数",
      started: "开始时间",
      completed: "完成时间",
      error: "错误",
    },
  },
  auditLogs: {
    description: "研究操作的不可变审计记录。",
    empty: "暂无审计日志",
    columns: {
      actor: "操作人",
      requestId: "请求 ID",
    },
  },
  pageShell: {
    skeletonTitle: "Phase 0 骨架",
    skeletonBody:
      "仅 UI 外壳。数据接入与交互流程将在后续阶段加入。Provider / Adapter 边界在 API 与 packages 层强制执行。",
  },
};

export const en: typeof zh = {
  labels: {
    entityType: "Entity Type",
    entityId: "Entity ID",
    requestedBy: "Requested By",
    requestedByRequired: "Requested By *",
    requestedByPlaceholder: "Researcher name or handle",
    reason: "Reason",
    reasonRequired: "Reason *",
  },
  backToUrlVersions: "Back to URL Versions",
  urlVersions: {
    description:
      "Immutable URL version history (v1, v2, v3…) — never overwrite prior rows.",
    newRequest: "New Change Request",
    versionsSection: "Versions",
    requestsSection: "Change Requests",
    versionsEmpty: "No URL versions yet",
    requestsEmpty: "No change requests yet",
    columns: {
      version: "Version",
      finalUrl: "Final URL",
      effective: "Effective",
      entity: "Entity",
      toVersion: "To Version",
    },
  },
  changeRequest: {
    title: "Change Request",
    description: "URL change request detail and lifecycle operations.",
    detail: {
      toVersionId: "To Version ID",
    },
    lifecycle: {
      title: "Lifecycle",
      description:
        "Move the request through validation, queueing, execution, or cancel it. Actions run in the current tenant context.",
      ops: {
        validate: "Validate",
        queue: "Queue",
        execute: "Execute",
      },
      opPending: (label: string) => `${label}…`,
      opSucceeded: (label: string) => `${label} succeeded.`,
      rollbackRequested: "Rollback requested.",
    },
    rollback: {
      title: "Rollback",
      description:
        "Request a rollback of an applied change. Creates a new change request targeting the previous version.",
      reasonPlaceholder: "Optional reason for the rollback",
      submit: "Request Rollback",
      submitting: "Requesting…",
    },
  },
  newChangeRequest: {
    title: "New Change Request",
    description:
      "Request a URL change for an entity by pointing it at an existing immutable URL version.",
    form: {
      entityId: "Entity ID *",
      entityIdPlaceholder: "UUID of the target entity",
      toVersionId: "To Version ID *",
      toVersionIdPlaceholder: "UUID of the desired URL version",
      reasonPlaceholder: "Why should this URL change be applied?",
      submit: "Create Request",
      submitting: "Creating…",
    },
  },
  jobs: {
    description:
      "BullMQ / SyncJob status for server-side urlChange, conversion upload, and related lab jobs.",
    empty: "No jobs yet",
    columns: {
      type: "Type",
      provider: "Provider",
      attempts: "Attempts",
      started: "Started",
      completed: "Completed",
      error: "Error",
    },
  },
  auditLogs: {
    description: "Immutable audit trail of research operations.",
    empty: "No audit logs yet",
    columns: {
      actor: "Actor",
      requestId: "Request ID",
    },
  },
  pageShell: {
    skeletonTitle: "Phase 0 skeleton",
    skeletonBody:
      "UI shell only. Data wiring and interactive workflows arrive in later phases. Provider / Adapter boundaries are enforced in the API and packages layer.",
  },
};
