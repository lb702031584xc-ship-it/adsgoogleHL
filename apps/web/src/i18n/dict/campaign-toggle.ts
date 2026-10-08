/**
 * Campaign remote toggle strings (zh/en).
 * Standalone fragment (not wired into dictionaries.ts — do not add it there);
 * import directly from "@/i18n/dict/campaign-toggle" and pick by lang.
 */
export const zh = {
  toggle: {
    enable: "启用",
    pause: "暂停",
    actionsColumn: "操作",
    confirmEnableTitle: "确认启用广告系列？",
    confirmPauseTitle: "确认暂停广告系列？",
    confirmBody: (name: string, action: string) =>
      `将对广告系列「${name}」执行「${action}」操作，任务将排队并由 Google Ads 脚本执行。`,
    confirm: "确认执行",
    cancel: "取消",
    queued: "已排队，脚本执行中…",
    succeeded: "脚本执行成功",
    failed: "脚本执行失败",
    taskFailed: "任务执行失败",
    queueFailed: "排队失败",
    taskId: "任务",
    unknownError: "未知错误",
  },
};

export const en = {
  toggle: {
    enable: "Enable",
    pause: "Pause",
    actionsColumn: "Actions",
    confirmEnableTitle: "Enable this campaign?",
    confirmPauseTitle: "Pause this campaign?",
    confirmBody: (name: string, action: string) =>
      `This will ${action.toLowerCase()} the campaign "${name}". The task will be queued and executed by the Google Ads Script.`,
    confirm: "Confirm",
    cancel: "Cancel",
    queued: "Queued — script is executing…",
    succeeded: "Script executed successfully",
    failed: "Script execution failed",
    taskFailed: "Task failed",
    queueFailed: "Failed to queue",
    taskId: "Task",
    unknownError: "Unknown error",
  },
};

export type CampaignToggleDict = typeof zh;
