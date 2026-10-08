export interface AdsRotationDict {
  title: string;
  description: string;
  howItWorks: string;
  steps: string[];
  labelLabel: string;
  labelPlaceholder: string;
  labelHint: string;
  generate: string;
  generating: string;
  copy: string;
  copied: string;
  download: string;
  resultTitle: string;
  setupTitle: string;
  setupSteps: string[];
}

export const zh: AdsRotationDict = {
  title: "直链轮换 Script",
  description:
    "为直链投放生成 Google Ads 轮换脚本：多条广告（不同直链 URL）打上同一标签，脚本定时轮流只启用一条。",
  howItWorks: "工作原理",
  steps: [
    "为同一 Offer 创建 N 条广告，每条填不同的直链 Final URL",
    "给这 N 条广告打上同一个标签（如 adlinklab-rotate-nike）",
    "把生成的 Script 粘贴到 Google Ads → 工具 → 脚本，设置每小时运行",
    "Script 每次运行：暂停该标签下所有广告，只启用轮换顺序中的下一条",
  ],
  labelLabel: "轮换标签",
  labelPlaceholder: "adlinklab-rotate-nike",
  labelHint: "只能包含字母、数字、下划线和连字符。N 条广告必须打上完全相同的标签。",
  generate: "生成 Script",
  generating: "生成中…",
  copy: "复制代码",
  copied: "已复制",
  download: "下载 .js 文件",
  resultTitle: "生成的 Script",
  setupTitle: "部署步骤",
  setupSteps: [
    "在 Google Ads 中给要轮换的广告打上上方填写的标签",
    "进入 工具 → 脚本 → + 新建脚本，粘贴代码",
    "点击「运行」测试一次，查看日志确认轮换正常",
    "设置频率为「每小时」，保存",
  ],
};

export const en: AdsRotationDict = {
  title: "Direct-Link Rotation Script",
  description:
    "Generate a Google Ads rotation script for direct-link campaigns: tag N ads (different direct URLs) with one label; the script enables one at a time in rotation.",
  howItWorks: "How it works",
  steps: [
    "Create N ads for the same offer, each with a different direct final URL",
    "Apply the same label to all N ads (e.g. adlinklab-rotate-nike)",
    "Paste the generated script into Google Ads → Tools → Scripts, run hourly",
    "Each run: pause all labeled ads, enable the next one in rotation order",
  ],
  labelLabel: "Rotation label",
  labelPlaceholder: "adlinklab-rotate-nike",
  labelHint: "Letters, digits, underscore and hyphen only. All N ads must share the exact same label.",
  generate: "Generate Script",
  generating: "Generating…",
  copy: "Copy code",
  copied: "Copied",
  download: "Download .js file",
  resultTitle: "Generated Script",
  setupTitle: "Deployment steps",
  setupSteps: [
    "Apply the label above to the ads you want to rotate in Google Ads",
    "Go to Tools → Scripts → + New script, paste the code",
    "Click Run once to test, check the log for correct rotation",
    "Set frequency to Hourly and save",
  ],
};
