/**
 * 方案 B — 直链多广告轮流启停 Script 生成器。
 *
 * 原理：为同一 Offer 建 N 条广告（每条填不同的直链 Final URL），
 * 打上同一个标签（如 "adlinklab-rotate-nike"）。Script 每次运行时，
 * 暂停该标签下的所有广告，只启用轮换顺序中的下一条。
 *
 * 为什么用启停而不是改 URL：
 * - 改 Final URL 会触发 Google 重新审核；启停广告不触发 URL 审核。
 * - 切换是即时的，不需要等审核。
 *
 * 使用方式：用户在 Google Ads → 工具 → 脚本 中粘贴生成的代码，
 * 设置每小时（或自定义频率）运行一次。
 */

export const ROTATION_SCRIPT_VERSION = "1.0.0";

export interface RotationScriptInput {
  /** 标签名，用于标识同一轮换组的所有广告，如 "adlinklab-rotate-nike" */
  label: string;
  /** 轮换策略：round_robin（默认） */
  strategy?: string;
}

/**
 * 生成 Google Ads Script 源代码。
 * Script 逻辑：
 * 1. 找出所有带指定标签的已启用/已暂停广告
 * 2. 按广告 ID 排序（保证顺序稳定）
 * 3. 读取上次启用的广告（存在 Script Properties 中）
 * 4. 暂停全部，启用下一个
 */
export function buildRotationScript(input: RotationScriptInput): string {
  const label = input.label.replace(/["\\]/g, "");
  if (!label) throw new Error("label is required");

  return `/**
 * AdLinkLab 直链轮换 Script v${ROTATION_SCRIPT_VERSION}
 * 标签: ${label}
 * 每次运行：暂停该标签下所有广告，只启用轮换顺序中的下一条。
 * 建议运行频率：每小时 1 次（Google Ads 脚本 → 频率 → 每小时）。
 */
function main() {
  var LABEL = "${label}";
  var PROP_KEY = "adlinklab_rotation_idx_" + LABEL;

  // 找出该标签下的所有广告（不限状态）
  var ads = AdsApp.ads()
    .withCondition("LabelNames CONTAINS '" + LABEL + "'")
    .withCondition("Status IN [ENABLED, PAUSED]")
    .orderBy("AdGroupName ASC")
    .orderBy("Id ASC")
    .get();

  var adList = [];
  while (ads.hasNext()) {
    adList.push(ads.next());
  }

  if (adList.length === 0) {
    Logger.log("[" + LABEL + "] 未找到带此标签的广告，跳过。");
    return;
  }
  if (adList.length === 1) {
    Logger.log("[" + LABEL + "] 只有 1 条广告，无需轮换。");
    // 确保它是启用的
    if (adList[0].isPaused()) adList[0].enable();
    return;
  }

  // 读取上次轮换到的下标
  var props = PropertiesService.getScriptProperties();
  var lastIdx = parseInt(props.getProperty(PROP_KEY) || "-1", 10);
  var nextIdx = (lastIdx + 1) % adList.length;

  // 暂停全部，启用下一个
  for (var i = 0; i < adList.length; i++) {
    try {
      if (i === nextIdx) {
        if (adList[i].isPaused()) adList[i].enable();
      } else {
        if (adList[i].isEnabled()) adList[i].pause();
      }
    } catch (e) {
      Logger.log("[" + LABEL + "] 广告 " + i + " 切换失败: " + e);
    }
  }

  props.setProperty(PROP_KEY, String(nextIdx));
  Logger.log(
    "[" + LABEL + "] 轮换完成: " + adList.length + " 条广告，当前启用第 " +
    (nextIdx + 1) + " 条。"
  );
}
`;
}

/** 校验输入，返回错误信息列表（为空表示通过）。 */
export function validateRotationScriptInput(input: RotationScriptInput): string[] {
  const errors: string[] = [];
  if (!input.label || !input.label.trim()) {
    errors.push("label 必填，如 adlinklab-rotate-nike");
  } else if (!/^[a-zA-Z0-9_-]+$/.test(input.label.trim())) {
    errors.push("label 只能包含字母、数字、下划线和连字符");
  }
  return errors;
}
